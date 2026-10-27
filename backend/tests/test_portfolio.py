"""Seller portfolio photos. Isolated SQLite, temp upload folder.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import io
import os
import tempfile
import unittest
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.api.routes.business import router as business_router
from app.core.config import settings
from app.core.security import get_current_user
from app.models.portfolio_item import PortfolioItem
from app.models.user import User


def photo(size=(2400, 1800), fmt="JPEG"):
    out = io.BytesIO()
    Image.new("RGB", size, "orange").save(out, fmt)
    return out.getvalue()


class PortfolioTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        for target, value in [("app.services.portfolio_service.engine", self.engine),
                              ("app.services.portfolio_service.UPLOAD_ROOT", self.tmp.name)]:
            p = patch(target, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(settings, "FILE_ENCRYPTION_KEY", Fernet.generate_key().decode())
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.seller = self.save(User(business_name="Print Co", role="seller", industry_category="Printing",
                                     onboarding_completed=True))
        self.other_seller = self.save(User(business_name="Other", role="seller", industry_category="Printing",
                                           onboarding_completed=True))
        self.buyer = self.save(User(business_name="Buyer", role="buyer", onboarding_completed=True))
        self.fresh = self.save(User(business_name="Fresh", role="seller", industry_category="Printing"))

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

    def add(self, user=None, name="tarp.jpg", content=None, caption="Event tarpaulin, 3x6 ft", item_code="tarpaulin"):
        self.current = user or self.seller
        data = {"caption": caption}
        if item_code:
            data["item_code"] = item_code
        return self.client.post("/business/portfolio", files={"file": (name, content or photo(), "image/jpeg")}, data=data)

    def test_upload_list_and_view(self):
        r = self.add()
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["item_name"], "Tarpaulin")

        self.current = self.buyer
        items = self.client.get(f"/business/{self.seller.id}/portfolio").json()
        self.assertEqual([i["caption"] for i in items], ["Event tarpaulin, 3x6 ft"])
        img = self.client.get(f"/business/{self.seller.id}/portfolio/{items[0]['id']}/image")
        self.assertEqual(img.status_code, 200)
        self.assertEqual(img.headers["content-type"], "image/jpeg")
        self.assertLessEqual(max(Image.open(io.BytesIO(img.content)).size), 1600)  # downscaled

        with Session(self.engine) as session:
            path = session.get(PortfolioItem, items[0]["id"]).file_path
        with open(path, "rb") as f:
            self.assertFalse(f.read().startswith(b"\xff\xd8"))  # encrypted, not a raw JPEG

    def test_who_can_upload(self):
        self.assertEqual(self.add(user=self.buyer).status_code, 403)
        self.assertEqual(self.add(user=self.fresh).status_code, 403)  # onboarding not finished

    def test_validation(self):
        self.assertEqual(self.add(name="scan.pdf").status_code, 400)
        self.assertEqual(self.add(content=b"not really an image").status_code, 400)
        self.assertEqual(self.add(caption="ok").status_code, 422)
        self.assertEqual(self.add(item_code="paper_bags").status_code, 422)  # not a Printing item
        self.assertEqual(self.add(item_code=None).status_code, 201)

    def test_limit_of_eight(self):
        for _ in range(8):
            self.assertEqual(self.add(content=photo((200, 200))).status_code, 201)
        self.assertEqual(self.add(content=photo((200, 200))).status_code, 409)

    def test_only_the_owner_can_remove(self):
        item_id = self.add().json()["id"]
        self.current = self.other_seller
        self.assertEqual(self.client.delete(f"/business/portfolio/{item_id}").status_code, 404)
        self.current = self.seller
        with Session(self.engine) as session:
            path = session.get(PortfolioItem, item_id).file_path
        self.assertEqual(self.client.delete(f"/business/portfolio/{item_id}").status_code, 204)
        self.assertFalse(os.path.exists(path))
        self.assertEqual(self.client.get(f"/business/{self.seller.id}/portfolio").json(), [])


if __name__ == "__main__":
    unittest.main()
