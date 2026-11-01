"""Quotations above the buyer's budget: indicative (default) needs a reason,
which is sealed with the quotation; a strict maximum refuses them.
Isolated SQLite.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import unittest
from datetime import timedelta
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.api.routes.requirements import router as requirements_router
from app.core.clock import now_ph
from app.core.security import get_current_user
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.services.requirement_service import requirement_service

REASON = "Includes delivery to Caloocan and matte lamination."


class BudgetRuleTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        p = patch("app.services.requirement_service.engine", self.engine)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True))
        self.seller = self.save(User(business_name="Seller", role="seller", is_verified=True))
        self.req = self.save(Requirement(ref_code="REQ-1", title="Flyers", owner_id=self.buyer.id, location="Pasig",
                                         price_min=5000, price_max=9000, status="open",
                                         closes_at=now_ph() + timedelta(days=2)))
        app = FastAPI()
        app.include_router(requirements_router, prefix="/requirements")
        app.dependency_overrides[get_current_user] = lambda: self.seller
        self.client = TestClient(app)

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def submit(self, total, reason=None):
        return self.client.post(f"/requirements/{self.req.id}/quotations",
                                json={"total_price": total, "over_budget_reason": reason})

    def quotation(self):
        with Session(self.engine) as session:
            return session.query(Quotation).first()

    def test_within_budget_needs_no_reason(self):
        r = self.submit(9000, reason="not needed here at all")
        self.assertEqual(r.status_code, 201, r.text)
        self.assertIsNone(self.quotation().over_budget_reason)

    def test_above_indicative_budget_needs_a_reason(self):
        r = self.submit(9500)
        self.assertEqual(r.status_code, 422)
        self.assertIn("₱9,000", r.json()["detail"])
        self.assertEqual(self.submit(9500, "too short").status_code, 422)
        self.assertEqual(self.submit(9500, REASON).status_code, 201)
        self.assertEqual(self.quotation().over_budget_reason, REASON)

    def test_reason_is_sealed_and_survives_release(self):
        self.submit(9500, REASON)
        with Session(self.engine) as session:
            req = session.get(Requirement, self.req.id)
            requirement_service._release_one(session, req)
        self.assertEqual(self.quotation().integrity_status, "valid")
        # Tampering with the reason after sealing is caught.
        with Session(self.engine) as session:
            q = session.query(Quotation).first()
            q.status, q.over_budget_reason = "sealed", "Changed later"
            session.add(q)
            req = session.get(Requirement, self.req.id)
            req.status = "open"
            session.add(req)
            session.commit()
            requirement_service._release_one(session, session.get(Requirement, self.req.id))
        self.assertEqual(self.quotation().integrity_status, "flagged")

    def test_strict_maximum_refuses(self):
        with Session(self.engine) as session:
            req = session.get(Requirement, self.req.id)
            req.strict_budget = True
            session.add(req)
            session.commit()
        r = self.submit(9500, REASON)
        self.assertEqual(r.status_code, 422)
        self.assertIn("strict maximum", r.json()["detail"])
        self.assertEqual(self.submit(9000).status_code, 201)


if __name__ == "__main__":
    unittest.main()
