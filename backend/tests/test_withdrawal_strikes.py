"""Withdrawal policy (withdrawal_policy): every withdrawal is a strike the
moment it happens — even one resubmitted before closing — and needs a reason.
Within 90 days: 1st a formal warning, 2nd "subject for suspension", 3rd
"subject for ban" (an automatic report; an administrator decides, nothing is
automatic). Every strike alerts and emails the supplier whatever their
settings. The reason stays with administrators, never the buyer. Isolated
SQLite; email is mocked.

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
from sqlmodel import SQLModel, Session, create_engine, select

from app.api.routes.requirements import router as requirements_router
from app.core.clock import now_ph
from app.core.security import get_current_user
from app.models.business_report import BusinessReport
from app.models.ledger_entry import LedgerEntry
from app.models.moderation_action import ModerationAction
from app.models.notification import Notification
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.models.withdrawal_strike import WithdrawalStrike
from app.services.report_service import report_service
from pdf_fixtures import make_png

SECRET = "our resin supplier raised prices by 18 percent"


class WithdrawalStrikeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.admin_audit.engine", "app.services.requirement_service.engine", "app.services.moderation_service.engine",
                       "app.services.report_service.engine"):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        self.email = patch("app.services.email_service.send_alert_email").start()
        self.addCleanup(patch.stopall)
        # Proof files are written under ./uploads — keep them out of the repo.
        cwd = os.getcwd()
        tmp = tempfile.TemporaryDirectory()
        os.chdir(tmp.name)
        self.addCleanup(tmp.cleanup)
        self.addCleanup(os.chdir, cwd)
        self.addCleanup(self.engine.dispose)

        self.admin = self.save(User(business_name="Admin", is_admin=True))
        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True))
        # Alerts and email both switched off — strike notices must arrive anyway.
        self.seller = self.save(User(business_name="Seller", role="seller", is_verified=True, email="s@example.com",
                                     notify_email=False, notify_activity=False))
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

    def quote(self, req):
        self.current = self.seller
        r = self.client.post(f"/requirements/{req.id}/quotations", json={"total_price": 1000})
        self.assertEqual(r.status_code, 201, r.text)

    def withdraw(self, req, code="cost_changed", details=SECRET, files=None, expect=204):
        self.current = self.seller
        data = {"reason_code": code}
        if details is not None:
            data["reason_details"] = details
        r = self.client.post(f"/requirements/{req.id}/quotations/withdraw", data=data, files=files)
        self.assertEqual(r.status_code, expect, r.text)
        return r

    def quote_and_withdraw(self, i):
        req = self.requirement(i)
        self.quote(req)
        self.withdraw(req)
        return req

    def strikes(self):
        with Session(self.engine) as session:
            return session.exec(select(WithdrawalStrike).where(WithdrawalStrike.user_id == self.seller.id)).all()

    def actions(self):
        with Session(self.engine) as session:
            return [a.action for a in session.exec(select(ModerationAction).where(ModerationAction.user_id == self.seller.id)).all()]

    def preview(self):
        self.current = self.seller
        return self.client.get("/requirements/withdrawal-preview").json()

    def test_a_reason_is_required(self):
        req = self.requirement(0)
        self.quote(req)
        self.withdraw(req, code="", details=None, expect=422)
        self.withdraw(req, code="made_up", expect=422)
        self.withdraw(req, code="other", details="too short", expect=422)  # "Other" needs a real explanation
        with Session(self.engine) as session:
            self.assertEqual(session.exec(select(Quotation)).one().status, "sealed")  # nothing withdrawn
        self.assertEqual(self.strikes(), [])
        self.withdraw(req, code="pricing_error", details=None)  # a suggested reason alone is enough
        self.assertEqual(len(self.strikes()), 1)

    def test_withdraw_and_resubmit_still_counts(self):
        req = self.requirement(1)
        self.quote(req)
        self.withdraw(req)
        self.quote(req)  # resubmitted before closing
        self.withdraw(req, code="wrong_details", details=None)
        self.assertEqual(len(self.strikes()), 2)

    def test_escalation_is_warning_then_suspension_then_ban_review(self):
        first = self.preview()
        self.assertEqual((first["next"], first["next_number"]), ("warning", 1))
        self.assertIn("cost_changed", [r["code"] for r in first["reasons"]])

        self.quote_and_withdraw(1)
        self.assertEqual(self.actions(), ["warn"])
        self.assertEqual(self.preview()["next"], "suspension")

        self.quote_and_withdraw(2)
        self.assertEqual(self.actions(), ["warn"])
        with Session(self.engine) as session:
            report = session.exec(select(BusinessReport).where(BusinessReport.reported_id == self.seller.id)).one()
            self.assertEqual((report.reason, report.status, report.recommended_action), ("WITHDRAWALS", "open", "suspend_7"))
        self.assertEqual(self.preview()["next"], "ban")

        self.quote_and_withdraw(3)
        with Session(self.engine) as session:
            reports = session.exec(select(BusinessReport).where(BusinessReport.reported_id == self.seller.id)).all()
            self.assertEqual(len(reports), 1)  # the same review, moved up a stage
            self.assertEqual(reports[0].recommended_action, "ban")
            u = session.get(User, self.seller.id)
            self.assertIsNone(u.suspended_until)  # an administrator decides — nothing automatic
            self.assertIsNone(u.banned_at)
            titles = [n.title for n in session.exec(select(Notification).where(Notification.user_id == self.seller.id)).all()]
        self.assertEqual(self.actions(), ["warn"])
        self.assertEqual(titles, ["Warning from TrustLink", "Your account is subject for suspension",
                                  "Your account is subject for ban"])
        self.assertEqual(self.email.call_count, 3)  # every strike emailed, even with email alerts off

        listed = next(r for r in report_service.list_for_admin() if r.reason == "WITHDRAWALS")
        self.assertEqual(listed.recommended_action, "ban")
        self.assertEqual(len(listed.withdrawals), 3)
        self.assertEqual(listed.withdrawals[0].reason_label, "Supplier or material cost changed")
        self.assertEqual(listed.withdrawals[0].reason_details, SECRET)

    def test_old_strikes_fall_out_of_the_window(self):
        self.quote_and_withdraw(5)
        with Session(self.engine) as session:
            s = session.exec(select(WithdrawalStrike)).one()
            s.created_at = now_ph() - timedelta(days=91)
            session.add(s)
            session.commit()
        self.assertEqual(self.preview()["next"], "warning")

    def test_proof_is_stored_for_admins_only(self):
        req = self.requirement(6)
        self.quote(req)
        self.withdraw(req, files={"file": ("receipt.png", make_png(), "image/png")})
        strike = self.strikes()[0]
        self.assertTrue(strike.proof_path)
        self.assertEqual(self.client.get(f"/requirements/admin/withdrawals/{strike.id}/proof").status_code, 403)
        self.current = self.admin
        r = self.client.get(f"/requirements/admin/withdrawals/{strike.id}/proof")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.content, make_png())

    def test_reason_never_reaches_the_buyer(self):
        req = self.quote_and_withdraw(7)
        with Session(self.engine) as session:
            buyer_alerts = session.exec(select(Notification).where(Notification.user_id == self.buyer.id)).all()
            ledger = session.exec(select(LedgerEntry).where(LedgerEntry.requirement_id == req.id)).all()
        self.assertFalse(any(SECRET in (n.title + n.detail) for n in buyer_alerts))
        self.assertFalse(any(SECRET in str(e.model_dump()) for e in ledger))
        self.current = self.buyer
        self.assertNotIn(SECRET, self.client.get(f"/requirements/{req.id}").text)


if __name__ == "__main__":
    unittest.main()
