"""Order status (fulfillment_service): supplier steps forward, buyer confirms,
reminders, auto-confirm, Unconfirmed, completion rate. Isolated SQLite.

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
from app.models.ledger_entry import LedgerEntry
from app.models.message import Message
from app.models.notification import Notification
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.repositories import business_repository
from app.services.fulfillment_service import fulfillment_service


class FulfillmentTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.requirement_service.engine", "app.services.closeout_service.engine",
                       "app.services.fulfillment_service.engine"):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True))
        self.supplier = self.save(User(business_name="Supplier", role="seller", is_verified=True))
        self.stranger = self.save(User(business_name="Stranger", role="seller", is_verified=True))
        self.req = self.save(Requirement(ref_code="REQ-1", title="Tarps", owner_id=self.buyer.id, location="Pasig",
                                         status="awarded", closes_at=now_ph() - timedelta(days=2),
                                         fulfillment_updated_at=now_ph()))
        self.quote = self.save(Quotation(requirement_id=self.req.id, business_id=self.supplier.id,
                                         submission_hash="h", status="released", total_price=6000))
        self.req.awarded_quotation_id = self.quote.id
        self.save(self.req)

        self.current = self.buyer
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

    def as_(self, user):
        self.current = user
        return self.client

    def url(self, suffix=""):
        return f"/requirements/{self.req.id}/fulfillment{suffix}"

    def step(self, user, status_, note=None):
        return self.as_(user).post(self.url(), json={"status": status_, "note": note})

    def load(self):
        with Session(self.engine) as session:
            return session.get(Requirement, self.req.id)

    def set_idle(self, days, **fields):
        with Session(self.engine) as session:
            req = session.get(Requirement, self.req.id)
            req.fulfillment_updated_at = now_ph() - timedelta(days=days)
            for k, v in fields.items():
                setattr(req, k, v)
            session.add(req)
            session.commit()

    def counts(self, business):
        with Session(self.engine) as session:
            return business_repository.profile_activity_counts(session, business.id, include_sealed=False, now=now_ph())

    def test_only_supplier_marks_completed(self):
        self.assertEqual(self.step(self.buyer, "delivered").status_code, 403)
        self.assertEqual(self.step(self.stranger, "delivered").status_code, 403)
        # The retired steps are refused.
        self.assertEqual(self.step(self.supplier, "in_production").status_code, 422)
        self.assertEqual(self.step(self.supplier, "out_for_delivery").status_code, 422)
        self.assertEqual(self.step(self.supplier, "bogus").status_code, 422)
        r = self.as_(self.supplier).get(self.url())
        self.assertEqual(r.json()["next_status"], "delivered")
        r = self.step(self.supplier, "delivered", "Handed over at the warehouse")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["status"], "delivered")
        self.assertIsNone(r.json()["next_status"])
        self.assertEqual(r.json()["next_action"], "buyer_confirm")
        self.assertEqual(self.step(self.supplier, "delivered").status_code, 409)
        with Session(self.engine) as session:
            self.assertIn("FULFILLMENT_UPDATED", [e.event_type for e in session.exec(select(LedgerEntry)).all()])
            self.assertTrue(any("marked this order as completed" in m.body for m in session.exec(select(Message)).all()))
            alerts = session.exec(select(Notification).where(Notification.user_id == self.buyer.id)).all()
            self.assertTrue(any(a.title == "Order marked as completed — please confirm" for a in alerts))

    def test_retired_steps_read_as_awarded(self):
        self.set_idle(0, fulfillment_status="out_for_delivery")
        r = self.as_(self.buyer).get(self.url())
        self.assertEqual(r.json()["status"], "awarded")
        self.assertEqual(r.json()["next_action"], "seller_update")
        self.assertEqual(self.as_(self.supplier).get(self.url()).json()["next_status"], "delivered")
        self.assertEqual(self.step(self.supplier, "delivered").status_code, 200)
        # The scheduler still sees these orders.
        self.set_idle(3, fulfillment_status="in_production")
        self.assertEqual(fulfillment_service.run_due()["reminded"], 1)

    def test_buyer_confirms_only_when_delivered_and_counts(self):
        self.assertEqual(self.as_(self.buyer).post(self.url("/confirm"), json={}).status_code, 409)
        self.step(self.supplier, "delivered")
        self.assertEqual(self.as_(self.supplier).post(self.url("/confirm"), json={}).status_code, 403)
        r = self.as_(self.buyer).post(self.url("/confirm"), json={"note": "All good"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["status"], "completed")
        self.assertIsNone(r.json()["next_action"])
        c = self.counts(self.supplier)
        self.assertEqual(c["transactions_completed_count"], 1)
        self.assertEqual(c["completion_rate"], 1.0)
        self.assertEqual(self.step(self.supplier, "delivered").status_code, 409)

    def test_next_action_is_viewers(self):
        r = self.as_(self.buyer).get(self.url())
        self.assertEqual(r.json()["next_action"], "seller_update")
        self.assertEqual(r.json()["next_action_by"], "supplier")
        self.assertEqual(self.as_(self.stranger).get(self.url()).status_code, 403)

    def test_reminders_at_3_and_7_days_once_each(self):
        self.set_idle(3)
        self.assertEqual(fulfillment_service.run_due()["reminded"], 1)
        self.assertEqual(fulfillment_service.run_due()["reminded"], 0)
        self.set_idle(7, fulfillment_reminders=1)
        self.assertEqual(fulfillment_service.run_due()["reminded"], 1)
        with Session(self.engine) as session:
            to = {n.user_id for n in session.exec(select(Notification)).all()}
        self.assertEqual(to, {self.supplier.id})

    def test_delivered_auto_confirms_after_14_days(self):
        self.step(self.supplier, "delivered")
        self.set_idle(13)
        fulfillment_service.run_due()
        self.assertEqual(self.load().fulfillment_status, "delivered")
        self.set_idle(14)
        self.assertEqual(fulfillment_service.run_due()["auto_confirmed"], 1)
        r = self.as_(self.buyer).get(self.url())
        self.assertEqual(r.json()["status"], "completed")
        self.assertTrue(r.json()["auto_confirmed"])
        self.assertEqual(self.counts(self.buyer)["transactions_completed_count"], 1)

    def test_no_updates_becomes_unconfirmed(self):
        self.set_idle(20, delivery_end=now_ph() - timedelta(days=10))
        self.assertEqual(fulfillment_service.run_due()["unconfirmed"], 0)  # window + 14 not reached
        self.set_idle(20, delivery_end=now_ph() - timedelta(days=15))
        self.assertEqual(fulfillment_service.run_due()["unconfirmed"], 1)
        c = self.counts(self.supplier)
        self.assertEqual(c["transactions_unconfirmed_count"], 1)
        self.assertEqual(c["transactions_completed_count"], 0)
        self.assertEqual(c["transactions_not_pushed_through_count"], 0)
        self.assertEqual(c["completion_rate"], 0.0)

    def test_did_not_push_through_ends_the_order(self):
        self.as_(self.buyer).post(f"/requirements/{self.req.id}/closeout",
                                  json={"outcome": "not_pushed_through", "note": "Supplier stopped replying"})
        self.assertEqual(self.step(self.supplier, "delivered").status_code, 409)
        self.as_(self.supplier).post(f"/requirements/{self.req.id}/closeout/respond", json={"confirm": True})
        r = self.as_(self.buyer).get(self.url())
        self.assertEqual(r.json()["status"], "not_pushed_through")
        self.assertEqual(self.load().fulfillment_status, "not_pushed_through")


if __name__ == "__main__":
    unittest.main()
