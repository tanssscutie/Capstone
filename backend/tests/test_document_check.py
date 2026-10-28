"""AI document check (document_extraction_service.check_*): a clear
non-document (selfie, random photo) is refused with a friendly message, a
different document needs the uploader to confirm, and with Gemini unavailable
the upload goes through marked "not auto-checked" for the admin. Covers
onboarding documents and quotation attachments filed under a required
document. Gemini is mocked; isolated SQLite and a temp upload folder.

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
from sqlmodel import SQLModel, Session, create_engine, select

from app.api.routes.business import router as business_router
from app.api.routes.requirements import router as requirements_router
from app.core.config import settings
from app.core.security import get_current_user
from app.models.business_document import BusinessDocument
from app.models.quotation import Quotation
from app.models.quotation_attachment import QuotationAttachment
from app.models.requirement import Requirement
from app.models.user import User
from app.services import document_extraction_service as svc
from pdf_fixtures import make_png

SELFIE = svc._DocumentCheck(verdict="not_a_document", detected_type="a selfie", reason="A person's face.")
DTI = svc._DocumentCheck(verdict="other_document", detected_type="a DTI certificate", reason="Shows a DTI seal.")
BIR = svc._DocumentCheck(verdict="expected", detected_type="a BIR 2303", reason="Form 2303 heading.", id_number="123-456-789")


class DocumentCheckTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target, value in (("app.services.business_service.engine", self.engine),
                              ("app.services.requirement_service.engine", self.engine)):
            p = patch(target, value)
            p.start()
            self.addCleanup(p.stop)
        for name, value in (("FILE_ENCRYPTION_KEY", Fernet.generate_key().decode()), ("GEMINI_API_KEY", "test-key")):
            p = patch.object(settings, name, value)
            p.start()
            self.addCleanup(p.stop)
        svc._CACHE.clear()
        self.addCleanup(svc._CACHE.clear)
        tmp = tempfile.TemporaryDirectory()
        cwd = os.getcwd()
        os.chdir(tmp.name)
        self.addCleanup(tmp.cleanup)
        self.addCleanup(os.chdir, cwd)
        self.addCleanup(self.engine.dispose)

        self.business = self.save(User(business_name="Shop", role="seller", is_verified=True, onboarding_completed=True,
                                       registered_name="Shop Inc", contact_person="Ana Cruz"))
        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True))
        self.current = self.business
        app = FastAPI()
        app.include_router(business_router, prefix="/business")
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

    def upload(self, answer, **extra):
        with patch.object(svc, "_ask_gemini", return_value=answer) as ask:
            r = self.client.post("/business/documents", data={
                "doc_type": "BIR", "declared_owner_name": "Ana Cruz", "declared_business_name": "Shop Inc",
                "declared_id_number": "123-456-789", **extra,
            }, files={"file": ("bir.png", make_png(), "image/png")})
        return r, ask

    # ---------- the check itself ----------

    def test_messages_per_verdict(self):
        with patch.object(svc, "_ask_gemini", return_value=SELFIE):
            check = svc.check_business_document("BIR", b"one", "image/png")
        self.assertEqual(check.message, "This looks like a selfie, not a BIR 2303. Upload a scan or clear photo of the certificate.")
        with patch.object(svc, "_ask_gemini", return_value=DTI):
            check = svc.check_business_document("BIR", b"two", "image/png")
        self.assertIn("confirm if it really is your BIR 2303", check.message)
        with patch.object(svc, "_ask_gemini", return_value=BIR):
            check = svc.check_business_document("BIR", b"three", "image/png")
        self.assertEqual((check.verdict, check.id_number, check.message), ("expected", "123-456-789", None))

    def test_not_checked_without_ai(self):
        with patch.object(svc, "_ask_gemini") as ask:
            self.assertEqual(svc.check_labelled_document("DENR Permit", b"x", "application/msword").verdict, "not_checked")
            with patch.object(settings, "GEMINI_API_KEY", ""):
                self.assertEqual(svc.check_business_document("BIR", b"x", "image/png").verdict, "not_checked")
        ask.assert_not_called()
        with patch.object(svc, "_ask_gemini", return_value=None):  # Gemini down
            self.assertEqual(svc.check_business_document("BIR", b"x", "image/png").verdict, "not_checked")
        with patch.object(svc, "_ask_gemini", return_value=svc._DocumentCheck(verdict="maybe")):  # nonsense answer
            self.assertEqual(svc.check_business_document("BIR", b"y", "image/png").verdict, "not_checked")

    def test_same_file_is_checked_once(self):
        with patch.object(svc, "_ask_gemini", return_value=BIR) as ask:
            svc.check_business_document("BIR", b"same", "image/png")
            svc.check_business_document("BIR", b"same", "image/png")
        self.assertEqual(ask.call_count, 1)

    # ---------- onboarding documents ----------

    def test_extract_returns_the_check(self):
        with patch.object(svc, "_ask_gemini", return_value=SELFIE):
            r = self.client.post("/business/documents/extract", data={"doc_type": "BIR"},
                                 files={"file": ("me.png", make_png(), "image/png")})
        self.assertEqual(r.json()["verdict"], "not_a_document")
        self.assertIn("selfie", r.json()["message"])
        self.assertIsNone(r.json()["id_number"])

    def test_selfie_is_refused(self):
        r, _ = self.upload(SELFIE)
        self.assertEqual(r.status_code, 422)
        self.assertIn("This looks like a selfie, not a BIR 2303", r.json()["detail"])
        with Session(self.engine) as session:
            self.assertEqual(session.exec(select(BusinessDocument)).all(), [])

    def test_other_document_needs_confirmation(self):
        r, _ = self.upload(DTI)
        self.assertEqual(r.status_code, 409)
        r, _ = self.upload(DTI, confirm_mismatch="true")
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["ai_check"], "other_document")
        self.assertIn("confirmed", r.json()["ai_check_note"])

    def test_expected_and_unavailable(self):
        r, _ = self.upload(BIR)
        self.assertEqual((r.status_code, r.json()["ai_check"]), (201, "expected"))
        svc._CACHE.clear()
        r, _ = self.upload(None)  # Gemini unavailable: accepted, flagged for the admin
        self.assertEqual((r.status_code, r.json()["ai_check"]), (201, "not_checked"))
        self.assertIn("Not auto-checked", r.json()["ai_check_note"])

    # ---------- quotation attachments under a required document ----------

    def quotation(self):
        req = self.save(Requirement(ref_code="REQ-1", title="Bags", owner_id=self.buyer.id, location="Pasig",
                                    status="open", closes_at=datetime.now() + timedelta(days=1),
                                    required_documents="DENR Permit"))
        q = self.save(Quotation(requirement_id=req.id, business_id=self.business.id, submission_hash="h",
                                status="sealed", total_price=1000))
        return req, q

    def attach(self, req, q, answer, **data):
        with patch.object(svc, "_ask_gemini", return_value=answer) as ask:
            r = self.client.post(f"/requirements/{req.id}/quotations/{q.id}/attachments", data=data,
                                 files={"file": ("denr.png", make_png(), "image/png")})
        return r, ask

    def test_required_document_attachment_is_checked(self):
        req, q = self.quotation()
        r, _ = self.attach(req, q, SELFIE, document_label="DENR Permit")
        self.assertEqual(r.status_code, 422)
        self.assertIn("not a DENR Permit", r.json()["detail"])
        svc._CACHE.clear()
        self.assertEqual(self.attach(req, q, DTI, document_label="DENR Permit")[0].status_code, 409)
        self.assertEqual(self.attach(req, q, DTI, document_label="DENR Permit", confirm_mismatch="true")[0].status_code, 201)
        r, ask = self.attach(req, q, SELFIE)  # a plain attachment, no label: not checked
        self.assertEqual(r.status_code, 201)
        ask.assert_not_called()
        with Session(self.engine) as session:
            self.assertEqual(len(session.exec(select(QuotationAttachment)).all()), 2)

    def test_document_check_endpoint(self):
        with patch.object(svc, "_ask_gemini", return_value=SELFIE):
            r = self.client.post("/requirements/document-check", data={"document_label": "DENR Permit"},
                                 files={"file": ("x.png", make_png(), "image/png")})
        self.assertEqual(r.json()["verdict"], "not_a_document")


if __name__ == "__main__":
    unittest.main()
