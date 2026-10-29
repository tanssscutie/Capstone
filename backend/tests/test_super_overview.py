"""Super-admin dashboard: each admin's 30-day workload and the service
health checks (no Gemini call, no email). Isolated SQLite + temp folder.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import tempfile
import unittest
from datetime import timedelta
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.api.routes.admin_data import router as data_router
from app.core.clock import now_ph
from app.core.config import settings
from app.core.security import get_current_user
from app.models.admin_action import AdminAction
from app.models.business_report import BusinessReport
from app.models.user import User
from app.models.verification_review import VerificationReview


class SuperOverviewTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        for target, value in [("app.services.super_overview_service.engine", self.engine),
                              ("app.services.super_overview_service.BACKEND_ROOT", self.root.name),
                              ("app.core.database.engine", self.engine)]:
            p = patch(target, value)
            p.start()
            self.addCleanup(p.stop)
        now = now_ph()
        with Session(self.engine) as s:
            s.add(User(id=1, business_name="Boss", is_admin=True, admin_role="super_admin"))
            s.add(User(id=2, business_name="Ana", is_admin=True, admin_role="admin"))
            s.add(User(id=3, business_name="Shop", role="seller"))
            s.add(VerificationReview(user_id=3, admin_id=2, approved=True, result_status="verified",
                                     submitted_at=now - timedelta(hours=10), created_at=now - timedelta(hours=4)))
            s.add(VerificationReview(user_id=3, admin_id=2, approved=False, result_status="rejected",
                                     submitted_at=now - timedelta(days=60), created_at=now - timedelta(days=40)))  # outside 30 days
            s.add(BusinessReport(reporter_id=3, reported_id=3, reason="SCAM", details="x", status="dismissed",
                                 reviewed_by=1, reviewed_at=now - timedelta(days=1)))
            s.add(AdminAction(admin_id=2, action="verification_approved", created_at=now - timedelta(hours=4)))
            s.commit()
        self.current = User(id=1, business_name="Boss", is_admin=True, admin_role="super_admin")
        app = FastAPI()
        app.include_router(data_router, prefix="/business")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

    def test_only_super_admins(self):
        self.current = User(id=2, business_name="Ana", is_admin=True, admin_role="admin")
        self.assertEqual(self.client.get("/business/admin/super-overview").status_code, 403)

    def test_workload(self):
        rows = {w["name"]: w for w in self.client.get("/business/admin/super-overview").json()["workload"]}
        self.assertEqual(set(rows), {"Boss", "Ana"})
        self.assertEqual((rows["Ana"]["verifications"], rows["Ana"]["actions"], rows["Ana"]["avg_review_hours"]), (1, 1, 6.0))
        self.assertIsNotNone(rows["Ana"]["last_action_at"])
        self.assertEqual((rows["Boss"]["reports"], rows["Boss"]["verifications"], rows["Boss"]["avg_review_hours"]), (1, 0, None))

    def test_health(self):
        with patch.object(settings, "GEMINI_API_KEY", ""), patch.object(settings, "SMTP_HOST", ""):
            checks = {c["name"]: c for c in self.client.get("/business/admin/super-overview").json()["health"]}
        self.assertEqual(checks["Database"]["status"], "ok")
        self.assertEqual(checks["Release scheduler"]["status"], "down")  # not started in tests
        self.assertEqual(checks["AI (Gemini)"]["status"], "off")
        self.assertEqual(checks["Email (SMTP)"]["status"], "warning")
        self.assertEqual(checks["Last backup"]["status"], "warning")

        os.makedirs(os.path.join(self.root.name, "backups", now_ph().strftime("%Y-%m-%d_%H%M%S")))
        checks = {c["name"]: c for c in self.client.get("/business/admin/super-overview").json()["health"]}
        self.assertEqual(checks["Last backup"]["status"], "ok")
        self.assertIn("today", checks["Last backup"]["detail"])


if __name__ == "__main__":
    unittest.main()
