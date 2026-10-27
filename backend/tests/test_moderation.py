"""Report → admin action → suspension / ban enforced, lifted, audited.
Isolated SQLite.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import unittest
from datetime import timedelta
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app.api.routes.business import router as business_router
from app.core.account_access import blocked_reason
from app.core.clock import now_ph
from app.core.security import get_current_user
from app.models.business_report import BusinessReport
from app.models.moderation_action import ModerationAction
from app.models.notification import Notification
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User


class ModerationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.report_service.engine", "app.services.moderation_service.engine",
                       "app.services.requirement_service.engine", "app.services.business_service.engine"):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.reporter = self.save(User(business_name="Honest Buyer", role="buyer", is_verified=True, verification_status="verified"))
        self.bad = self.save(User(business_name="Shady Prints", role="seller", is_verified=True, verification_status="verified"))
        self.admin = self.save(User(business_name="Admin", is_admin=True))

        self.current = self.reporter
        app = FastAPI()
        app.include_router(business_router, prefix="/business")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def load(self, model, rid):
        with Session(self.engine) as session:
            obj = session.get(model, rid)
            session.expunge(obj)
            return obj

    def file_report(self):
        self.current = self.reporter
        r = self.client.post(f"/business/{self.bad.id}/report", json={"reason": "SPAM", "details": "Posting fake quotations everywhere."})
        self.assertEqual(r.status_code, 201, r.text)
        with Session(self.engine) as session:
            return session.exec(select(BusinessReport)).all()[-1].id

    def review(self, report_id, action, notes="Repeated fake quotations."):
        self.current = self.admin
        return self.client.post(f"/business/admin/reports/{report_id}/review", json={"action": action, "notes": notes})

    def titles(self, user):
        with Session(self.engine) as session:
            return [n.title for n in session.exec(select(Notification).where(Notification.user_id == user.id)).all()]

    def test_suspension_blocks_and_is_audited(self):
        rid = self.file_report()
        self.assertEqual(self.review(rid, "suspend_7").status_code, 204)
        user = self.load(User, self.bad.id)
        self.assertGreater(user.suspended_until, now_ph() + timedelta(days=6))
        self.assertIn("suspended", blocked_reason(user))
        self.assertIn("Your account is suspended", self.titles(self.bad))
        self.assertIn("Your report was reviewed", self.titles(self.reporter))
        with Session(self.engine) as session:
            action = session.exec(select(ModerationAction)).one()
        self.assertEqual((action.action, action.admin_id, action.report_id), ("suspend", self.admin.id, rid))

        row = self.client.get("/business/admin/reports").json()[0]
        self.assertEqual(row["status"], "resolved")
        self.assertEqual(row["reported_history"][0]["action"], "suspend")

    def test_reported_user_never_learns_who_reported(self):
        rid = self.file_report()
        self.review(rid, "warn")
        with Session(self.engine) as session:
            texts = " ".join(n.title + n.detail for n in session.exec(select(Notification).where(Notification.user_id == self.bad.id)).all())
        self.assertNotIn("Honest Buyer", texts)

    def test_action_needs_a_reason_dismiss_does_not(self):
        rid = self.file_report()
        self.assertEqual(self.review(rid, "ban", notes="").status_code, 422)
        self.assertEqual(self.review(rid, "dismiss", notes=None).status_code, 204)
        self.assertIsNone(blocked_reason(self.load(User, self.bad.id)))

    def test_ban_winds_down_open_work_and_lift_restores(self):
        req = self.save(Requirement(ref_code="REQ-1", title="Boxes", owner_id=self.bad.id, location="Pasig",
                                    status="open", closes_at=now_ph() + timedelta(days=2)))
        other = self.save(Requirement(ref_code="REQ-2", title="Tarps", owner_id=self.reporter.id, location="Pasig",
                                      status="open", closes_at=now_ph() + timedelta(days=2)))
        quote = self.save(Quotation(requirement_id=other.id, business_id=self.bad.id, submission_hash="h",
                                    status="sealed", total_price=100))
        rid = self.file_report()
        self.assertEqual(self.review(rid, "ban").status_code, 204)

        user = self.load(User, self.bad.id)
        self.assertIsNotNone(user.banned_at)
        self.assertFalse(user.is_active)
        self.assertEqual(self.load(Requirement, req.id).status, "cancelled")
        self.assertEqual(self.load(Quotation, quote.id).status, "withdrawn")

        self.current = self.admin
        self.assertEqual(self.client.post(f"/business/admin/users/{self.bad.id}/lift", json={"notes": "Appeal accepted"}).status_code, 204)
        self.assertIsNone(blocked_reason(self.load(User, self.bad.id)))

    def test_my_reports_and_search(self):
        self.file_report()
        self.current = self.reporter
        mine = self.client.get("/business/reports/mine").json()
        self.assertEqual((mine[0]["reported_name"], mine[0]["status"]), ("Shady Prints", "open"))
        self.assertNotIn("admin_notes", mine[0])
        found = self.client.get("/business/search", params={"q": "shady"}).json()
        self.assertEqual([b["name"] for b in found], ["Shady Prints"])
        self.assertEqual(self.client.get("/business/search", params={"q": "admin"}).json(), [])  # admins never listed


if __name__ == "__main__":
    unittest.main()
