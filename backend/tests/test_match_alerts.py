""""New requirement that matches you" alerts for sellers. Isolated SQLite.

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
from sqlmodel import SQLModel, Session, create_engine, select

from app.api.routes.requirements import router as requirements_router
from app.core.security import require_buyer
from app.models.notification import Notification
from app.models.user import User


def seller(name, category="Printing", items=None, **kwargs):
    fields = dict(business_name=name, role="seller", industry_category=category, is_verified=True,
                  verification_status="verified")
    fields.update(kwargs)
    if items is not None:
        fields["offered_items"] = json.dumps([{"code": c, "other_text": None} for c in items])
    return User(**fields)


class MatchAlertTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        p = patch("app.services.requirement_service.engine", self.engine)
        p.start()
        self.addCleanup(p.stop)
        p = patch("app.services.requirement_service.matching_service")
        p.start().embed_to_json.return_value = ""
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.buyer = self.save(User(business_name="Buyer", role="buyer", industry_category="Printing",
                                    is_verified=True, verification_status="verified"))
        app = FastAPI()
        app.include_router(requirements_router, prefix="/requirements")
        app.dependency_overrides[require_buyer] = lambda: self.buyer
        self.client = TestClient(app)

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def post(self, **overrides):
        payload = dict(
            category="Printing", item_code="tarpaulin", title="Event tarpaulins", scope="Tarpaulins for a store opening.",
            specifications=[{"label": "Size (ft)", "value": "3 x 6"}, {"label": "Finish", "value": "Matte"}],
            quantity="10 pcs", price_min=1000, price_max=2000, city="Pasig", site_address="Unit 4B, Ortigas Ave.",
            required_documents=["BIR 2303"], closes_at=(datetime.now() + timedelta(days=7)).isoformat(),
        )
        payload.update(overrides)
        r = self.client.post("/requirements", json=payload)
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()

    def alerted(self):
        with Session(self.engine) as session:
            rows = session.exec(select(Notification).where(Notification.type == "REQUIREMENT_MATCH")).all()
        return {n.user_id: n for n in rows}

    def test_only_verified_sellers_in_category_offering_the_item(self):
        tarp = self.save(seller("Tarp shop", items=["tarpaulin"]))
        legacy = self.save(seller("No items picked"))  # cold start: category alone
        other_item = self.save(seller("Flyers only", items=["flyers_brochures"]))
        offers_other = self.save(seller("Anything", items=["other"]))
        packaging = self.save(seller("Boxes", category="Packaging & Labeling"))
        unverified = self.save(seller("Pending", is_verified=False, verification_status="pending"))
        inactive = self.save(seller("Gone", items=["tarpaulin"], is_active=False))
        muted = self.save(seller("Muted", items=["tarpaulin"], notify_activity=False))

        req = self.post()
        alerted = self.alerted()
        self.assertEqual(set(alerted), {tarp.id, legacy.id, offers_other.id})
        for not_alerted in (other_item, packaging, unverified, inactive, muted, self.buyer):
            self.assertNotIn(not_alerted.id, alerted)

        n = alerted[tarp.id]
        self.assertEqual(n.related_requirement_id, req["id"])
        self.assertEqual(n.title, "New Tarpaulin requirement that matches your business")
        self.assertIn(req["ref_code"], n.detail)

    def test_alert_failure_never_blocks_posting(self):
        self.save(seller("Tarp shop", items=["tarpaulin"]))
        with patch("app.services.requirement_service.notif_repo.create_if_allowed", side_effect=RuntimeError("db down")):
            self.post()  # still 201


if __name__ == "__main__":
    unittest.main()
