"""RA 10173 consent: required to register, recorded with its version, and
asked again of accounts that never gave it. Isolated SQLite.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import unittest
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app.api.routes.auth import router as auth_router
from app.core.privacy import PRIVACY_POLICY_VERSION
from app.core.security import get_current_user
from app.models.user import User


class PrivacyConsentTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.auth_service.engine",):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        p = patch("app.services.auth_service.send_otp_email")  # no SMTP in tests
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.current = None
        app = FastAPI()
        app.include_router(auth_router, prefix="/auth")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

    def register(self, **overrides):
        payload = dict(business_name="Santiago Printing", mobile_number="09171234567", email="ana@example.com",
                       password="supersecret", role="buyer", industry_category="Printing", accept_privacy=True)
        payload.update(overrides)
        return self.client.post("/auth/register", json=payload)

    def load(self, **where):
        with Session(self.engine) as session:
            user = session.exec(select(User).filter_by(**where)).first()
            session.expunge(user)
            return user

    def save(self, user):
        with Session(self.engine) as session:
            session.add(user)
            session.commit()
            session.refresh(user)
            session.expunge(user)
            return user

    def test_registration_requires_consent(self):
        r = self.register(accept_privacy=False)
        self.assertEqual(r.status_code, 422)
        self.assertIn("Privacy Notice", r.text)
        r = self.register(accept_privacy=None)
        self.assertEqual(r.status_code, 422)

    def test_consent_time_and_version_are_recorded(self):
        r = self.register()
        self.assertEqual(r.status_code, 200, r.text)
        self.assertFalse(r.json()["needs_privacy_consent"])
        user = self.load(email="ana@example.com")
        self.assertIsNotNone(user.privacy_consent_at)
        self.assertEqual(user.privacy_policy_version, PRIVACY_POLICY_VERSION)

    def test_older_account_is_asked_and_can_agree(self):
        old = self.save(User(business_name="Old shop", mobile_number="09170000000", role="seller"))
        self.current = old
        self.assertTrue(self.client.get("/auth/me").json()["needs_privacy_consent"])

        refused = self.client.post("/auth/complete-profile", json={})
        self.assertEqual(refused.status_code, 400)
        agreed = self.client.post("/auth/complete-profile", json={"accept_privacy": True})
        self.assertEqual(agreed.status_code, 200, agreed.text)
        self.assertFalse(agreed.json()["needs_privacy_consent"])
        self.assertEqual(self.load(id=old.id).privacy_policy_version, PRIVACY_POLICY_VERSION)

    def test_outdated_version_is_asked_again(self):
        from datetime import datetime

        user = self.save(User(business_name="Shop", mobile_number="09171111111", role="buyer",
                              privacy_consent_at=datetime(2025, 1, 1), privacy_policy_version="2025-01-01"))
        self.current = user
        self.assertTrue(self.client.get("/auth/me").json()["needs_privacy_consent"])

    def test_admins_are_never_asked(self):
        self.current = self.save(User(business_name="Admin", is_admin=True, mobile_number="09172222222"))
        self.assertFalse(self.client.get("/auth/me").json()["needs_privacy_consent"])


if __name__ == "__main__":
    unittest.main()
