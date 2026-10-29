"""Identity check at onboarding: a valid Philippine government ID and a
selfie holding it, checked strictly by the AI (mocked here), matched to the
contact person's name; buyers need only these, sellers also DTI/SEC + BIR.
Isolated SQLite + temp folder; Gemini never called.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import io
import os
import tempfile
import unittest
from datetime import timedelta
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.api.routes.business import router as business_router
from app.core import name_match
from app.core.clock import now_ph
from app.core.config import settings
from app.core.security import get_current_user
from app.models.user import User
from app.services import document_extraction_service as des


def png(color="white") -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (40, 30), color).save(out, "PNG")
    return out.getvalue()


ID_IMG, SELFIE_IMG, OTHER_IMG = png("white"), png("gray"), png("black")


def id_answer(verdict="valid", name="JUAN P. DELA CRUZ", expiry="", number="1234-5678-9012"):
    return des._IdAnswer(verdict=verdict, id_type_seen="PhilSys ID", reason="Looks like a real PhilID.",
                         full_name=name, id_number=number, expiry_date=expiry)


class NameMatchTests(unittest.TestCase):
    def test_cases(self):
        self.assertEqual(name_match.compare("DELA CRUZ, JUAN PEDRO", "Juan Dela Cruz"), "match")
        self.assertEqual(name_match.compare("JUAN P. DELA CRUZ JR.", "juan dela cruz"), "match")
        self.assertEqual(name_match.compare("MARÍA PEÑA", "Maria Pena"), "match")
        self.assertEqual(name_match.compare("JUAN DELACRUZ", "Juan Dela Cruz"), "match")
        self.assertEqual(name_match.compare("JUAN SANTOS", "Juan Dela Cruz"), "partial")
        self.assertEqual(name_match.compare("ANA REYES", "Juan Dela Cruz"), "mismatch")
        self.assertEqual(name_match.compare("", "Juan"), "unchecked")


class IdentityUploadTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        for target, value in [("app.services.business_service.engine", self.engine),
                              ("app.services.business_service.UPLOAD_ROOT", self.folder.name)]:
            p = patch(target, value)
            p.start()
            self.addCleanup(p.stop)
        for obj, attr, value in [(settings, "FILE_ENCRYPTION_KEY", Fernet.generate_key().decode()),
                                 (settings, "GEMINI_API_KEY", "test-key")]:
            p = patch.object(obj, attr, value)
            p.start()
            self.addCleanup(p.stop)
        des._ID_CACHE.clear()
        self.addCleanup(des._ID_CACHE.clear)
        self.answers = []
        p = patch.object(des, "_ask_gemini_json", side_effect=lambda *a, **k: self.answers.pop(0) if self.answers else None)
        p.start()
        self.addCleanup(p.stop)

        self.buyer = self.save(User(business_name="Kape ni Juan", registered_name="Kape ni Juan Trading", role="buyer",
                                    contact_person="Juan Dela Cruz", onboarding_completed=True))
        self.seller = self.save(User(business_name="Print Co", registered_name="Print Co", role="seller",
                                     contact_person="Juan Dela Cruz", onboarding_completed=True))
        self.current = self.buyer
        app = FastAPI()
        app.include_router(business_router, prefix="/business")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

    def save(self, record):
        with Session(self.engine) as s:
            s.add(record)
            s.commit()
            s.refresh(record)
            s.expunge(record)
            return record

    def upload(self, doc_type, image, id_type="PHILSYS", person="Juan Dela Cruz"):
        data = {"doc_type": doc_type, "declared_owner_name": person, "declared_business_name": "Kape ni Juan Trading",
                "declared_id_number": ""}
        if id_type:
            data["id_type"] = id_type
        return self.client.post("/business/documents", data=data, files={"file": (f"{doc_type}.png", image, "image/png")})

    def missing(self):
        return self.client.get("/business/verification-status").json()["missing_documents"]

    def test_buyer_needs_only_the_identity_check(self):
        self.assertEqual(self.missing(), ["VALID_ID", "SELFIE_WITH_ID"])
        self.answers = [id_answer()]
        r = self.upload("VALID_ID", ID_IMG)
        self.assertEqual(r.status_code, 201, r.text)
        body = r.json()
        self.assertEqual((body["id_type"], body["id_match"], body["ai_check"]), ("PHILSYS", "match", "expected"))
        self.assertEqual(body["declared_id_number"], "•••• 9012")  # never the full number

        self.answers = [des._SelfieAnswer(verdict="valid", face_matches_id=True, same_id_card=True, reason="Same person.")]
        r = self.upload("SELFIE_WITH_ID", SELFIE_IMG, id_type=None)
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["face_match"], "match")
        self.assertEqual(self.missing(), [])
        self.assertEqual(self.client.post("/business/submit-for-verification").status_code, 200)

    def test_seller_also_needs_business_documents(self):
        self.current = self.seller
        self.assertEqual(self.missing(), ["VALID_ID", "SELFIE_WITH_ID", "DTI_OR_SEC", "BIR"])

    def test_strict_refusals(self):
        self.answers = [id_answer(verdict="not_valid")]
        r = self.upload("VALID_ID", ID_IMG)
        self.assertEqual(r.status_code, 422)
        self.assertIn("can't accept", r.json()["detail"])

        self.answers = [id_answer(expiry=(now_ph().date() - timedelta(days=1)).isoformat())]
        r = self.upload("VALID_ID", OTHER_IMG)
        self.assertEqual(r.status_code, 422)
        self.assertIn("expired", r.json()["detail"])

        des._ID_CACHE.clear()
        self.answers = [id_answer(name="ANA REYES")]
        r = self.upload("VALID_ID", ID_IMG)
        self.assertEqual(r.status_code, 422)
        self.assertIn("doesn't match", r.json()["detail"])

        self.assertEqual(self.upload("VALID_ID", ID_IMG, id_type="SCHOOL_ID").status_code, 422)

    def test_partial_name_is_flagged_for_the_admin(self):
        self.answers = [id_answer(name="JUAN SANTOS")]
        r = self.upload("VALID_ID", ID_IMG)
        self.assertEqual(r.status_code, 201)
        self.assertEqual((r.json()["id_match"], r.json()["validation_status"]), ("partial", "flagged"))

    def test_selfie_rules(self):
        self.assertEqual(self.upload("SELFIE_WITH_ID", SELFIE_IMG, id_type=None).status_code, 400)  # ID first
        self.answers = [id_answer()]
        self.upload("VALID_ID", ID_IMG)
        self.answers = [des._SelfieAnswer(verdict="valid", face_matches_id=False, same_id_card=True, reason="Different face.")]
        r = self.upload("SELFIE_WITH_ID", SELFIE_IMG, id_type=None)
        self.assertEqual(r.status_code, 422)  # strict: no "upload anyway"

    def test_ai_unavailable_means_admin_checks_by_eye(self):
        r = self.upload("VALID_ID", ID_IMG)  # no answers queued: the AI call fails
        self.assertEqual(r.status_code, 201)
        self.assertEqual((r.json()["ai_check"], r.json()["id_match"]), ("not_checked", "unchecked"))
        self.assertIn("by eye", r.json()["ai_check_note"])

    def test_pick_time_checks(self):
        self.answers = [id_answer()]
        r = self.client.post("/business/documents/extract", data={"doc_type": "VALID_ID", "id_type": "PHILSYS",
                                                                 "person_name": "Juan Dela Cruz"},
                             files={"file": ("id.png", ID_IMG, "image/png")})
        self.assertEqual((r.json()["verdict"], r.json()["id_match"]), ("expected", "match"))

        self.answers = [des._SelfieAnswer(verdict="not_valid", reason="It's a photo of a screen.")]
        r = self.client.post("/business/documents/check-selfie",
                             files={"selfie": ("s.png", SELFIE_IMG, "image/png"), "id_file": ("id.png", ID_IMG, "image/png")})
        self.assertEqual(r.json()["verdict"], "not_a_document")
        self.assertIn("screen", r.json()["message"])

    def test_dti_name_warning_for_sellers(self):
        self.current = self.seller
        with patch.object(des, "_ask_gemini", return_value=des._DocumentCheck(
                verdict="expected", detected_type="a DTI certificate", reason="ok", id_number="1234567",
                business_name="PRINTCO ENTERPRISES")):
            r = self.client.post("/business/documents/extract", data={"doc_type": "DTI", "registered_name": "Print Co"},
                                 files={"file": ("dti.png", OTHER_IMG, "image/png")})
        self.assertIn("PRINTCO ENTERPRISES", r.json()["name_warning"])

    def test_valid_id_list_is_public(self):
        from app.api.routes.meta import router as meta_router
        app = FastAPI()
        app.include_router(meta_router, prefix="/meta")
        ids = TestClient(app).get("/meta/valid-ids").json()["ids"]
        self.assertIn("PHILSYS", [i["code"] for i in ids])


if __name__ == "__main__":
    unittest.main()
