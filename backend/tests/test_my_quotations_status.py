"""My Quotations "what happens next" fields. Isolated SQLite.

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
from app.models.transaction_closeout import TransactionCloseout
from app.models.user import User
from app.repositories import message_repository as msg_repo
from app.services.requirement_service import requirement_service


class MyQuotationsStatusTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        p = patch("app.services.requirement_service.engine", self.engine)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)
        self.buyer = self.save(User(business_name="Buyer", role="buyer"))
        self.seller = self.save(User(business_name="Seller", role="seller"))
        self.rival = self.save(User(business_name="Rival", role="seller"))

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def setup_award(self, status, deadline=None):
        req = self.save(Requirement(ref_code="REQ-1", title="Tarps", owner_id=self.buyer.id, location="Pasig",
                                    status=status, closes_at=now_ph() - timedelta(days=1), award_response_deadline=deadline))
        mine = self.save(Quotation(requirement_id=req.id, business_id=self.seller.id, submission_hash="h",
                                   status="released", total_price=1000))
        self.save(Quotation(requirement_id=req.id, business_id=self.rival.id, submission_hash="h",
                            status="released", total_price=900))
        req.awarded_quotation_id = mine.id
        self.save(req)
        return req

    def mine(self, user=None):
        return requirement_service.list_my_quotations((user or self.seller).id)[0]

    def test_pending_award_carries_the_deadline(self):
        deadline = now_ph() + timedelta(days=3)
        self.setup_award("award_pending", deadline)
        q = self.mine()
        self.assertEqual(q.outcome, "award_pending")
        self.assertEqual(q.award_response_deadline, deadline)
        self.assertIsNone(q.thread_id)

    def test_awarded_carries_chat_and_closeout_state(self):
        req = self.setup_award("awarded")
        with Session(self.engine) as session:
            thread_id = msg_repo.create_thread(session, req.id, self.buyer.id, self.seller.id).id
        q = self.mine()
        self.assertEqual((q.thread_id, q.closeout_state, q.closeout_awaiting_me), (thread_id, "open", False))

        self.save(TransactionCloseout(requirement_id=req.id, outcome="completed", proposed_by=self.buyer.id,
                                      proposed_by_role="buyer"))
        q = self.mine()
        self.assertEqual((q.closeout_state, q.closeout_awaiting_me), ("pending", True))

    def test_the_losing_seller_gets_none_of_it(self):
        self.setup_award("awarded")
        q = self.mine(self.rival)
        self.assertEqual(q.outcome, "not_awarded")
        self.assertEqual((q.thread_id, q.closeout_state), (None, None))


if __name__ == "__main__":
    unittest.main()
