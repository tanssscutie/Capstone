"""Completed TrustLink orders in Past work: suggested to the supplier, shown
only when they opt in, never with a price. Isolated SQLite.

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

from app.api.routes.business import router as business_router
from app.core.clock import now_ph
from app.core.security import get_current_user
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.transaction_closeout import TransactionCloseout
from app.models.user import User


class CompletedWorkTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        p = patch("app.services.portfolio_service.engine", self.engine)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)
        self.buyer = self.save(User(business_name="Acme Retail", role="buyer"))
        self.supplier = self.save(User(business_name="Print Co", role="seller"))
        self.other = self.save(User(business_name="Other Co", role="seller"))
        self.done = self.order("REQ-1", completed=True)
        self.ongoing = self.order("REQ-2", completed=False)

        self.current = self.supplier
        app = FastAPI()
        app.include_router(business_router, prefix="/business")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def order(self, ref, completed):
        req = self.save(Requirement(ref_code=ref, title="Event tarpaulin", owner_id=self.buyer.id, location="Pasig",
                                    category="Printing", quantity="50 pcs", city="Pasig", status="awarded",
                                    closes_at=now_ph() - timedelta(days=9)))
        q = self.save(Quotation(requirement_id=req.id, business_id=self.supplier.id, submission_hash="h",
                                status="released", total_price=12345))
        req.awarded_quotation_id = q.id
        self.save(req)
        if completed:
            self.save(TransactionCloseout(requirement_id=req.id, outcome="completed", proposed_by=self.supplier.id,
                                          proposed_by_role="supplier", status="confirmed", responded_at=now_ph()))
        return req

    def as_(self, user):
        self.current = user
        return self.client

    def test_suggest_then_show_then_hide(self):
        suggested = self.as_(self.supplier).get("/business/portfolio/suggestions").json()
        self.assertEqual([s["ref_code"] for s in suggested], ["REQ-1"])
        self.assertEqual(self.as_(self.buyer).get(f"/business/{self.supplier.id}/completed-work").json(), [])

        r = self.as_(self.supplier).post(f"/business/portfolio/showcase/{self.done.id}", json={"show": True})
        self.assertEqual(r.status_code, 204)
        shown = self.as_(self.buyer).get(f"/business/{self.supplier.id}/completed-work").json()
        self.assertEqual(len(shown), 1)
        self.assertEqual(shown[0]["buyer_name"], "Acme Retail")
        self.assertEqual(shown[0]["quantity"], "50 pcs")
        self.assertNotIn("12345", str(shown))
        self.assertNotIn("price", str(shown).lower())
        self.assertEqual(self.as_(self.supplier).get("/business/portfolio/suggestions").json(), [])

        self.as_(self.supplier).post(f"/business/portfolio/showcase/{self.done.id}", json={"show": False})
        self.assertEqual(self.client.get(f"/business/{self.supplier.id}/completed-work").json(), [])

    def test_only_own_completed_orders(self):
        self.assertEqual(self.as_(self.supplier).post(
            f"/business/portfolio/showcase/{self.ongoing.id}", json={"show": True}).status_code, 409)
        self.assertEqual(self.as_(self.other).post(
            f"/business/portfolio/showcase/{self.done.id}", json={"show": True}).status_code, 409)
        self.assertEqual(self.as_(self.buyer).post(
            f"/business/portfolio/showcase/{self.done.id}", json={"show": True}).status_code, 409)


if __name__ == "__main__":
    unittest.main()
