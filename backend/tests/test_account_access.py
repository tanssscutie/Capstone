"""Banned, deactivated and suspended accounts are refused on every request
and at sign-in — with a real token, not a dependency override.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.api.routes.auth import router as auth_router
from app.core.clock import now_ph
from app.core.database import get_session
from app.core.security import create_access_token, get_password_hash
from app.models.user import User
from app.services.auth_service import auth_service


class AccountAccessTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        p = patch("app.services.auth_service.engine", self.engine)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        app = FastAPI()
        app.include_router(auth_router, prefix="/auth")

        def session_override():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_session] = session_override
        self.client = TestClient(app)

    def user(self, **kwargs):
        fields = dict(business_name="Shop", mobile_number="09171234567", email="shop@example.com",
                      hashed_password=get_password_hash("supersecret"), role="buyer",
                      privacy_consent_at=now_ph(), privacy_policy_version="2026-10-28")
        fields.update(kwargs)
        with Session(self.engine) as session:
            u = User(**fields)
            session.add(u)
            session.commit()
            session.refresh(u)
            return u.id

    def me(self, user_id):
        token = create_access_token({"sub": str(user_id)})
        return self.client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})

    def login(self):
        try:
            return auth_service.authenticate_user_and_get_token("09171234567", "supersecret")
        except HTTPException as exc:
            return exc

    def test_active_account_works(self):
        uid = self.user()
        self.assertEqual(self.me(uid).status_code, 200)
        self.assertIsNotNone(self.login().access_token)

    def test_existing_token_stops_working_once_banned(self):
        uid = self.user(banned_at=now_ph(), is_active=False)
        r = self.me(uid)
        self.assertEqual(r.status_code, 403)
        self.assertIn("banned", r.json()["detail"])
        self.assertEqual(self.login().status_code, 403)

    def test_deactivated(self):
        uid = self.user(is_active=False)
        self.assertIn("deactivated", self.me(uid).json()["detail"])

    def test_suspension_blocks_until_it_lapses(self):
        uid = self.user(suspended_until=now_ph() + timedelta(days=7))
        r = self.me(uid)
        self.assertEqual(r.status_code, 403)
        self.assertIn("suspended until", r.json()["detail"])
        self.assertEqual(self.login().status_code, 403)

        with Session(self.engine) as session:
            u = session.get(User, uid)
            u.suspended_until = now_ph() - timedelta(minutes=1)
            session.add(u)
            session.commit()
        self.assertEqual(self.me(uid).status_code, 200)

    def test_wrong_password_reveals_nothing(self):
        self.user(banned_at=now_ph(), is_active=False)
        self.assertIsNone(auth_service.authenticate_user_and_get_token("09171234567", "wrong-password"))


if __name__ == "__main__":
    unittest.main()
