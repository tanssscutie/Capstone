"""Award chat after the transaction ends: once the order is completed or did not
push through, the thread is read-only (409 on send) but stays readable.
Isolated SQLite.

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
from sqlmodel import SQLModel, Session, create_engine

from app.api.routes.messages import router as messages_router
from app.core.clock import now_ph
from app.core.security import get_current_user
from app.models.message_thread import MessageThread
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.transaction_closeout import TransactionCloseout
from app.models.user import User


class CompletedChatTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.message_service.engine", "app.services.fulfillment_service.engine"):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True))
        self.supplier = self.save(User(business_name="Supplier", role="seller", is_verified=True))
        self.req = self.save(Requirement(ref_code="REQ-1", title="Tarps", owner_id=self.buyer.id, location="Pasig",
                                         status="awarded", closes_at=now_ph() - timedelta(days=2)))
        self.quote = self.save(Quotation(requirement_id=self.req.id, business_id=self.supplier.id,
                                         submission_hash="h", status="released", total_price=6000))
        self.req.awarded_quotation_id = self.quote.id
        self.save(self.req)
        self.thread = self.save(MessageThread(requirement_id=self.req.id, buyer_id=self.buyer.id,
                                              business_id=self.supplier.id))

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

    def close_out(self, outcome):
        self.save(TransactionCloseout(requirement_id=self.req.id, outcome=outcome, proposed_by=self.buyer.id,
                                      proposed_by_role="buyer", status="confirmed", responded_by=self.supplier.id))

    def send(self, user, body="Hello"):
        self.current = user
        return self.client.post(f"/messages/threads/{self.thread.id}", json={"body": body})

    def attach(self, user):
        self.current = user
        return self.client.post(f"/messages/threads/{self.thread.id}/attachments",
                                files={"file": ("po.pdf", b"%PDF-1.4 test", "application/pdf")})

    def test_open_while_awarded(self):
        self.assertEqual(self.send(self.buyer).status_code, 201)
        threads = self.client.get("/messages/threads").json()
        self.assertFalse(threads[0]["read_only"])

    def test_read_only_after_completed(self):
        self.assertEqual(self.send(self.supplier, "Delivered today").status_code, 201)
        self.close_out("completed")
        for user in (self.buyer, self.supplier):
            r = self.send(user)
            self.assertEqual(r.status_code, 409)
            self.assertIn("stays as a record", r.json()["detail"])
            self.assertEqual(self.attach(user).status_code, 409)
        # Still readable as a record.
        self.current = self.buyer
        msgs = self.client.get(f"/messages/threads/{self.thread.id}").json()
        self.assertEqual([m["body"] for m in msgs], ["Delivered today"])
        threads = self.client.get("/messages/threads").json()
        self.assertTrue(threads[0]["read_only"])

    def test_read_only_after_not_pushed_through(self):
        self.close_out("not_pushed_through")
        self.assertEqual(self.send(self.supplier).status_code, 409)

    def test_pending_closeout_keeps_chat_open(self):
        self.save(TransactionCloseout(requirement_id=self.req.id, outcome="not_pushed_through",
                                      proposed_by=self.buyer.id, proposed_by_role="buyer"))
        self.assertEqual(self.send(self.supplier).status_code, 201)


if __name__ == "__main__":
    unittest.main()
