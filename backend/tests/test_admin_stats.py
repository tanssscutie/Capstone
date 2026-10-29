"""Admin dashboard: GET /business/admin/stats — needs-action counters,
marketplace and trust aggregates (grouped in Python, so SQLite works), and
the verification review recording which administrator decided.

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
from app.core.clock import now_ph
from app.core.security import get_current_user
from app.models.business_document import BusinessDocument
from app.models.business_report import BusinessReport
from app.models.delivery_schedule import DeliverySchedule
from app.models.profile_change_request import ProfileChangeRequest
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.transaction_closeout import TransactionCloseout
from app.models.user import User
from app.models.verification_review import VerificationReview
from app.models.withdrawal_strike import WithdrawalStrike


class AdminStatsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.business_service.engine", "app.services.requirement_service.engine",
                       "app.services.fulfillment_service.engine", "app.services.closeout_service.engine"):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)
        self.now = now_ph()

        self.admin = self.save(User(business_name="Admin Ana", is_admin=True))
        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True,
                                    verification_status="verified", tier=2))
        self.seller = self.save(User(business_name="Seller", role="seller", is_verified=True,
                                     verification_status="verified", tier=1))
        self.waiting = self.save(User(business_name="Waiting", role="seller", verification_status="submitted",
                                      submitted_at=self.now - timedelta(days=4, hours=2)))
        self.save(User(business_name="Suspended", role="seller", suspended_until=self.now + timedelta(days=3)))
        self.save(User(business_name="Banned", role="seller", banned_at=self.now, is_active=False))

        for ai in ("other_document", "not_checked", "expected"):
            self.save(BusinessDocument(user_id=self.waiting.id, doc_type="DTI", file_path="x", declared_owner_name="a",
                                       declared_business_name="b", declared_id_number="1", ai_check=ai))
        self.save(BusinessReport(reporter_id=self.buyer.id, reported_id=self.seller.id, reason="SCAM", details="x"))
        self.save(BusinessReport(reporter_id=self.admin.id, reported_id=self.seller.id, reason="WITHDRAWALS", details="x"))
        self.save(BusinessReport(reporter_id=self.buyer.id, reported_id=self.seller.id, reason="SCAM", details="x",
                                 status="dismissed"))
        self.save(ProfileChangeRequest(user_id=self.seller.id, changes_json="{}", reason="moved"))

        seq = iter(range(1, 100))

        def req(status, city="Pasig", category="Printing", **kw):
            return self.save(Requirement(ref_code=f"R-{next(seq)}", title="t", owner_id=self.buyer.id, location=city,
                                         city=city, category=category, status=status,
                                         closes_at=kw.pop("closes_at", self.now + timedelta(days=3)), **kw))

        req("open", closes_at=self.now.replace(hour=23, minute=0))  # closes today
        req("open", city="Makati")
        req("cancelled", city="Makati", category="Packaging & Labeling")
        req("insufficient_quotations", city="Taguig")
        req("closed", released_at=self.now)
        req("award_pending", released_at=self.now)
        overdue = req("awarded", released_at=self.now, delivery_end=self.now - timedelta(days=2), fulfillment_status="awarded")
        done = req("awarded", city="Taguig", released_at=self.now, fulfillment_status="completed")
        scheduled = req("awarded", released_at=self.now, delivery_end=self.now - timedelta(days=2),
                        fulfillment_status="awarded")
        req("awarded", released_at=self.now, fulfillment_status="unconfirmed")
        for r in (overdue, done, scheduled):
            q = self.save(Quotation(requirement_id=r.id, business_id=self.seller.id, submission_hash="h", status="released"))
            r.awarded_quotation_id = q.id
            self.save(r)
        self.save(Quotation(requirement_id=overdue.id, business_id=self.seller.id, submission_hash="h", status="withdrawn"))
        self.save(TransactionCloseout(requirement_id=done.id, outcome="completed", proposed_by=self.seller.id,
                                      proposed_by_role="supplier", status="confirmed"))
        # An agreed date in the future: no longer overdue, even though the posted window passed.
        self.save(DeliverySchedule(requirement_id=scheduled.id, delivery_date=(self.now + timedelta(days=5)).date(),
                                   proposed_by=self.buyer.id, status="confirmed"))
        self.save(DeliverySchedule(requirement_id=overdue.id, delivery_date=(self.now + timedelta(days=5)).date(),
                                   proposed_by=self.buyer.id))
        self.save(WithdrawalStrike(user_id=self.seller.id, requirement_id=overdue.id))
        self.save(WithdrawalStrike(user_id=self.seller.id, requirement_id=overdue.id,
                                   created_at=self.now - timedelta(days=120)))

        self.current = self.admin
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

    def stats(self):
        r = self.client.get("/business/admin/stats")
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_needs_action(self):
        n = self.stats()["needs_action"]
        self.assertEqual(n["verification_queue"], 1)
        self.assertEqual(n["oldest_waiting_days"], 4)
        self.assertEqual((n["documents_different"], n["documents_not_checked"]), (1, 1))
        self.assertEqual((n["open_reports"], n["withdrawal_flags"]), (2, 1))
        self.assertEqual(n["pending_change_requests"], 1)
        self.assertEqual(n["awards_awaiting_supplier"], 1)
        self.assertEqual(n["delivery_dates_awaiting_reply"], 1)
        self.assertEqual(n["overdue_orders"], 1)
        self.assertEqual(n["unconfirmed_orders"], 1)

    def test_marketplace(self):
        m = self.stats()["marketplace"]
        self.assertEqual((m["open"], m["closing_today"], m["released"], m["award_pending"]), (2, 1, 1, 1))
        self.assertEqual((m["awarded"], m["archived_insufficient"], m["cancelled"]), (4, 1, 1))
        self.assertEqual((m["posted"], m["reached_release"], m["reached_award"], m["completed"]), (10, 6, 4, 1))
        self.assertEqual(m["completion_rate"], 0.25)
        self.assertEqual(m["avg_quotations_per_requirement"], 0.3)  # 3 active of 4, over 10 posted
        self.assertEqual(m["top_categories"][0], {"label": "Printing", "count": 9})
        self.assertEqual(m["top_cities"][0], {"label": "Pasig", "count": 6})

    def test_trust_and_review_audit(self):
        before = self.stats()["trust"]
        self.assertIsNone(before["approval_rate"])
        self.assertEqual(before["withdrawals_90_days"], 1)
        self.assertEqual((before["suspended"], before["banned"]), (1, 1))
        self.assertEqual(before["tiers"], [{"label": "Tier 1", "count": 1}, {"label": "Tier 2", "count": 1},
                                           {"label": "Tier 3", "count": 0}])

        r = self.client.post(f"/business/admin/{self.waiting.id}/review", json={"approve": False, "notes": "Blurry DTI"})
        self.assertEqual(r.status_code, 204, r.text)
        with Session(self.engine) as session:
            review = session.exec(select(VerificationReview)).one()
        self.assertEqual(review.admin_id, self.admin.id)
        self.assertFalse(review.approved)
        self.assertEqual(review.result_status, "rejected")
        self.assertEqual(review.notes, "Blurry DTI")

        after = self.stats()["trust"]
        self.assertEqual((after["reviews_total"], after["approval_rate"]), (1, 0.0))
        self.assertAlmostEqual(after["avg_review_hours"], 98, delta=1)

        roster = {b["business_name"]: b for b in self.client.get("/business/admin/businesses").json()}
        self.assertEqual(roster["Waiting"]["last_review"]["admin_name"], "Admin Ana")
        self.assertIsNone(roster["Seller"]["last_review"])

    def test_businesses_cannot_see_stats(self):
        self.current = self.seller
        self.assertEqual(self.client.get("/business/admin/stats").status_code, 403)


if __name__ == "__main__":
    unittest.main()
