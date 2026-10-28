"""AI Detail draft for buyers (requirement_detail_draft_service): template
without a key, the AI path, fallback on a failed or empty answer, clamping,
and the buyer-only gate. Nothing touches the database; Gemini is mocked.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import unittest
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.requirements import router as requirements_router
from app.core.security import get_current_user
from app.models.user import User
from app.services import requirement_detail_draft_service as svc

BODY = {
    "category": "Printing",
    "item": "Tarpaulin",
    "title": "Store opening tarps",
    "specifications": [{"label": "Size", "value": "3x6 ft"}, {"label": "Finish", "value": ""}],
    "quantity": "10 pcs",
    "price_min": 1000,
    "price_max": 2000,
    "strict_budget": True,
}


class DetailDraftTests(unittest.TestCase):
    def setUp(self):
        self.current = User(id=1, business_name="Buyer", role="buyer", is_verified=True, verification_status="verified")
        app = FastAPI()
        app.include_router(requirements_router, prefix="/requirements")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

    def post(self, body=None):
        return self.client.post("/requirements/detail-draft", json=body if body is not None else BODY)

    def test_template_without_key(self):
        with patch.object(svc.settings, "GEMINI_API_KEY", ""), patch.object(svc, "_ask_gemini") as ask:
            res = self.post()
        self.assertEqual(res.status_code, 200)
        out = res.json()
        self.assertEqual(out["source"], "template")
        self.assertIn("10 pcs of Tarpaulin", out["text"])
        self.assertIn("Size: 3x6 ft", out["text"])
        self.assertNotIn("Finish", out["text"])  # empty spec rows are left out
        self.assertIn("strict maximum", out["text"])
        ask.assert_not_called()

    def test_ai_answer_is_used_and_clamped(self):
        with patch.object(svc.settings, "GEMINI_API_KEY", "key"), \
                patch.object(svc, "_ask_gemini", return_value=svc._AiDetail(detail="  " + "x" * 4000)) as ask:
            out = self.post().json()
        self.assertEqual(out["source"], "ai")
        self.assertEqual(len(out["text"]), svc.SCOPE_MAX)
        prompt = ask.call_args.args[0]
        self.assertIn("Store opening tarps", prompt)
        self.assertIn("Size: 3x6 ft", prompt)

    def test_failed_or_empty_answer_falls_back(self):
        for answer in (None, svc._AiDetail(detail="short")):
            with patch.object(svc.settings, "GEMINI_API_KEY", "key"), patch.object(svc, "_ask_gemini", return_value=answer):
                out = self.post().json()
            self.assertEqual(out["source"], "template")
            self.assertGreaterEqual(len(out["text"]), svc.SCOPE_MIN)

    def test_works_with_an_empty_step(self):
        with patch.object(svc.settings, "GEMINI_API_KEY", ""):
            res = self.post({})
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(len(res.json()["text"]), svc.SCOPE_MIN)

    def test_sellers_cannot_use_it(self):
        self.current = User(id=2, business_name="Seller", role="seller", is_verified=True, verification_status="verified")
        self.assertEqual(self.post().status_code, 403)


if __name__ == "__main__":
    unittest.main()
