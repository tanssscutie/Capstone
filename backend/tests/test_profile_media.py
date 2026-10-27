"""Profile picture, cover photo, details, and "Request a quote" invites.
Isolated SQLite, temp upload folder.

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
from sqlmodel import SQLModel, Session, create_engine, select

from app.api.routes.business import router as business_router
from app.core.clock import now_ph
from app.core.config import settings
from app.core.security import get_current_user
from app.models.notification import Notification
from app.models.requirement import Requirement
from app.models.user import User
from app.services.requirement_service import requirement_service


def photo(size=(2400, 1800)):
    out = io.BytesIO()
    img = Image.new("RGB", size, "orange")
    exif = Image.Exif()
    exif[0x010F] = "SecretCam"  # Make
    img.save(out, "JPEG", exif=exif.tobytes())
    return out.getvalue()


class ProfileMediaTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        for target, value in [("app.services.profile_media_service.engine", self.engine),
                              ("app.services.profile_media_service.UPLOAD_ROOT", self.tmp.name),
                              ("app.services.business_service.engine", self.engine),
                              ("app.services.requirement_service.engine", self.engine)]:
            p = patch(target, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(settings, "FILE_ENCRYPTION_KEY", Fernet.generate_key().decode())
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.seller = self.save(User(business_name="Print Co", role="seller", industry_category="Printing",
                                     is_verified=True, verification_status="verified", years_in_business="4_TO_6"))
        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True,
                                    verification_status="verified"))
        self.current = self.seller
        app = FastAPI()
        app.include_router(business_router, prefix="/business")
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

    def upload(self, kind, data=None, name="me.jpg"):
        return self.client.post(f"/business/profile/{kind}", files={"file": (name, data or photo(), "image/jpeg")})

    def test_avatar_and_cover_are_resized_and_stripped(self):
        self.assertEqual(self.upload("avatar").status_code, 204)
        self.assertEqual(self.upload("cover").status_code, 204)
        for kind, size in (("avatar", (512, 512)), ("cover", (1600, 400))):
            r = self.as_(self.buyer).get(f"/business/{self.seller.id}/{kind}")
            self.assertEqual(r.status_code, 200)
            img = Image.open(io.BytesIO(r.content))
            self.assertEqual(img.size, size)
            self.assertNotIn(0x010F, img.getexif())
        with Session(self.engine) as session:
            path = session.get(User, self.seller.id).avatar_path
        with open(path, "rb") as f:
            self.assertFalse(f.read().startswith(b"\xff\xd8"))  # encrypted, not a raw JPEG

    def test_replace_and_remove_only_touch_own(self):
        self.upload("avatar")
        with Session(self.engine) as session:
            first = session.get(User, self.seller.id).avatar_path
        self.upload("avatar")
        self.assertFalse(os.path.exists(first))
        self.assertEqual(self.as_(self.buyer).get(f"/business/{self.buyer.id}/avatar").status_code, 404)
        self.assertEqual(self.as_(self.seller).delete("/business/profile/avatar").status_code, 204)
        self.assertEqual(self.client.get(f"/business/{self.seller.id}/avatar").status_code, 404)

    def test_rejects_non_images_and_unknown_kind(self):
        self.assertEqual(self.upload("avatar", b"not an image").status_code, 400)
        self.assertEqual(self.upload("avatar", name="x.exe").status_code, 400)
        self.assertEqual(self.upload("banner").status_code, 404)

    def test_details_and_url_validation(self):
        r = self.client.put("/business/profile/details", json={
            "headline": "Large-format printing in Pasig", "about": "Since 2015.",
            "website_url": "printco.ph", "facebook_url": "https://facebook.com/printco"})
        self.assertEqual(r.status_code, 204, r.text)
        for bad in ("javascript:alert(1)", "ftp://x.com", "http://"):
            r = self.client.put("/business/profile/details", json={"website_url": bad})
            self.assertEqual(r.status_code, 422, bad)
        with Session(self.engine) as session:
            u = session.get(User, self.seller.id)
            self.assertEqual(u.website_url, "https://printco.ph")
            self.assertEqual(u.business_description, "Since 2015.")
        self.upload("avatar")
        p = self.as_(self.buyer).get(f"/business/{self.seller.id}/profile").json()
        self.assertTrue(p["has_avatar"])
        self.assertFalse(p["has_cover"])
        self.assertEqual(p["headline"], "Large-format printing in Pasig")
        self.assertEqual(p["years_in_business"], "4_TO_6")

    def test_invites_only_eligible_sellers(self):
        other_category = self.save(User(business_name="Packer", role="seller", industry_category="Packaging",
                                        is_verified=True, verification_status="verified"))
        unverified = self.save(User(business_name="New", role="seller", industry_category="Printing"))
        req = self.save(Requirement(ref_code="REQ-9", title="Tarps", owner_id=self.buyer.id, location="Pasig",
                                    category="Printing", status="open", closes_at=now_ph() + timedelta(days=3)))
        with Session(self.engine) as session:
            r = session.get(Requirement, req.id)
            alerted = requirement_service._alert_invited_sellers(
                session, r, [self.seller.id, self.seller.id, other_category.id, unverified.id, self.buyer.id])
        self.assertEqual(alerted, [self.seller.id])
        with Session(self.engine) as session:
            titles = [n.title for n in session.exec(select(Notification)).all()]
        self.assertEqual(titles, ["Buyer invited you to quote"])


if __name__ == "__main__":
    unittest.main()
