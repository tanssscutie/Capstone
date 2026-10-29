"""Backups and CSV exports (super admins only): exports never carry sealed
content or secrets, backups run the script and are only listed. Isolated
SQLite + temp folder; the backup script itself is not run.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import csv
import io
import os
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.api.routes.admin_data import router as data_router
from app.core.security import get_current_user
from app.models.ledger_entry import LedgerEntry
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User


class AdminDataTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        for target, value in [("app.services.admin_data_service.engine", self.engine),
                              ("app.services.admin_audit.engine", self.engine),
                              ("app.services.admin_data_service.BACKUP_DIR", self.folder.name)]:
            p = patch(target, value)
            p.start()
            self.addCleanup(p.stop)
        with Session(self.engine) as s:
            s.add(User(id=1, business_name="Boss", is_admin=True, admin_role="super_admin", hashed_password="SECRET-HASH"))
            s.add(User(id=2, business_name="Buyer Co", role="buyer", hashed_password="SECRET-HASH"))
            s.add(User(id=3, business_name="Seller Co", role="seller"))
            s.add(Requirement(id=1, ref_code="RQ-1", title="Tarps", owner_id=2, location="Pasig", city="Pasig",
                              status="open", closes_at=datetime.now() + timedelta(days=2)))
            s.add(Quotation(id=1, requirement_id=1, business_id=3, submission_hash="h", status="sealed", total_price=98765.43))
            s.add(LedgerEntry(event_type="SUBMITTED", requirement_id=1, quotation_id=1, actor_id=3, prev_hash="0" * 64,
                              entry_hash="a" * 64, payload_json='{"total_price": 98765.43}'))
            s.commit()
        self.current = User(id=1, business_name="Boss", is_admin=True, admin_role="super_admin")
        app = FastAPI()
        app.include_router(data_router, prefix="/business")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

    def rows(self, kind):
        r = self.client.get(f"/business/admin/export/{kind}.csv")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotIn("98765", r.text)  # never a sealed figure
        self.assertNotIn("SECRET-HASH", r.text)
        return list(csv.DictReader(io.StringIO(r.text)))

    def test_only_super_admins(self):
        self.current = User(id=9, business_name="Ana", is_admin=True, admin_role="admin")
        for call in (lambda: self.client.get("/business/admin/export/users.csv"),
                     lambda: self.client.get("/business/admin/backups"),
                     lambda: self.client.post("/business/admin/backups")):
            self.assertEqual(call().status_code, 403)

    def test_exports(self):
        users = self.rows("users")
        self.assertEqual([u["business_name"] for u in users], ["Boss", "Buyer Co", "Seller Co"])
        self.assertNotIn("hashed_password", users[0])
        reqs = self.rows("requirements")
        self.assertEqual((reqs[0]["ref_code"], reqs[0]["buyer"], reqs[0]["quotations"], reqs[0]["awarded_to"]),
                         ("RQ-1", "Buyer Co", "1", ""))
        ledger = self.rows("ledger")
        self.assertEqual((ledger[0]["event_type"], ledger[0]["requirement"], ledger[0]["actor"]), ("SUBMITTED", "RQ-1", "Seller Co"))
        self.assertNotIn("payload_json", ledger[0])
        self.assertEqual(self.client.get("/business/admin/export/passwords.csv").status_code, 404)

    def test_backup_runs_the_script_and_lists_folders(self):
        os.makedirs(os.path.join(self.folder.name, "2026-10-29_083021"))
        with open(os.path.join(self.folder.name, "2026-10-29_083021", "database.sql"), "w") as f:
            f.write("dump")
        os.makedirs(os.path.join(self.folder.name, "not-a-backup"))
        listed = self.client.get("/business/admin/backups").json()
        self.assertEqual([b["name"] for b in listed], ["2026-10-29_083021"])
        self.assertEqual(listed[0]["files"], ["database.sql"])

        done = subprocess.CompletedProcess([], 0, stdout="Backup written to /srv/trustlink/backups/2026-10-29_090000  (24 uploaded files, 37.7 MB)\n", stderr="")
        with patch("app.services.admin_data_service.subprocess.run", return_value=done):
            r = self.client.post("/business/admin/backups")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()["name"], r.json()["uploaded_files"], r.json()["size_mb"]), ("2026-10-29_090000", 24, 37.7))

        failed = subprocess.CompletedProcess([], 1, stdout="", stderr="mysqldump not found — install MySQL client tools\n")
        with patch("app.services.admin_data_service.subprocess.run", return_value=failed):
            r = self.client.post("/business/admin/backups")
        self.assertEqual(r.status_code, 503)
        self.assertIn("mysqldump not found", r.json()["detail"])


if __name__ == "__main__":
    unittest.main()
