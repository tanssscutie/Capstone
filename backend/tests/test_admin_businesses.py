"""Admin Businesses: GET /business/admin/businesses lists every account, even
one with no login mobile (a Google sign-up), instead of failing the whole list.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import unittest
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.api.routes.business import router as business_router
from app.core.security import get_current_user
from app.models.user import User


class AdminBusinessListTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        with Session(self.engine) as s:
            s.add(User(id=1, business_name="Admin", mobile_number="09000000000", is_admin=True))
            s.add(User(id=2, business_name="Shop", mobile_number="09170000001", role="seller"))
            s.add(User(id=3, business_name="Google Buyer", google_id="g-3", role="buyer"))
            s.commit()
        self.patch = patch("app.services.business_service.engine", self.engine)
        self.patch.start()
        app = FastAPI()
        app.include_router(business_router, prefix="/business")
        app.dependency_overrides[get_current_user] = lambda: User(id=1, business_name="Admin", is_admin=True)
        self.client = TestClient(app)

    def tearDown(self):
        self.patch.stop()

    def test_account_without_mobile_is_listed(self):
        r = self.client.get("/business/admin/businesses")
        self.assertEqual(r.status_code, 200)
        rows = {b["business_name"]: b for b in r.json()}
        self.assertIn("Google Buyer", rows)
        self.assertIsNone(rows["Google Buyer"]["mobile_number"])
        self.assertEqual(rows["Shop"]["mobile_number"], "09170000001")


if __name__ == "__main__":
    unittest.main()
