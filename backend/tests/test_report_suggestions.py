"""Report suggestions: only businesses you actually transacted with (released
quotations), both directions, newest first. Isolated SQLite.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import unittest
from datetime import timedelta
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.core.clock import now_ph
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.services.report_service import report_service


class ReportSuggestionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        p = patch("app.services.report_service.engine", self.engine)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)
        self.me = self.save(User(business_name="Me", role="buyer", is_verified=True))
        self.old_supplier = self.save(User(business_name="Old Supplier", role="seller"))
        self.new_supplier = self.save(User(business_name="New Supplier", role="seller"))
        self.sealed_supplier = self.save(User(business_name="Sealed", role="seller"))
        self.other_buyer = self.save(User(business_name="Other Buyer", role="buyer"))
        self.stranger = self.save(User(business_name="Stranger", role="seller"))
        self.admin = self.save(User(business_name="Admin", role="buyer", is_admin=True))

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def req(self, owner, ref):
        return self.save(Requirement(ref_code=ref, title="Tarps", owner_id=owner.id, location="Pasig",
                                     category="Printing", status="closed", closes_at=now_ph()))

    def quote(self, req, seller, released_days_ago):
        released = None if released_days_ago is None else now_ph() - timedelta(days=released_days_ago)
        self.save(Quotation(requirement_id=req.id, business_id=seller.id, submission_hash="h",
                            status="released" if released else "sealed", total_price=1, released_at=released))

    def test_counterparties_newest_first(self):
        mine = self.req(self.me, "REQ-1")
        self.quote(mine, self.old_supplier, 10)
        self.quote(mine, self.new_supplier, 1)
        self.quote(mine, self.sealed_supplier, None)
        self.quote(mine, self.admin, 2)
        theirs = self.req(self.other_buyer, "REQ-2")
        self.quote(theirs, self.me, 5)
        self.quote(theirs, self.stranger, 5)  # a competitor on someone else's posting

        out = report_service.suggestions(self.me.id)
        self.assertEqual([s.name for s in out], ["New Supplier", "Other Buyer", "Old Supplier"])
        self.assertEqual(out[1].relation, "buyer")
        self.assertEqual(out[0].relation, "supplier")
        self.assertEqual(out[0].context, "REQ-1 · Tarps")

    def test_limit(self):
        mine = self.req(self.me, "REQ-1")
        for i in range(10):
            self.quote(mine, self.save(User(business_name=f"S{i}", role="seller")), i + 1)
        self.assertEqual(len(report_service.suggestions(self.me.id)), 8)


if __name__ == "__main__":
    unittest.main()
