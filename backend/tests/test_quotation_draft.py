"""AI quotation draft (quotation_draft_service): template fallback without a
key, clamping of a Gemini answer, never another supplier's price, and the
same gates as submitting. Isolated SQLite; Gemini is mocked.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import json
import os
import unittest
from datetime import timedelta
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app.api.routes.requirements import router as requirements_router
from app.core.clock import now_ph
from app.core.security import get_current_user
from app.models.ledger_entry import LedgerEntry
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.services import quotation_draft_service as svc

SPECS = [{"label": "Material", "value": "Tarpaulin 13oz"}, {"label": "Size", "value": "3x6 ft"}]


class QuotationDraftTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.quotation_draft_service.engine", "app.services.requirement_service.engine"):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True))
        self.seller = self.save(User(business_name="Seller", role="seller", is_verified=True,
                                     capabilities="Tarpaulin printing", offered_items="Tarpaulin, stickers"))
        self.rival = self.save(User(business_name="Rival", role="seller", is_verified=True))
        self.req = self.save(Requirement(ref_code="REQ-1", title="Event tarps", owner_id=self.buyer.id,
                                         location="Pasig", city="Pasig", category="Printing", quantity="50 pcs",
                                         specifications_json=json.dumps(SPECS), price_min=5000, price_max=9000,
                                         status="open", closes_at=now_ph() + timedelta(days=2)))
        # Past work: the seller's own price, and a rival's price on another requirement.
        old = self.save(Requirement(ref_code="REQ-0", title="Old tarps", owner_id=self.buyer.id, location="Pasig",
                                    category="Printing", quantity="20 pcs", status="awarded",
                                    closes_at=now_ph() - timedelta(days=30)))
        self.save(Quotation(requirement_id=old.id, business_id=self.seller.id, submission_hash="a",
                            status="released", total_price=2400,
                            line_items=json.dumps([{"description": "Tarp", "quantity": 20, "unit_price": 120}])))
        self.save(Quotation(requirement_id=old.id, business_id=self.rival.id, submission_hash="b",
                            status="released", total_price=7777,
                            line_items=json.dumps([{"description": "Tarp", "quantity": 20, "unit_price": 388.85}])))

        self.current = self.seller
        app = FastAPI()
        app.include_router(requirements_router, prefix="/requirements")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def post(self, user=None):
        self.current = user or self.seller
        return self.client.post(f"/requirements/{self.req.id}/quotation-draft")

    def test_template_without_key(self):
        with patch.object(svc.settings, "GEMINI_API_KEY", ""):
            r = self.post()
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["source"], "template")
        self.assertEqual(len(body["line_items"]), 1)
        self.assertEqual(body["line_items"][0]["quantity"], 50)
        self.assertEqual(body["line_items"][0]["unit_price"], 0)
        self.assertEqual([s["label"] for s in body["spec_responses"]], ["Material", "Size"])
        self.assertTrue(all(s["complies"] for s in body["spec_responses"]))

    def test_ai_answer_is_clamped(self):
        ai = svc._AiDraft(
            line_items=[svc._AiLine(description="X" * 300, quantity=-5, unit_price=150.555),
                        svc._AiLine(description="", quantity=1, unit_price=10)],
            spec_responses=[svc._AiSpec(label="size", complies=False, offered="4x8 ft"),
                            svc._AiSpec(label="Not a spec", complies=False, offered="?")],
            lead_time_weeks=99, payment_terms="whatever", validity_days=45, notes="N" * 900,
        )
        with patch.object(svc.settings, "GEMINI_API_KEY", "k"), patch.object(svc, "_ask_gemini", return_value=ai):
            body = self.post().json()
        self.assertEqual(body["source"], "ai")
        self.assertEqual(len(body["line_items"]), 1)
        line = body["line_items"][0]
        self.assertEqual(len(line["description"]), 200)
        self.assertEqual(line["quantity"], 50)  # fell back to the requirement's quantity
        self.assertEqual(line["unit_price"], 150.56)
        self.assertEqual(body["spec_responses"], [
            {"label": "Material", "complies": True, "offered": None},
            {"label": "Size", "complies": False, "offered": "4x8 ft"},
        ])
        self.assertEqual(body["lead_time_weeks"], 52)
        self.assertEqual(body["payment_terms"], svc.DEFAULT_TERMS)
        self.assertIn(body["validity_days"], svc.VALIDITY_DAYS)
        self.assertEqual(len(body["notes"]), 500)

    def test_failed_call_falls_back(self):
        with patch.object(svc.settings, "GEMINI_API_KEY", "k"), patch.object(svc, "_ask_gemini", return_value=None):
            body = self.post().json()
        self.assertEqual(body["source"], "template")

    def test_prompt_has_own_prices_only(self):
        captured = {}

        def fake(prompt):
            captured["prompt"] = prompt
            return None

        with patch.object(svc.settings, "GEMINI_API_KEY", "k"), patch.object(svc, "_ask_gemini", side_effect=fake):
            self.post()
        prompt = captured["prompt"]
        self.assertIn("120", prompt)
        self.assertIn("Tarpaulin printing", prompt)
        self.assertIn('label "Material" — required: Tarpaulin 13oz', prompt)
        self.assertNotIn("388.85", prompt)
        self.assertNotIn("7777", prompt)

    def test_gates_and_nothing_saved(self):
        with patch.object(svc.settings, "GEMINI_API_KEY", ""):
            self.assertEqual(self.post(self.buyer).status_code, 403)  # buyers don't quote
            unverified = self.save(User(business_name="New", role="seller", is_verified=False))
            self.assertEqual(self.post(unverified).status_code, 403)
            with Session(self.engine) as session:
                before = len(session.exec(select(Quotation)).all())
                ledger = len(session.exec(select(LedgerEntry)).all())
            self.assertEqual(self.post().status_code, 200)
            with Session(self.engine) as session:
                self.assertEqual(len(session.exec(select(Quotation)).all()), before)
                self.assertEqual(len(session.exec(select(LedgerEntry)).all()), ledger)
            self.save(Quotation(requirement_id=self.req.id, business_id=self.seller.id, submission_hash="c",
                                status="sealed", total_price=6000))
            self.assertEqual(self.post().status_code, 409)  # already quoted
            with Session(self.engine) as session:
                req = session.get(Requirement, self.req.id)
                req.status = "closed"
                session.add(req)
                session.commit()
            self.assertEqual(self.post(self.rival).status_code, 409)  # not open


if __name__ == "__main__":
    unittest.main()
