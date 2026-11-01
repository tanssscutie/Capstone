"""Withdrawal strikes (withdrawal_policy): 1st withdrawn quotation = warning,
2nd = 7-day suspension, 3rd = ban + a report for an admin to investigate.
Withdrawals the system makes don't count. Isolated SQLite.

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

from app.api.routes.requirements import router as requirements_router
from app.core.clock import now_ph
from app.core.security import get_current_user
from app.models.business_report import BusinessReport
from app.models.moderation_action import ModerationAction
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User


class WithdrawalStrikeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.requirement_service.engine", "app.services.moderation_service.engine"):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.admin = self.save(User(business_name="Admin", is_admin=True))
        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True))
        self.seller = self.save(User(business_name="Seller", role="seller", is_verified=True))
        self.reqs = [
            self.save(Requirement(ref_code=f"REQ-{i}", title="Tarps", owner_id=self.buyer.id, location="Pasig",
                                  status="open", closes_at=now_ph() + timedelta(days=2)))
            for i in range(4)
        ]
        app = FastAPI()
        app.include_router(requirements_router, prefix="/requirements")
        app.dependency_overrides[get_current_user] = lambda: self.seller
        self.client = TestClient(app)

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def quote(self, req):
        self.assertEqual(self.client.post(f"/requirements/{req.id}/quotations", json={"total_price": 1000}).status_code, 201)

    def withdraw(self, req):
        r = self.client.post(f"/requirements/{req.id}/quotations/withdraw")
        self.assertIn(r.status_code, (200, 204), r.text)

    def user(self):
        with Session(self.engine) as session:
            return session.get(User, self.seller.id)

    def actions(self):
        with Session(self.engine) as session:
            return [a.action for a in session.exec(select(ModerationAction).where(
                ModerationAction.user_id == self.seller.id).order_by(ModerationAction.id)).all()]

    def test_preview_then_warning_suspension_ban(self):
        self.assertEqual(self.client.get("/requirements/withdrawal-preview").json()["next"], "warning")

        self.quote(self.reqs[0])
        self.withdraw(self.reqs[0])
        self.assertEqual(self.user().withdrawal_count, 1)
        self.assertEqual(self.actions(), ["warn"])
        self.assertEqual(self.client.get("/requirements/withdrawal-preview").json()["next"], "suspension")

        self.quote(self.reqs[1])
        self.withdraw(self.reqs[1])
        u = self.user()
        self.assertEqual(self.actions(), ["warn", "suspend"])
        self.assertIsNotNone(u.suspended_until)
        self.assertGreater(u.suspended_until, now_ph() + timedelta(days=6))
        self.assertEqual(self.client.get("/requirements/withdrawal-preview").json()["next"], "ban")

        # A sealed quotation elsewhere: the ban withdraws it, and that one doesn't count.
        self.quote(self.reqs[3])
        self.quote(self.reqs[2])
        self.withdraw(self.reqs[2])
        u = self.user()
        self.assertEqual(self.actions(), ["warn", "suspend", "ban"])
        self.assertIsNotNone(u.banned_at)
        self.assertFalse(u.is_active)
        self.assertEqual(u.withdrawal_count, 3)
        with Session(self.engine) as session:
            report = session.exec(select(BusinessReport).where(BusinessReport.reported_id == self.seller.id)).one()
            self.assertEqual(report.status, "open")
            self.assertIn("investigation", report.details)
            other = session.exec(select(Quotation).where(Quotation.requirement_id == self.reqs[3].id)).one()
            self.assertEqual(other.status, "withdrawn")


if __name__ == "__main__":
    unittest.main()
