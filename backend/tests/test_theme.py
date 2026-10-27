"""Appearance (PUT /auth/theme): system / light / dark, saved on the account
and returned by /auth/me. Isolated SQLite.

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

from app.api.routes.auth import router as auth_router
from app.core.security import get_current_user
from app.models.user import User


class ThemeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        p = patch("app.services.auth_service.engine", self.engine)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)
        with Session(self.engine) as session:
            user = User(business_name="Shop", role="seller", mobile_number="+639170000000")
            session.add(user)
            session.commit()
            session.refresh(user)
            session.expunge(user)
        self.user = user
        app = FastAPI()
        app.include_router(auth_router, prefix="/auth")
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(app)

    def test_default_and_change(self):
        self.assertEqual(self.user.theme, "system")
        r = self.client.put("/auth/theme", json={"theme": "dark"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["theme"], "dark")
        with Session(self.engine) as session:
            self.assertEqual(session.get(User, self.user.id).theme, "dark")

    def test_only_known_values(self):
        self.assertEqual(self.client.put("/auth/theme", json={"theme": "purple"}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
