"""Admin Settings: GET /business/admin/system-status — admins only, rules and
service switches as plain values, never a key or password.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import unittest
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.business import router as business_router
from app.core.config import settings
from app.core.security import get_current_user
from app.models.user import User


class AdminSystemStatusTests(unittest.TestCase):
    def setUp(self):
        self.current = User(id=1, business_name="Admin", is_admin=True)
        app = FastAPI()
        app.include_router(business_router, prefix="/business")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

    def test_admin_sees_rules_and_switches_without_secrets(self):
        with patch.object(settings, "GEMINI_API_KEY", "secret-key"), patch.object(settings, "SMTP_HOST", ""), \
                patch.object(settings, "SMTP_PASSWORD", "smtp-secret"):
            r = self.client.get("/business/admin/system-status")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["min_quotations_to_release"], settings.MIN_QUOTATIONS_TO_RELEASE)
        self.assertEqual(body["withdrawal_window_days"], 90)
        self.assertTrue(body["ai_enabled"])
        self.assertFalse(body["email_enabled"])
        self.assertNotIn("secret", r.text)

    def test_businesses_cannot_see_it(self):
        self.current = User(id=2, business_name="Shop", role="seller", is_verified=True)
        self.assertEqual(self.client.get("/business/admin/system-status").status_code, 403)


if __name__ == "__main__":
    unittest.main()
