"""Withdrawn quotations that weren't replaced (withdrawal_policy): counted at
closing over 90 days — 1st recorded, 2nd a formal warning, 3rd a report for
an administrator to review. Withdraw + resubmit (fixing a mistake) never
counts, and nothing is suspended or banned automatically. Isolated SQLite.

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
from app.models.notification import Notification
from app.models.requirement import Requirement
from app.models.user import User
from app.models.withdrawal_strike import WithdrawalStrike
from app.services.requirement_service import requirement_service


class WithdrawalStrikeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.requirement_service.engine", "app.services.moderation_service.engine"):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        p = patch("app.services.requirement_service.settings.MIN_QUOTATIONS_TO_RELEASE", 1)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.admin = self.save(User(business_name="Admin", is_admin=True))
        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True))
        self.seller = self.save(User(business_name="Seller", role="seller", is_verified=True))
        self.other = self.save(User(business_name="Other", role="seller", is_verified=True))
        self.current = self.seller
        app = FastAPI()
        app.include_router(requirements_router, prefix="/requirements")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def requirement(self, i):
        return self.save(Requirement(ref_code=f"REQ-{i}", title="Tarps", owner_id=self.buyer.id, location="Pasig",
                                     status="open", closes_at=now_ph() + timedelta(days=2)))

    def quote(self, req, user=None):
        self.current = user or self.seller
        r = self.client.post(f"/requirements/{req.id}/quotations", json={"total_price": 1000})
        self.assertEqual(r.status_code, 201, r.text)

    def withdraw(self, req):
        self.current = self.seller
        self.assertEqual(self.client.post(f"/requirements/{req.id}/quotations/withdraw").status_code, 204)

    def close(self, req):
        with Session(self.engine) as session:
            r = session.get(Requirement, req.id)
            r.closes_at = now_ph() - timedelta(minutes=1)
            r.auto_extended_at = now_ph()  # no second chance: release or archive now
            session.add(r)
            session.commit()
        requirement_service.release_due_requirements()

    def backed_out(self, i):
        req = self.requirement(i)
        self.quote(req, self.other)  # someone else keeps it alive
        self.quote(req)
        self.withdraw(req)
        self.close(req)
        return req

    def strikes(self):
        with Session(self.engine) as session:
            return len(session.exec(select(WithdrawalStrike).where(WithdrawalStrike.user_id == self.seller.id)).all())

    def actions(self):
        with Session(self.engine) as session:
            return [a.action for a in session.exec(select(ModerationAction).where(ModerationAction.user_id == self.seller.id)).all()]

    def test_withdraw_and_resubmit_never_counts(self):
        req = self.requirement(0)
        self.quote(req)
        self.withdraw(req)
        self.assertEqual(self.strikes(), 0)  # nothing at withdraw time
        self.quote(req)  # fixed and resubmitted
        self.close(req)
        self.assertEqual(self.strikes(), 0)

    def test_escalation_is_recorded_warning_then_admin_review(self):
        self.current = self.seller
        self.assertEqual(self.client.get("/requirements/withdrawal-preview").json()["next"], "recorded")

        self.backed_out(1)
        self.assertEqual(self.strikes(), 1)
        self.assertEqual(self.actions(), [])
        self.current = self.seller
        self.assertEqual(self.client.get("/requirements/withdrawal-preview").json()["next"], "warning")

        self.backed_out(2)
        self.assertEqual(self.actions(), ["warn"])
        self.current = self.seller
        self.assertEqual(self.client.get("/requirements/withdrawal-preview").json()["next"], "review")

        self.backed_out(3)
        self.assertEqual(self.actions(), ["warn"])  # no automatic suspension or ban
        with Session(self.engine) as session:
            u = session.get(User, self.seller.id)
            self.assertIsNone(u.suspended_until)
            self.assertIsNone(u.banned_at)
            reports = session.exec(select(BusinessReport).where(BusinessReport.reported_id == self.seller.id)).all()
            self.assertEqual(len(reports), 1)
            self.assertEqual(reports[0].status, "open")
            titles = [n.title for n in session.exec(select(Notification).where(Notification.user_id == self.seller.id)).all()]
        self.assertIn("Withdrawn quotation recorded", titles)
        self.assertIn("Your account is under review", titles)

        self.backed_out(4)  # still under review: no second open report
        with Session(self.engine) as session:
            self.assertEqual(len(session.exec(select(BusinessReport).where(BusinessReport.reported_id == self.seller.id)).all()), 1)

    def test_old_strikes_fall_out_of_the_window(self):
        req = self.backed_out(5)
        with Session(self.engine) as session:
            s = session.exec(select(WithdrawalStrike)).one()
            s.created_at = now_ph() - timedelta(days=91)
            session.add(s)
            session.commit()
        self.current = self.seller
        self.assertEqual(self.client.get("/requirements/withdrawal-preview").json()["next"], "recorded")


if __name__ == "__main__":
    unittest.main()
