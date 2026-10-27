"""Spec-by-spec quotation responses, using isolated SQLite.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import json
import os
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.api.routes.requirements import router as requirements_router
from app.core.security import require_seller
from app.core.config import settings
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.services.requirement_service import requirement_service

SPECS = [
    {"label": "Size (ft)", "value": "3 x 6", "attribute_id": "size"},
    {"label": "Preferred brand", "value": "Epson", "attribute_id": "preferred_brand"},
    {"label": "Rush", "value": "Yes"},  # the buyer's own row, no attribute
]


class SpecResponseTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        p = patch("app.services.requirement_service.engine", self.engine)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)
        # These test messaging/integrity, not the minimum-quotations rule.
        p = patch.object(settings, "MIN_QUOTATIONS_TO_RELEASE", 1)
        p.start()
        self.addCleanup(p.stop)

        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True, verification_status="verified"))
        self.seller = self.save(User(business_name="Seller", role="seller", is_verified=True, verification_status="verified"))
        self.req = self.requirement(SPECS)

        app = FastAPI()
        app.include_router(requirements_router, prefix="/requirements")
        app.dependency_overrides[require_seller] = lambda: self.seller
        self.client = TestClient(app)

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def load(self, model, record_id):
        with Session(self.engine) as session:
            return session.get(model, record_id)

    def requirement(self, specs, ref="REQ-1"):
        return self.save(Requirement(ref_code=ref, title="Tarps", owner_id=self.buyer.id, category="Printing",
                                     item_code="tarpaulin", location="Pasig", specifications_json=json.dumps(specs),
                                     closes_at=datetime.now() + timedelta(days=1)))

    def submit(self, responses, req=None):
        return self.client.post(f"/requirements/{(req or self.req).id}/quotations",
                                json={"total_price": 5000, "spec_responses": responses})

    def answers(self, **overrides):
        rows = {
            "Size (ft)": {"label": "Size (ft)", "complies": True},
            "Preferred brand": {"label": "Preferred brand", "complies": False, "offered": "Canon"},
            "Rush": {"label": "Rush", "complies": True},
        }
        rows.update(overrides)
        return [r for r in rows.values() if r is not None]

    def release(self, req):
        req = self.load(Requirement, req.id)
        req.closes_at = datetime.now() - timedelta(minutes=1)
        self.save(req)
        requirement_service.release_due_requirements()

    # ---------- submission ----------

    def test_answers_are_sealed_in_requirement_order_with_its_attribute_ids(self):
        response = self.submit(list(reversed(self.answers())))
        self.assertEqual(response.status_code, 201, response.text)
        stored = json.loads(self.load(Quotation, response.json()["quotation_id"]).spec_responses)
        self.assertEqual(stored, [
            {"label": "Size (ft)", "attribute_id": "size", "complies": True, "offered": None},
            {"label": "Preferred brand", "attribute_id": "preferred_brand", "complies": False, "offered": "Canon"},
            {"label": "Rush", "attribute_id": None, "complies": True, "offered": None},
        ])

    def test_every_spec_needs_an_answer(self):
        response = self.submit(self.answers(**{"Preferred brand": None}))
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "Confirm whether you meet Preferred brand.")

    def test_unknown_or_duplicate_answers_are_rejected(self):
        extra = self.answers() + [{"label": "Color", "complies": True}]
        self.assertEqual(self.submit(extra).status_code, 422)
        duplicate = self.answers() + [{"label": "Rush", "complies": True}]
        self.assertEqual(self.submit(duplicate).status_code, 422)

    def test_not_complying_needs_what_is_offered_instead(self):
        response = self.submit(self.answers(**{"Size (ft)": {"label": "Size (ft)", "complies": False, "offered": "  "}}))
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "Say what you're offering instead for Size (ft).")

    def test_offered_is_dropped_when_complying(self):
        response = self.submit(self.answers(Rush={"label": "Rush", "complies": True, "offered": "ignored"}))
        stored = json.loads(self.load(Quotation, response.json()["quotation_id"]).spec_responses)
        self.assertIsNone(stored[2]["offered"])

    # ---------- release + integrity ----------

    def test_released_quotation_shows_answers_and_passes_integrity(self):
        quotation_id = self.submit(self.answers()).json()["quotation_id"]
        self.release(self.req)
        self.assertEqual(self.load(Quotation, quotation_id).integrity_status, "valid")
        view = requirement_service.list_quotations_view(self.req.id, self.buyer.id)
        responses = view.quotations[0].spec_responses
        self.assertEqual([(r.label, r.complies, r.offered) for r in responses],
                         [("Size (ft)", True, None), ("Preferred brand", False, "Canon"), ("Rush", True, None)])

    def test_tampered_answers_are_flagged_at_release(self):
        quotation_id = self.submit(self.answers()).json()["quotation_id"]
        q = self.load(Quotation, quotation_id)
        rows = json.loads(q.spec_responses)
        rows[1] = {**rows[1], "complies": True, "offered": None}
        q.spec_responses = json.dumps(rows)
        self.save(q)
        self.release(self.req)
        self.assertEqual(self.load(Quotation, quotation_id).integrity_status, "flagged")

    def test_requirement_without_specs_hashes_exactly_as_before(self):
        # No answers → no spec_responses key in the hashed payload, the same
        # payload quotations sealed before this feature were hashed with.
        req = self.requirement([], ref="REQ-2")
        response = self.submit([], req=req)
        self.assertEqual(response.status_code, 201, response.text)
        quotation_id = response.json()["quotation_id"]
        self.assertIsNone(self.load(Quotation, quotation_id).spec_responses)
        self.release(req)
        self.assertEqual(self.load(Quotation, quotation_id).integrity_status, "valid")
        self.assertEqual(requirement_service.list_quotations_view(req.id, self.buyer.id).quotations[0].spec_responses, [])


if __name__ == "__main__":
    unittest.main()
