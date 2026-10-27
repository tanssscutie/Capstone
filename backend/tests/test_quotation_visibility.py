"""Sealed bidding: only a requirement's owner (and admins) can read its
quotations — never a competing respondent, even after release. Isolated SQLite.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
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
from app.core.security import get_current_user
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User


class QuotationVisibilityTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        p = patch("app.services.requirement_service.engine", self.engine)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True))
        self.supplier_a = self.save(User(business_name="Supplier A", role="seller", is_verified=True))
        self.supplier_b = self.save(User(business_name="Supplier B", role="seller", is_verified=True))
        self.stranger = self.save(User(business_name="Other buyer", role="buyer", is_verified=True))
        self.admin = self.save(User(business_name="Admin", is_admin=True))

        self.released = self.save(Requirement(ref_code="REQ-1", title="Tarps", owner_id=self.buyer.id, location="Pasig",
                                              status="closed", closes_at=datetime.now() - timedelta(days=1)))
        self.open = self.save(Requirement(ref_code="REQ-2", title="Boxes", owner_id=self.buyer.id, location="Pasig",
                                          status="open", closes_at=datetime.now() + timedelta(days=1)))
        for business, price in ((self.supplier_a, 5000), (self.supplier_b, 4200)):
            self.save(Quotation(requirement_id=self.released.id, business_id=business.id, submission_hash="h",
                                status="released", total_price=price, notes="secret terms"))
            self.save(Quotation(requirement_id=self.open.id, business_id=business.id, submission_hash="h",
                                status="sealed", total_price=price))

        self.current = self.buyer
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

    def view(self, user, req):
        self.current = user
        return self.client.get(f"/requirements/{req.id}/quotations")

    def test_owner_and_admin_see_released_quotations(self):
        for user in (self.buyer, self.admin):
            r = self.view(user, self.released)
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual(sorted(q["total_price"] for q in r.json()["quotations"]), [4200, 5000])

    def test_competing_respondent_cannot_read_prices_after_release(self):
        r = self.view(self.supplier_a, self.released)
        self.assertEqual(r.status_code, 403)
        self.assertNotIn("4200", r.text)
        self.assertNotIn("secret terms", r.text)

    def test_unrelated_business_is_refused_sealed_or_released(self):
        for req in (self.released, self.open):
            self.assertEqual(self.view(self.stranger, req).status_code, 403)
            self.assertEqual(self.view(self.supplier_b, req).status_code, 403)

    def test_owner_still_gets_only_a_count_while_sealed(self):
        r = self.view(self.buyer, self.open)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["sealed_count"], 2)
        self.assertFalse(r.json().get("quotations"))


if __name__ == "__main__":
    unittest.main()
