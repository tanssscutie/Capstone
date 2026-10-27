"""Backs up TrustLink's data: the MySQL database (mysqldump) and the uploaded
files (uploads/, already encrypted at rest), into backups/<date_time>/.

Run from backend/:   venv/Scripts/python.exe scripts/backup.py
Restore:             mysql -u <user> -p <database> < backups/<stamp>/database.sql
                     then unzip uploads.zip into backend/

IMPORTANT: uploads are encrypted with FILE_ENCRYPTION_KEY (backend/.env). The
backup is useless without that key, so keep a copy of the key somewhere safe
and separate from the backups — never inside them.

The backups/ folder is git-ignored: it holds personal data.
"""
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from sqlalchemy.engine import make_url  # noqa: E402

from app.core.config import settings  # noqa: E402

COMMON_MYSQLDUMP = [
    r"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe",
    r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe",
]


def find_mysqldump() -> str:
    found = os.environ.get("MYSQLDUMP") or shutil.which("mysqldump")
    if found:
        return found
    for path in COMMON_MYSQLDUMP:
        if os.path.exists(path):
            return path
    sys.exit("mysqldump not found — install MySQL client tools or set MYSQLDUMP to its path.")


def dump_database(target: Path) -> None:
    url = make_url(settings.DATABASE_URL)
    if not url.drivername.startswith("mysql"):
        sys.exit(f"Only MySQL is supported (DATABASE_URL uses {url.drivername}).")
    cmd = [find_mysqldump(), "--single-transaction", "--routines", "--triggers",
           "-h", url.host or "localhost", "-P", str(url.port or 3306), "-u", url.username or "root", url.database]
    env = dict(os.environ)
    if url.password:
        env["MYSQL_PWD"] = url.password  # not on the command line, where other processes could read it
    with open(target, "wb") as out:
        result = subprocess.run(cmd, stdout=out, stderr=subprocess.PIPE, env=env)
    if result.returncode != 0:
        target.unlink(missing_ok=True)
        sys.exit(f"mysqldump failed: {result.stderr.decode(errors='replace').strip()}")


def zip_uploads(target: Path) -> int:
    uploads = BACKEND / "uploads"
    count = 0
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zf:
        if uploads.exists():
            for path in uploads.rglob("*"):
                if path.is_file():
                    zf.write(path, path.relative_to(BACKEND))
                    count += 1
    return count


def main() -> None:
    folder = BACKEND / "backups" / datetime.now().strftime("%Y-%m-%d_%H%M%S")
    folder.mkdir(parents=True, exist_ok=False)
    dump_database(folder / "database.sql")
    files = zip_uploads(folder / "uploads.zip")
    size_mb = sum(p.stat().st_size for p in folder.iterdir()) / 1_000_000
    print(f"Backup written to {folder}  ({files} uploaded files, {size_mb:.1f} MB)")
    print("Reminder: keep FILE_ENCRYPTION_KEY from backend/.env safe and separate — uploads can't be read without it.")


if __name__ == "__main__":
    main()
