"""Opening requirement and quotation attachments: encrypted at rest, and a
quotation's files stay sealed with it. Isolated SQLite, temp working dir.

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

from app.api.routes.requirements import router as requirements_router
from app.core.config import settings
from app.core.security import get_current_user
from app.models.quotation import Quotation
from app.models.quotation_attachment import QuotationAttachment
from app.models.requirement import Requirement
from app.models.requirement_attachment import RequirementAttachment
from app.models.user import User

from pdf_fixtures import make_pdf
DRAWING = make_pdf("layout drawing")
CERT = make_pdf("FDA certificate")


class AttachmentDownloadTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        p = patch("app.services.requirement_service.engine", self.engine)
        p.start()
        self.addCleanup(p.stop)
        p = patch.object(settings, "FILE_ENCRYPTION_KEY", Fernet.generate_key().decode())
        p.start()
        self.addCleanup(p.stop)
        # Never the live AI document check in tests (see test_document_check.py).
        p = patch.object(settings, "GEMINI_API_KEY", "")
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)
        # Uploads go to a relative "uploads/" — keep them out of the real one.
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        cwd = os.getcwd()
        os.chdir(tmp.name)
        self.addCleanup(os.chdir, cwd)

        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True))
        self.seller = self.save(User(business_name="Seller", role="seller", is_verified=True))
        self.rival = self.save(User(business_name="Rival", role="seller", is_verified=True))
        self.admin = self.save(User(business_name="Admin", is_admin=True))
        self.req = self.save(Requirement(ref_code="REQ-1", title="Tarps", owner_id=self.buyer.id, location="Pasig",
                                         status="open", closes_at=datetime.now() + timedelta(days=1)))
        self.quote = self.save(Quotation(requirement_id=self.req.id, business_id=self.seller.id,
                                         submission_hash="h", status="sealed", total_price=5000))

        self.current = self.buyer
        app = FastAPI()
        app.include_router(requirements_router, prefix="/requirements")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

        self.as_(self.buyer).post(f"/requirements/{self.req.id}/attachments", files={"file": ("layout.pdf", DRAWING)})
        self.as_(self.seller).post(f"/requirements/{self.req.id}/quotations/{self.quote.id}/attachments",
                                   files={"file": ("fda.pdf", CERT)}, data={"document_label": "FDA certificate"})
        with Session(self.engine) as session:
            self.req_att = session.query(RequirementAttachment).one()
            self.quote_att = session.query(QuotationAttachment).one()

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

    def quote_file(self, user):
        return self.as_(user).get(
            f"/requirements/{self.req.id}/quotations/{self.quote.id}/attachments/{self.quote_att.id}/file")

    def release(self):
        self.quote.status = "released"
        self.save(self.quote)
        self.req.status = "closed"
        self.save(self.req)

    def test_files_are_encrypted_at_rest(self):
        for path, plain in ((self.req_att.file_path, DRAWING), (self.quote_att.file_path, CERT)):
            with open(path, "rb") as f:
                self.assertNotEqual(f.read(), plain)

    def test_requirement_attachment_opens_for_any_signed_in_business(self):
        for user in (self.buyer, self.seller, self.rival):
            r = self.as_(user).get(f"/requirements/{self.req.id}/attachments/{self.req_att.id}/file")
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.content, DRAWING)
            self.assertEqual(r.headers["content-type"], "application/pdf")

    def test_quotation_attachment_is_sealed_until_release(self):
        self.assertEqual(self.quote_file(self.seller).content, CERT)  # own, any time
        self.assertEqual(self.quote_file(self.buyer).status_code, 409)  # sealed
        self.assertEqual(self.quote_file(self.admin).status_code, 409)
        self.assertEqual(self.quote_file(self.rival).status_code, 403)

        self.release()
        self.assertEqual(self.quote_file(self.buyer).content, CERT)
        self.assertEqual(self.quote_file(self.admin).content, CERT)
        self.assertEqual(self.quote_file(self.rival).status_code, 403)  # never a competitor

    def test_legacy_unencrypted_file_still_opens(self):
        with open(self.req_att.file_path, "wb") as f:
            f.write(DRAWING)  # as written before encryption existed
        r = self.as_(self.seller).get(f"/requirements/{self.req.id}/attachments/{self.req_att.id}/file")
        self.assertEqual(r.content, DRAWING)

    def test_ids_must_belong_together(self):
        other = self.save(Requirement(ref_code="REQ-2", title="Boxes", owner_id=self.buyer.id, location="Pasig",
                                      status="open", closes_at=datetime.now() + timedelta(days=1)))
        r = self.as_(self.buyer).get(f"/requirements/{other.id}/attachments/{self.req_att.id}/file")
        self.assertEqual(r.status_code, 404)


if __name__ == "__main__":
    unittest.main()
