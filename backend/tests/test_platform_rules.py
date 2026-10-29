"""Platform rules a super admin edits (app/core/platform_settings.py): an
override wins over the .env default until reset, values are validated,
the AI switch needs the key AND the switch, and the maintenance banner is
public. Isolated SQLite.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import unittest
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine

from app.api.routes.meta import router as meta_router
from app.api.routes.platform_rules import router as rules_router
from app.core import platform_settings
from app.core.config import settings
from app.core.security import get_current_user
from app.models.platform_setting import PlatformSetting  # noqa: F401  (registers the table)
from app.models.user import User


class PlatformRulesTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.core.database.engine", "app.api.routes.platform_rules.engine", "app.services.admin_audit.engine"):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        platform_settings.clear_cache()
        self.addCleanup(platform_settings.clear_cache)
        self.current = User(id=1, business_name="Boss", is_admin=True, admin_role="super_admin")
        app = FastAPI()
        app.include_router(rules_router, prefix="/business")
        app.include_router(meta_router, prefix="/meta")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

    def rule(self, key):
        return next(r for r in self.client.get("/business/admin/platform-rules").json() if r["key"] == key)

    def test_only_super_admins(self):
        self.current = User(id=2, business_name="Ana", is_admin=True, admin_role="admin")
        self.assertEqual(self.client.get("/business/admin/platform-rules").status_code, 403)
        self.assertEqual(self.client.put("/business/admin/platform-rules/auto_extend_days", json={"value": 5}).status_code, 403)

    def test_override_then_reset(self):
        default = settings.MIN_QUOTATIONS_TO_RELEASE
        self.assertEqual(platform_settings.min_quotations(), default)
        r = self.client.put("/business/admin/platform-rules/min_quotations_to_release", json={"value": "2"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(platform_settings.min_quotations(), 2)
        rule = self.rule("min_quotations_to_release")
        self.assertEqual((rule["value"], rule["default"], rule["overridden"]), (2, default, True))

        self.client.delete("/business/admin/platform-rules/min_quotations_to_release")
        self.assertEqual(platform_settings.min_quotations(), default)
        self.assertFalse(self.rule("min_quotations_to_release")["overridden"])

    def test_validation(self):
        for key, value in [("min_quotations_to_release", 0), ("min_quotations_to_release", "four"),
                           ("withdrawal_window_days", 1000), ("ai_enabled", "maybe"),
                           ("maintenance_banner", "x" * 301)]:
            r = self.client.put(f"/business/admin/platform-rules/{key}", json={"value": value})
            self.assertEqual(r.status_code, 422, (key, value))
        self.assertEqual(self.client.put("/business/admin/platform-rules/secret_key", json={"value": 1}).status_code, 404)

    def test_ai_needs_key_and_switch(self):
        with patch.object(settings, "GEMINI_API_KEY", "key"):
            self.assertTrue(platform_settings.ai_enabled())
            self.client.put("/business/admin/platform-rules/ai_enabled", json={"value": False})
            self.assertFalse(platform_settings.ai_enabled())
        with patch.object(settings, "GEMINI_API_KEY", ""):
            self.client.put("/business/admin/platform-rules/ai_enabled", json={"value": True})
            self.assertFalse(platform_settings.ai_enabled())

    def test_ai_switch_off_skips_the_document_check(self):
        from app.services import document_extraction_service as des
        self.client.put("/business/admin/platform-rules/ai_enabled", json={"value": False})
        with patch.object(settings, "GEMINI_API_KEY", "key"), patch.object(des, "_ask_gemini") as ask:
            result = des.check_business_document("DTI", b"\x89PNG\r\n\x1a\n", "image/png")
        ask.assert_not_called()
        self.assertEqual(result.verdict, des.NOT_CHECKED)

    def test_banner_is_public(self):
        self.assertEqual(self.client.get("/meta/banner").json(), {"message": ""})
        self.client.put("/business/admin/platform-rules/maintenance_banner",
                        json={"value": "  Maintenance tonight 10 PM–11 PM  "})
        self.assertEqual(self.client.get("/meta/banner").json(), {"message": "Maintenance tonight 10 PM–11 PM"})

    def test_withdrawal_window_follows_the_rule(self):
        self.client.put("/business/admin/platform-rules/withdrawal_window_days", json={"value": 30})
        self.assertEqual(platform_settings.withdrawal_window_days(), 30)

    def test_database_errors_fall_back_to_defaults(self):
        platform_settings.clear_cache()
        with patch("app.core.database.engine", create_engine("sqlite://")):  # no tables
            self.assertEqual(platform_settings.auto_extend_days(), settings.AUTO_EXTEND_DAYS)


if __name__ == "__main__":
    unittest.main()
