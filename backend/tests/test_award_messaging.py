"""Post-award messaging: a thread opens only for the confirmed winner, starting
with a system message. Isolated SQLite.

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

from app.api.routes.messages import router as messages_router
from app.core.security import get_current_user
from app.models.message import Message
from app.models.message_thread import MessageThread
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.repositories import message_repository as msg_repo
from app.services.requirement_service import requirement_service


class AwardMessagingTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.requirement_service.engine", "app.services.message_service.engine",
                       "app.services.business_service.engine"):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True,
                                    contact_person="Juan Dela Cruz", contact_mobile="09171234567"))
        self.winner = self.save(User(business_name="Winner", role="seller", is_verified=True,
                                     contact_person="Maria Santos", contact_mobile="09181234567"))
        self.loser = self.save(User(business_name="Loser", role="seller", is_verified=True))
        self.req = self.save(Requirement(ref_code="REQ-1", title="Tarps", owner_id=self.buyer.id, location="Pasig",
                                         status="open", closes_at=datetime.now() - timedelta(minutes=1)))
        self.win_q = self.quote(self.winner, 12500)
        self.lose_q = self.quote(self.loser, 15000)

        self.current = self.buyer
        app = FastAPI()
        app.include_router(messages_router, prefix="/messages")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def quote(self, business, price):
        return self.save(Quotation(requirement_id=self.req.id, business_id=business.id, submission_hash="h",
                                   status="sealed", total_price=price))

    def threads(self, user):
        self.current = user
        return self.client.get("/messages/threads").json()

    def release_and_award(self):
        with Session(self.engine) as session:
            requirement_service._release_one(session, session.get(Requirement, self.req.id))
        requirement_service.award(self.req.id, self.buyer.id, self.win_q.id)
        requirement_service.accept_award(self.req.id, self.winner.id)

    def test_release_opens_no_thread(self):
        with Session(self.engine) as session:
            requirement_service._release_one(session, session.get(Requirement, self.req.id))
            self.assertEqual(session.exec(select(MessageThread)).all(), [])

    def test_award_pending_still_no_thread(self):
        with Session(self.engine) as session:
            requirement_service._release_one(session, session.get(Requirement, self.req.id))
        requirement_service.award(self.req.id, self.buyer.id, self.win_q.id)
        self.assertEqual(self.threads(self.buyer), [])

    def test_accept_opens_thread_with_system_message(self):
        self.release_and_award()

        buyer_threads = self.threads(self.buyer)
        self.assertEqual(len(buyer_threads), 1)
        self.assertEqual(buyer_threads[0]["counterparty_id"], self.winner.id)
        self.assertTrue(buyer_threads[0]["unread"])
        self.assertEqual(len(self.threads(self.winner)), 1)
        self.assertEqual(self.threads(self.loser), [])

        self.current = self.buyer
        messages = self.client.get(f"/messages/threads/{buyer_threads[0]['id']}").json()
        self.assertEqual(len(messages), 1)
        body = messages[0]["body"]
        self.assertTrue(messages[0]["is_system"])
        for expected in ("REQ-1", f"QT-{self.win_q.id:06d}", "₱12,500.00", "Juan Dela Cruz · 09171234567",
                         "Maria Santos · 09181234567"):
            self.assertIn(expected, body)

        self.current = self.winner
        sent = self.client.post(f"/messages/threads/{buyer_threads[0]['id']}", json={"body": "Salamat po!"})
        self.assertEqual(sent.status_code, 201)
        self.assertFalse(sent.json()["is_system"])

    def test_legacy_release_thread_for_loser_is_hidden_and_refused(self):
        with Session(self.engine) as session:
            legacy = msg_repo.create_thread(session, requirement_id=self.req.id, buyer_id=self.buyer.id,
                                            business_id=self.loser.id)
            legacy_id = legacy.id
        self.release_and_award()

        self.assertEqual(self.threads(self.loser), [])
        self.current = self.loser
        self.assertEqual(self.client.post(f"/messages/threads/{legacy_id}", json={"body": "hi"}).status_code, 404)

    def test_failed_system_message_does_not_fail_accept_and_backfill_repairs_it(self):
        with patch("app.services.requirement_service.msg_repo.create_message", side_effect=RuntimeError("Data too long")):
            self.release_and_award()  # must not raise
        with Session(self.engine) as session:
            self.assertEqual(session.get(Requirement, self.req.id).status, "awarded")
            self.assertEqual(session.exec(select(Message)).all(), [])

        self.assertEqual(requirement_service.backfill_award_threads(), 1)
        self.assertEqual(requirement_service.backfill_award_threads(), 0)  # idempotent
        with Session(self.engine) as session:
            messages = session.exec(select(Message)).all()
        self.assertEqual([m.is_system for m in messages], [True])

    def test_legacy_thread_for_winner_is_reused(self):
        with Session(self.engine) as session:
            msg_repo.create_thread(session, requirement_id=self.req.id, buyer_id=self.buyer.id,
                                   business_id=self.winner.id)
        self.release_and_award()
        with Session(self.engine) as session:
            self.assertEqual(len(session.exec(select(MessageThread)).all()), 1)
            self.assertEqual(len(session.exec(select(Message)).all()), 1)


if __name__ == "__main__":
    unittest.main()
