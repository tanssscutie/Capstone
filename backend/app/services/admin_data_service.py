"""Backups and CSV exports — super admins only.

Backup: runs scripts/backup.py (database dump + the encrypted uploads) into
backend/backups/<date_time>/. The app only lists those folders; it never
serves their contents — they hold personal data and stay on the server.

Exports: users, requirements and the ledger as CSV. Never sealed content:
no quotation prices, line items, terms or attachments, and the ledger
without its payload (event, hashes and who/when only). No password hashes,
tokens or embeddings.
"""
import csv
import io
import os
import re
import subprocess
import sys
from typing import Callable, Dict, List

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.clock import now_ph
from app.core.database import engine
from app.models.ledger_entry import LedgerEntry
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BACKUP_DIR = os.path.join(BACKEND_ROOT, "backups")
BACKUP_SCRIPT = os.path.join(BACKEND_ROOT, "scripts", "backup.py")
BACKUP_TIMEOUT_SECONDS = 600
_FOLDER = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{6}$")


def _name(u) -> str:
    if not u:
        return ""
    return u.display_name or u.registered_name or u.business_name


def _fmt(value) -> str:
    if value is None:
        return ""
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


def _csv(header: List[str], rows: List[list]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for r in rows:
        w.writerow([_fmt(v) for v in r])
    return buf.getvalue()


def export_users(session: Session) -> str:
    users = session.exec(select(User).order_by(User.id)).all()
    return _csv(
        ["id", "business_name", "registered_name", "display_name", "role", "admin_role", "email", "mobile_number",
         "industry_category", "city", "province", "verification_status", "tier", "is_active", "suspended_until",
         "banned_at", "created_at"],
        [[u.id, u.business_name, u.registered_name, u.display_name, u.role or "", u.admin_role if u.is_admin else "",
          u.email, u.mobile_number, u.industry_category, u.city, u.province, u.verification_status, u.tier,
          u.is_active, u.suspended_until, u.banned_at, u.created_at] for u in users],
    )


def export_requirements(session: Session) -> str:
    reqs = session.exec(select(Requirement).order_by(Requirement.id)).all()
    users = {u.id: u for u in session.exec(select(User)).all()}
    quotes = session.exec(select(Quotation.requirement_id, Quotation.status, Quotation.business_id, Quotation.id)).all()
    count: Dict[int, int] = {}
    owner_of_quote: Dict[int, int] = {}
    for rid, qstatus, business_id, qid in quotes:
        if qstatus not in ("withdrawn", "voided"):
            count[rid] = count.get(rid, 0) + 1
        owner_of_quote[qid] = business_id
    return _csv(
        ["id", "ref_code", "title", "buyer", "category", "item_code", "city", "budget_min", "budget_max", "strict_budget",
         "status", "quotations", "awarded_to", "created_at", "closes_at", "released_at"],
        [[r.id, r.ref_code, r.title, _name(users.get(r.owner_id)), r.category, r.item_code, r.city, r.price_min,
          r.price_max, r.strict_budget, r.status, count.get(r.id, 0),
          # Who won is public once awarded; nothing else about any quotation is exported.
          _name(users.get(owner_of_quote.get(r.awarded_quotation_id))) if r.status == "awarded" else "",
          r.created_at, r.closes_at, r.released_at] for r in reqs],
    )


def export_ledger(session: Session) -> str:
    entries = session.exec(select(LedgerEntry).order_by(LedgerEntry.id)).all()
    refs = {r.id: r.ref_code for r in session.exec(select(Requirement)).all()}
    users = {u.id: u for u in session.exec(select(User)).all()}
    return _csv(
        ["entry", "created_at", "event_type", "requirement", "quotation_id", "actor", "prev_hash", "entry_hash"],
        [[e.id, e.created_at, e.event_type, refs.get(e.requirement_id, e.requirement_id), e.quotation_id,
          _name(users.get(e.actor_id)) if e.actor_id else "TrustLink", e.prev_hash, e.entry_hash] for e in entries],
    )


EXPORTS: Dict[str, Callable[[Session], str]] = {
    "users": export_users,
    "requirements": export_requirements,
    "ledger": export_ledger,
}


def export(kind: str) -> str:
    if kind not in EXPORTS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown export")
    with Session(engine) as session:
        return EXPORTS[kind](session)


def list_backups() -> List[dict]:
    if not os.path.isdir(BACKUP_DIR):
        return []
    out = []
    for name in sorted(os.listdir(BACKUP_DIR), reverse=True):
        path = os.path.join(BACKUP_DIR, name)
        if not (_FOLDER.match(name) and os.path.isdir(path)):
            continue
        files = [f for f in os.listdir(path) if os.path.isfile(os.path.join(path, f))]
        out.append({"name": name, "files": sorted(files),
                    "size_bytes": sum(os.path.getsize(os.path.join(path, f)) for f in files)})
    return out


def run_backup() -> dict:
    """Runs scripts/backup.py and reports the folder it wrote. 503 when it fails
    (no mysqldump, database unreachable…), with the script's own message."""
    try:
        result = subprocess.run([sys.executable, BACKUP_SCRIPT], cwd=BACKEND_ROOT, capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=BACKUP_TIMEOUT_SECONDS,
                                env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="The backup took too long and was stopped.")
    output = (result.stdout or "") + (result.stderr or "")
    match = re.search(r"Backup written to (.+?)\s+\((\d+) uploaded files, ([\d.]+) MB\)", output)
    if result.returncode != 0 or not match:
        last = next((line for line in reversed(output.strip().splitlines()) if line.strip()), "Unknown error")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Backup failed: {last[:300]}")
    return {"name": os.path.basename(match.group(1).strip()), "uploaded_files": int(match.group(2)),
            "size_mb": float(match.group(3)), "finished_at": now_ph()}
