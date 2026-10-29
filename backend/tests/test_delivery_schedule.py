"""Delivery date agreed after the award: the buyer sets it, the supplier
confirms or declines (reason required, another date optional). Isolated SQLite.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import unittest
from datetime import datetime, timedelta
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
from app.models.order_update import OrderUpdate
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.services.fulfillment_service import fulfillment_service


class DeliveryScheduleTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.requirement_service.engine", "app.services.closeout_service.engine",
                       "app.services.delivery_schedule_service.engine", "app.services.fulfillment_service.engine"):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True))
        self.supplier = self.save(User(business_name="Supplier", role="seller", is_verified=True))
        self.stranger = self.save(User(business_name="Stranger", role="seller", is_verified=True))
        self.req = self.save(Requirement(ref_code="REQ-1", title="Tarps", owner_id=self.buyer.id, location="Pasig",
                                         status="awarded", closes_at=datetime.now() - timedelta(days=2)))
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
        return f"/requirements/{self.req.id}/delivery{suffix}"

    @staticmethod
    def day(offset):
        return (now_ph().date() + timedelta(days=offset)).isoformat()

    def propose(self, user, offset=5, note=None):
        return self.as_(user).post(self.url(), json={"delivery_date": self.day(offset), "note": note})

    def respond(self, user, confirm, reason=None, suggested=None):
        return self.as_(user).post(self.url("/respond"), json={
            "confirm": confirm, "reason": reason, "suggested_date": self.day(suggested) if suggested is not None else None,
        })

    def test_buyer_sets_supplier_confirms(self):
        r = self.propose(self.buyer, 5, "Gate 2, mornings")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["pending"]["delivery_date"], self.day(5))
        self.assertIsNone(r.json()["agreed_date"])
        self.assertFalse(r.json()["awaiting_viewer"])

        fulfillment = self.as_(self.supplier).get(f"/requirements/{self.req.id}/fulfillment").json()
        self.assertTrue(fulfillment["delivery"]["awaiting_viewer"])

        r = self.respond(self.supplier, True)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["agreed_date"], self.day(5))
        self.assertIsNone(r.json()["pending"])

        with Session(self.engine) as session:
            events = [e.event_type for e in session.exec(select(LedgerEntry)).all()]
            messages = session.exec(select(Message)).all()
            updates = session.exec(select(OrderUpdate)).all()
            alerts = session.exec(select(Notification).where(Notification.type == "DECISION")).all()
        self.assertEqual(events, ["DELIVERY_DATE_PROPOSED", "DELIVERY_DATE_CONFIRMED"])
        self.assertTrue(all(m.is_system for m in messages))
        self.assertIn("confirmed the delivery date", messages[-1].body)
        self.assertEqual([u.status for u in updates], ["delivery_scheduled"])
        self.assertEqual({a.user_id for a in alerts}, {self.supplier.id, self.buyer.id})

        timeline = self.as_(self.buyer).get(f"/requirements/{self.req.id}/fulfillment").json()["timeline"]
        self.assertEqual(timeline[-1]["status"], "delivery_scheduled")

    def test_only_the_buyer_proposes_and_only_the_supplier_responds(self):
        self.assertEqual(self.propose(self.supplier).status_code, 403)
        self.assertEqual(self.propose(self.stranger).status_code, 403)
        self.propose(self.buyer)
        self.assertEqual(self.respond(self.buyer, True).status_code, 403)
        self.assertEqual(self.respond(self.stranger, True).status_code, 403)

    def test_one_pending_at_a_time_and_no_past_dates(self):
        self.assertEqual(self.propose(self.buyer, -1).status_code, 422)
        self.assertEqual(self.propose(self.buyer, 0).status_code, 200)  # today is fine
        self.assertEqual(self.propose(self.buyer, 7).status_code, 409)

    def test_decline_needs_reason_and_suggested_date_can_be_used(self):
        self.propose(self.buyer, 3)
        self.assertEqual(self.respond(self.supplier, False).status_code, 422)
        self.assertEqual(self.respond(self.supplier, False, "Too soon to print", suggested=-2).status_code, 422)
        r = self.respond(self.supplier, False, "Too soon to print", suggested=6)
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertIsNone(body["agreed_date"])
        self.assertEqual(body["last_declined"]["decline_reason"], "Too soon to print")
        self.assertEqual(body["last_declined"]["suggested_date"], self.day(6))

        # The buyer applies the suggested date (one tap = propose it), the supplier confirms.
        self.assertEqual(self.propose(self.buyer, 6).status_code, 200)
        self.assertEqual(self.respond(self.supplier, True).json()["agreed_date"], self.day(6))
        with Session(self.engine) as session:
            events = [e.event_type for e in session.exec(select(LedgerEntry)).all()]
        self.assertEqual(events, ["DELIVERY_DATE_PROPOSED", "DELIVERY_DATE_DECLINED",
                                  "DELIVERY_DATE_PROPOSED", "DELIVERY_DATE_CONFIRMED"])

    def test_withdraw(self):
        self.propose(self.buyer)
        self.assertEqual(self.as_(self.supplier).post(self.url("/withdraw")).status_code, 409)
        r = self.as_(self.buyer).post(self.url("/withdraw"))
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.json()["pending"])
        self.assertEqual(r.json()["history"][0]["status"], "withdrawn")
        self.assertEqual(self.respond(self.supplier, True).status_code, 409)

    def test_reschedule_replaces_the_agreed_date(self):
        self.propose(self.buyer, 4)
        self.respond(self.supplier, True)
        self.propose(self.buyer, 9)
        r = self.respond(self.supplier, True)
        self.assertEqual(r.json()["agreed_date"], self.day(9))

    def test_unawarded_or_closed_orders_refused(self):
        self.req.fulfillment_status = "completed"
        self.save(self.req)
        self.assertEqual(self.propose(self.buyer).status_code, 409)
        self.req.status = "closed"
        self.save(self.req)
        self.assertEqual(self.propose(self.buyer).status_code, 409)

    def quiet_order(self):
        """No order step for 30 days, and the posted delivery window ended 30 days ago."""
        long_ago = now_ph() - timedelta(days=30)
        self.req.fulfillment_status = "awarded"
        self.req.fulfillment_updated_at = long_ago
        self.req.delivery_end = long_ago
        self.save(self.req)

    def test_unconfirmed_check_uses_the_agreed_date(self):
        self.quiet_order()
        self.propose(self.buyer, 3)
        self.respond(self.supplier, True)
        with patch("app.services.email_service.send_alert_email"):
            done = fulfillment_service.run_due()
        self.assertEqual(done["unconfirmed"], 0)

    def test_without_an_agreed_date_the_window_still_applies(self):
        self.quiet_order()
        with patch("app.services.email_service.send_alert_email"):
            done = fulfillment_service.run_due()
        self.assertEqual(done["unconfirmed"], 1)


if __name__ == "__main__":
    unittest.main()
