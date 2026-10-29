"""Admin audit log: admin actions are recorded with who/what/whom, super
admins read them with filters and export CSV, and a failed write never
fails the action. Isolated SQLite.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import csv
import io
import os
import unittest
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app.api.routes.admin_audit import router as audit_router
from app.api.routes.admin_team import router as team_router
from app.api.routes.business import router as business_router
from app.core.security import get_current_user
from app.models.admin_action import AdminAction
from app.models.user import User
from app.services import admin_audit


class AdminAuditTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.admin_audit.engine", "app.services.admin_team_service.engine",
                       "app.services.business_service.engine"):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)
        self.boss = self.save(User(business_name="Boss", email="boss@x.ph", is_admin=True, admin_role="super_admin"))
        self.ana = self.save(User(business_name="Ana", email="ana@x.ph", is_admin=True, admin_role="admin"))
        self.shop = self.save(User(business_name="Shop", registered_name="Shop Printing Co.", role="seller",
                                   verification_status="submitted"))
        self.current = self.boss
        app = FastAPI()
        for r in (audit_router, team_router, business_router):
            app.include_router(r, prefix="/business")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

    def save(self, record):
        with Session(self.engine) as s:
            s.add(record)
            s.commit()
            s.refresh(record)
            s.expunge(record)
            return record

    def log(self, **params):
        r = self.client.get("/business/admin/audit-log", params=params)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_only_super_admins(self):
        self.current = self.ana
        self.assertEqual(self.client.get("/business/admin/audit-log").status_code, 403)
        self.assertEqual(self.client.get("/business/admin/audit-log.csv").status_code, 403)

    def test_actions_are_recorded_and_filterable(self):
        self.client.post(f"/business/admin/team/{self.ana.id}/reset-password")
        self.current = self.ana
        self.client.post(f"/business/admin/{self.shop.id}/review", json={"approve": False, "notes": "Blurry DTI"})
        self.current = self.boss

        body = self.log()
        entries = body["entries"]
        self.assertEqual([e["action"] for e in entries], ["verification_rejected", "admin_password_reset"])
        rejected = entries[0]
        self.assertEqual((rejected["admin_name"], rejected["target_name"]), ("Ana", "Shop Printing Co."))
        self.assertIn("Blurry DTI", rejected["details"])
        self.assertEqual(rejected["action_label"], "Rejected a verification")

        self.assertEqual([e["action"] for e in self.log(admin_id=self.boss.id)["entries"]], ["admin_password_reset"])
        self.assertEqual(len(self.log(action="verification_rejected")["entries"]), 1)
        self.assertEqual(len(self.log(q="blurry")["entries"]), 1)
        self.assertEqual({a["name"] for a in body["admins"]}, {"Boss", "Ana"})

    def test_csv_export_is_itself_recorded(self):
        admin_audit.record(None, self.ana.id, "library_uploaded", details="Interview data, buyers")
        r = self.client.get("/business/admin/audit-log.csv")
        self.assertEqual(r.status_code, 200)
        self.assertIn("attachment", r.headers["content-disposition"])
        rows = list(csv.reader(io.StringIO(r.text)))
        self.assertEqual(rows[0], ["When (PHT)", "Administrator", "Action", "Target business", "Details"])
        self.assertEqual(rows[1][1:], ["Ana", "Uploaded to Documents", "", "Interview data, buyers"])
        self.assertEqual(self.log()["entries"][0]["action"], "data_exported")

    def test_a_failed_write_never_raises(self):
        with patch("app.services.admin_audit.engine", create_engine("sqlite://")):  # no tables
            admin_audit.record(None, self.boss.id, "backup_created")
        with Session(self.engine) as s:
            self.assertEqual(s.exec(select(AdminAction)).all(), [])


if __name__ == "__main__":
    unittest.main()
