"""One-file attachments in the award conversation. Isolated SQLite + temp uploads.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.api.routes.messages import router as messages_router
from app.core.config import settings
from app.core.security import get_current_user
from app.models.message import Message
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.repositories import message_repository as msg_repo

ARTWORK = b"%PDF-1.4 tarp layout"


class MessageAttachmentTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        self.upload_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.upload_dir.cleanup)
        for target, value in [("app.services.message_service.engine", self.engine),
                              ("app.services.message_service.UPLOAD_ROOT", self.upload_dir.name)]:
            p = patch(target, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(settings, "FILE_ENCRYPTION_KEY", Fernet.generate_key().decode())
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True))
        self.supplier = self.save(User(business_name="Supplier", role="seller", is_verified=True))
        self.stranger = self.save(User(business_name="Stranger", role="seller", is_verified=True))
        req = self.save(Requirement(ref_code="REQ-1", title="Tarps", owner_id=self.buyer.id, location="Pasig",
                                    status="awarded", closes_at=datetime.now() - timedelta(days=2)))
        q = self.save(Quotation(requirement_id=req.id, business_id=self.supplier.id, submission_hash="h",
                                status="released", total_price=6000))
        req.awarded_quotation_id = q.id
        self.save(req)
        with Session(self.engine) as session:
            self.thread_id = msg_repo.create_thread(session, req.id, self.buyer.id, self.supplier.id).id

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

    def as_(self, user):
        self.current = user
        return self.client

    def upload(self, user, name="layout.pdf", content=ARTWORK, body=None):
        data = {"body": body} if body is not None else {}
        return self.as_(user).post(f"/messages/threads/{self.thread_id}/attachments",
                                   files={"file": (name, content, "application/pdf")}, data=data)

    def test_send_and_open_attachment(self):
        r = self.upload(self.buyer, body="Final layout po")
        self.assertEqual(r.status_code, 201, r.text)
        out = r.json()
        self.assertEqual((out["body"], out["attachment_filename"], out["attachment_size"]),
                         ("Final layout po", "layout.pdf", len(ARTWORK)))

        with Session(self.engine) as session:
            stored = session.get(Message, out["id"])
        with open(stored.attachment_path, "rb") as f:
            self.assertNotEqual(f.read(), ARTWORK)  # encrypted at rest

        got = self.as_(self.supplier).get(f"/messages/threads/{self.thread_id}/messages/{out['id']}/file")
        self.assertEqual(got.status_code, 200)
        self.assertEqual(got.content, ARTWORK)

        listed = self.as_(self.supplier).get(f"/messages/threads/{self.thread_id}").json()
        self.assertEqual(listed[0]["attachment_filename"], "layout.pdf")

    def test_file_only_message_previews_the_filename(self):
        self.upload(self.supplier, name="proof.png")
        thread = self.as_(self.buyer).get("/messages/threads").json()[0]
        self.assertEqual(thread["last_message_preview"], "Sent a file: proof.png")
        self.assertTrue(thread["unread"])

    def test_stranger_cannot_upload_or_open(self):
        self.assertEqual(self.upload(self.stranger).status_code, 403)
        mid = self.upload(self.buyer).json()["id"]
        self.assertEqual(
            self.as_(self.stranger).get(f"/messages/threads/{self.thread_id}/messages/{mid}/file").status_code, 403)

    def test_rejects_bad_files(self):
        self.assertEqual(self.upload(self.buyer, name="setup.exe").status_code, 400)
        self.assertEqual(self.upload(self.buyer, name="files.zip").status_code, 400)
        self.assertEqual(self.upload(self.buyer, content=b"").status_code, 400)
        with patch("app.services.message_service.MAX_ATTACHMENT_BYTES", 5):
            self.assertEqual(self.upload(self.buyer).status_code, 413)


if __name__ == "__main__":
    unittest.main()
