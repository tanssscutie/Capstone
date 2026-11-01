"""Post-release document requests to shortlisted respondents, using isolated
SQLite and a temp upload folder.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import hashlib
import json
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

from app.api.routes.requirements import router as requirements_router
from app.core.config import settings
from app.core.security import get_current_user
from app.models.ledger_entry import LedgerEntry
from app.models.notification import Notification
from app.models.quotation import Quotation
from app.models.quotation_document_request import QuotationDocumentRequest
from app.models.requirement import Requirement
from app.models.user import User

from pdf_fixtures import make_pdf
PDF = make_pdf("sample certificate")
NEWER = make_pdf("newer")


class DocumentRequestTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        self.upload_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.upload_dir.cleanup)
        for target, value in [
            ("app.services.requirement_service.engine", self.engine),
            ("app.services.document_request_service.engine", self.engine),
            ("app.services.document_request_service.UPLOAD_ROOT", self.upload_dir.name),
        ]:
            p = patch(target, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(settings, "FILE_ENCRYPTION_KEY", Fernet.generate_key().decode())
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True, verification_status="verified"))
        self.seller = self.save(User(business_name="Seller", role="seller", is_verified=True, verification_status="verified"))
        self.other = self.save(User(business_name="Other", role="seller", is_verified=True, verification_status="verified"))
        self.req = self.save(Requirement(ref_code="REQ-1", title="Tarps", owner_id=self.buyer.id, location="Pasig",
                                         status="closed", closes_at=datetime.now() - timedelta(days=1)))
        self.quote = self.save(Quotation(requirement_id=self.req.id, business_id=self.seller.id, submission_hash="h",
                                         status="released", total_price=5000, shortlisted=True))

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

    def request_doc(self, label="FDA certificate", quote=None):
        return self.as_(self.buyer).post(
            f"/requirements/{self.req.id}/quotations/{(quote or self.quote).id}/document-requests",
            json={"document_label": label, "note": "Latest one please"},
        )

    def upload(self, request_id, content=PDF, name="cert.pdf", user=None):
        return self.as_(user or self.seller).post(
            f"/requirements/{self.req.id}/document-requests/{request_id}/upload",
            files={"file": (name, content, "application/pdf")},
            data={"response_note": "Valid until 2027"},
        )

    def ledger_events(self):
        with Session(self.engine) as session:
            return [json.loads(e.payload_json) | {"type": e.event_type} for e in session.exec(select(LedgerEntry)).all()]

    def test_full_flow_request_upload_download(self):
        created = self.request_doc()
        self.assertEqual(created.status_code, 201, created.text)
        request_id = created.json()["id"]
        self.assertEqual(created.json()["status"], "pending")

        listed = self.as_(self.seller).get(f"/requirements/{self.req.id}/quotations/{self.quote.id}/document-requests")
        self.assertEqual([r["document_label"] for r in listed.json()], ["FDA certificate"])

        uploaded = self.upload(request_id)
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        self.assertEqual(uploaded.json()["status"], "submitted")
        self.assertEqual(uploaded.json()["filename"], "cert.pdf")

        # Encrypted at rest — the bytes on disk are never the raw upload.
        with Session(self.engine) as session:
            row = session.get(QuotationDocumentRequest, request_id)
        with open(row.file_path, "rb") as f:
            self.assertNotEqual(f.read(), PDF)

        downloaded = self.as_(self.buyer).get(f"/requirements/{self.req.id}/document-requests/{request_id}/file")
        self.assertEqual(downloaded.status_code, 200)
        self.assertEqual(downloaded.content, PDF)

        events = self.ledger_events()
        self.assertEqual([e["type"] for e in events], ["DOCUMENT_REQUESTED", "DOCUMENT_SUBMITTED"])
        self.assertEqual(events[1]["file_sha256"], hashlib.sha256(PDF).hexdigest())

        with Session(self.engine) as session:
            alerts = {(n.user_id, n.title) for n in session.exec(select(Notification)).all()}
        self.assertIn((self.seller.id, "The buyer requested a document"), alerts)
        self.assertIn((self.buyer.id, "Requested document received"), alerts)

    def test_reupload_replaces_the_file(self):
        request_id = self.request_doc().json()["id"]
        self.upload(request_id)
        with Session(self.engine) as session:
            first_path = session.get(QuotationDocumentRequest, request_id).file_path
        self.upload(request_id, content=NEWER, name="cert-v2.pdf")
        self.assertFalse(os.path.exists(first_path))
        downloaded = self.as_(self.buyer).get(f"/requirements/{self.req.id}/document-requests/{request_id}/file")
        self.assertEqual(downloaded.content, NEWER)

    def test_only_shortlisted_and_undecided(self):
        plain = self.save(Quotation(requirement_id=self.req.id, business_id=self.other.id, submission_hash="h",
                                    status="released", total_price=4000))
        self.assertEqual(self.request_doc(quote=plain).status_code, 409)

        self.req.status = "awarded"
        self.save(self.req)
        self.assertEqual(self.request_doc().status_code, 409)

    def test_only_owner_can_request_and_only_respondent_can_upload(self):
        refused = self.as_(self.other).post(
            f"/requirements/{self.req.id}/quotations/{self.quote.id}/document-requests",
            json={"document_label": "Anything"},
        )
        self.assertEqual(refused.status_code, 403)

        request_id = self.request_doc().json()["id"]
        self.assertEqual(self.upload(request_id, user=self.other).status_code, 403)
        self.assertEqual(
            self.as_(self.other).get(f"/requirements/{self.req.id}/quotations/{self.quote.id}/document-requests").status_code,
            403,
        )
        self.upload(request_id)
        self.assertEqual(
            self.as_(self.other).get(f"/requirements/{self.req.id}/document-requests/{request_id}/file").status_code,
            403,
        )

    def test_rejects_bad_files(self):
        request_id = self.request_doc().json()["id"]
        self.assertEqual(self.upload(request_id, name="run.exe").status_code, 400)
        self.assertEqual(self.upload(request_id, content=b"").status_code, 400)

    def test_cancel_hides_from_respondent_and_blocks_upload(self):
        request_id = self.request_doc().json()["id"]
        cancelled = self.as_(self.buyer).post(f"/requirements/{self.req.id}/document-requests/{request_id}/cancel")
        self.assertEqual(cancelled.json()["status"], "cancelled")
        self.assertEqual(
            self.as_(self.seller).get(f"/requirements/{self.req.id}/quotations/{self.quote.id}/document-requests").json(),
            [],
        )
        self.assertEqual(self.upload(request_id).status_code, 409)

    def test_pending_cap(self):
        for i in range(5):
            self.assertEqual(self.request_doc(label=f"Doc {i}").status_code, 201)
        self.assertEqual(self.request_doc(label="One too many").status_code, 409)

    def test_upload_still_open_during_award_pending(self):
        request_id = self.request_doc().json()["id"]
        self.req.status = "award_pending"
        self.save(self.req)
        self.assertEqual(self.upload(request_id).status_code, 200)

    def test_quotation_itself_is_untouched(self):
        request_id = self.request_doc().json()["id"]
        self.upload(request_id)
        with Session(self.engine) as session:
            q = session.get(Quotation, self.quote.id)
        self.assertEqual((q.total_price, q.submission_hash, q.status), (5000, "h", "released"))


if __name__ == "__main__":
    unittest.main()
