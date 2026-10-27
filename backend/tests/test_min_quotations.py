"""Minimum quotations: short at closing → extended once (still sealed);
still short → archived, every quotation voided unopened. Isolated SQLite.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import unittest
from datetime import timedelta
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app.core.clock import now_ph
from app.core.config import settings
from app.models.ledger_entry import LedgerEntry
from app.models.notification import Notification
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.services.requirement_service import NotEnoughQuotations, requirement_service


class MinQuotationsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.requirement_service.engine",):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)
        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True))
        self.sellers = [self.save(User(business_name=f"S{i}", role="seller", is_verified=True)) for i in range(5)]

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def requirement(self, quotes, **kwargs):
        req = self.save(Requirement(ref_code="REQ-1", title="Tarps", owner_id=self.buyer.id, location="Pasig",
                                    category="Printing", status="open",
                                    closes_at=now_ph() - timedelta(minutes=1), **kwargs))
        for s in self.sellers[:quotes]:
            self.save(Quotation(requirement_id=req.id, business_id=s.id, submission_hash="h",
                                status="sealed", total_price=1000))
        return req

    def load(self, req):
        with Session(self.engine) as session:
            r = session.get(Requirement, req.id)
            qs = session.exec(select(Quotation).where(Quotation.requirement_id == req.id)).all()
            events = [e.event_type for e in session.exec(select(LedgerEntry)).all()]
            return r, [q.status for q in qs], events

    def test_enough_quotations_release_normally(self):
        req = self.requirement(4)
        self.assertEqual(requirement_service.release_due_requirements(), 1)
        r, statuses, _ = self.load(req)
        self.assertEqual(r.status, "closed")
        self.assertEqual(set(statuses), {"released"})

    def test_short_is_extended_once_and_stays_sealed(self):
        req = self.requirement(1)
        self.assertEqual(requirement_service.release_due_requirements(), 0)
        r, statuses, events = self.load(req)
        self.assertEqual(r.status, "open")
        self.assertIsNotNone(r.auto_extended_at)
        self.assertGreater(r.closes_at, now_ph() + timedelta(days=settings.AUTO_EXTEND_DAYS - 1))
        self.assertEqual(statuses, ["sealed"])
        self.assertIn("AUTO_EXTENDED", events)
        with Session(self.engine) as session:
            titles = {n.title for n in session.exec(select(Notification)).all()}
        self.assertIn("Closing extended — not enough quotations yet", titles)

    def test_still_short_after_extension_is_archived_unopened(self):
        req = self.requirement(2, auto_extended_at=now_ph() - timedelta(days=3))
        requirement_service.release_due_requirements()
        r, statuses, events = self.load(req)
        self.assertEqual(r.status, "insufficient_quotations")
        self.assertEqual(statuses, ["voided", "voided"])
        self.assertIn("ARCHIVED_INSUFFICIENT", events)
        self.assertNotIn("RELEASED", events)

    def test_award_needs_the_minimum(self):
        req = self.requirement(0, auto_extended_at=None)
        q = self.save(Quotation(requirement_id=req.id, business_id=self.sellers[0].id, submission_hash="h",
                                status="released", total_price=1000))
        req.status = "closed"
        self.save(req)
        with self.assertRaises(NotEnoughQuotations):
            requirement_service.award(req.id, self.buyer.id, q.id)


if __name__ == "__main__":
    unittest.main()
