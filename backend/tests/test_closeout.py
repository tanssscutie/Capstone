"""Transaction close-out confirmed by both parties. Isolated SQLite.

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
from app.core.security import get_current_user
from app.models.ledger_entry import LedgerEntry
from app.models.message import Message
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.repositories import business_repository


class CloseoutTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.requirement_service.engine", "app.services.closeout_service.engine"):
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
        return f"/requirements/{self.req.id}/closeout{suffix}"

    def propose(self, user, outcome="completed", note=None):
        return self.as_(user).post(self.url(), json={"outcome": outcome, "note": note})

    def respond(self, user, confirm, note=None):
        return self.as_(user).post(self.url("/respond"), json={"confirm": confirm, "note": note})

    def counts(self, business):
        with Session(self.engine) as session:
            c = business_repository.profile_activity_counts(session, business.id, include_sealed=False, now=datetime.now())
        return c["transactions_completed_count"], c["transactions_not_pushed_through_count"]

    def test_completed_needs_both_parties(self):
        r = self.propose(self.buyer)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["state"], "pending")
        self.assertFalse(r.json()["awaiting_viewer"])
        self.assertTrue(self.as_(self.supplier).get(self.url()).json()["awaiting_viewer"])
        self.assertEqual(self.counts(self.buyer), (0, 0))

        # The proposer can't confirm their own claim.
        self.assertEqual(self.respond(self.buyer, True).status_code, 403)

        r = self.respond(self.supplier, True)
        self.assertEqual(r.json()["state"], "completed")
        self.assertEqual(self.counts(self.buyer), (1, 0))
        self.assertEqual(self.counts(self.supplier), (1, 0))
        self.assertEqual(self.counts(self.stranger), (0, 0))

        # Final — no further claims.
        self.assertEqual(self.propose(self.supplier, "not_pushed_through", "changed our mind").status_code, 409)

        with Session(self.engine) as session:
            events = [e.event_type for e in session.exec(select(LedgerEntry)).all()]
            messages = session.exec(select(Message)).all()
        self.assertEqual(events, ["CLOSEOUT_PROPOSED", "CLOSEOUT_CONFIRMED"])
        self.assertTrue(all(m.is_system for m in messages))
        self.assertIn("completed", messages[-1].body)

    def test_not_pushed_through_needs_reason_and_confirmation(self):
        self.assertEqual(self.propose(self.supplier, "not_pushed_through").status_code, 422)
        self.assertEqual(self.propose(self.supplier, "not_pushed_through", "Buyer cancelled the order").status_code, 200)
        r = self.respond(self.buyer, True)
        self.assertEqual(r.json()["state"], "not_pushed_through")
        self.assertEqual(self.counts(self.supplier), (0, 1))

    def test_reject_needs_reason_then_can_propose_again(self):
        self.propose(self.supplier)
        self.assertEqual(self.respond(self.buyer, False).status_code, 422)
        r = self.respond(self.buyer, False, "Still missing 20 pcs")
        self.assertEqual(r.json()["state"], "open")
        self.assertEqual(r.json()["history"][0]["response_note"], "Still missing 20 pcs")

        self.assertEqual(self.propose(self.supplier).status_code, 200)
        self.assertEqual(self.respond(self.buyer, True).json()["state"], "completed")

    def test_only_one_pending_and_withdraw(self):
        self.propose(self.buyer)
        self.assertEqual(self.propose(self.supplier).status_code, 409)
        self.assertEqual(self.as_(self.supplier).post(self.url("/withdraw")).status_code, 409)
        r = self.as_(self.buyer).post(self.url("/withdraw"))
        self.assertEqual(r.json()["state"], "open")
        self.assertEqual(r.json()["history"][0]["status"], "withdrawn")

    def test_strangers_and_unawarded_requirements_refused(self):
        self.assertEqual(self.propose(self.stranger).status_code, 403)
        self.assertEqual(self.as_(self.stranger).get(self.url()).status_code, 403)
        self.req.status = "closed"
        self.save(self.req)
        self.assertEqual(self.propose(self.buyer).status_code, 409)

    def test_unknown_outcome_rejected(self):
        self.assertEqual(self.propose(self.buyer, "delivered").status_code, 422)


if __name__ == "__main__":
    unittest.main()
