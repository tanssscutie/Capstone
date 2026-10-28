"""Profile privacy (services/profile_privacy.py): the owner picks who sees each
section — public, verified businesses only, only me — and the profile API
enforces it. Badge, tier and track record are always public; contact details
are never public; the owner and admins see everything; "View as others" shows
the owner exactly what an outsider gets. Isolated SQLite.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import json
import os
import unittest
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.api.routes.business import router
from app.core.security import get_current_user
from app.models.user import User


class ProfilePrivacyTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.business_service.engine", "app.services.portfolio_service.engine"):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.owner = self.save(User(
            business_name="Shop", registered_name="Shop Inc", role="seller", is_verified=True,
            verification_status="verified", tier=2, business_description="We print banners.",
            website_url="https://shop.example", service_areas="Pasig,Makati", capabilities="Offset",
            contact_person="Ana Cruz", contact_mobile="09171234567",
            offered_items=json.dumps([{"code": "tarpaulin"}, {"code": "other", "other_text": "Acrylic keychains"}]),
        ))
        self.verified = self.save(User(business_name="Buyer", role="buyer", is_verified=True, verification_status="verified"))
        self.unverified = self.save(User(business_name="New", role="buyer", is_verified=False, verification_status="unverified"))
        self.admin = self.save(User(business_name="Admin", is_admin=True))
        self.current = self.owner
        app = FastAPI()
        app.include_router(router, prefix="/business")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def profile(self, viewer, view_as=None):
        self.current = viewer
        suffix = f"?as={view_as}" if view_as else ""
        r = self.client.get(f"/business/{self.owner.id}/profile{suffix}")
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def set_visibility(self, **sections):
        self.current = self.owner
        return self.client.put("/business/profile/visibility", json={"sections": sections})

    def test_defaults_keep_contact_for_verified_viewers(self):
        public = self.profile(self.unverified)
        self.assertEqual(public["business_description"], "We print banners.")
        self.assertEqual(public["offered_items"], ["Tarpaulin", "Acrylic keychains"])
        self.assertIsNone(public["contact_mobile"])
        self.assertEqual(public["hidden_sections"], ["contact"])
        self.assertEqual(self.profile(self.verified)["contact_mobile"], "09171234567")

    def test_each_level_is_enforced_by_the_api(self):
        self.assertEqual(self.set_visibility(about="only_me", links="verified", service_areas="verified",
                                             offered_items="only_me", contact="only_me").status_code, 200)
        public = self.profile(self.unverified)
        self.assertIsNone(public["business_description"])
        self.assertIsNone(public["website_url"])
        self.assertEqual(public["service_areas"], [])
        self.assertEqual(public["offered_items"], [])
        verified = self.profile(self.verified)
        self.assertEqual(verified["website_url"], "https://shop.example")
        self.assertEqual(verified["service_areas"], ["Pasig", "Makati"])
        self.assertIsNone(verified["business_description"])
        self.assertIsNone(verified["contact_mobile"])  # only me now — even for verified viewers
        self.assertIn("about", verified["hidden_sections"])
        self.assertIsNone(verified["visibility"])  # the choices themselves are the owner's

    def test_badge_tier_and_track_record_always_public(self):
        self.set_visibility(about="only_me", links="only_me", highlights="only_me", offered_items="only_me",
                            service_areas="only_me", completed_orders="only_me", contact="only_me")
        public = self.profile(self.unverified)
        self.assertTrue(public["is_verified"])
        self.assertEqual(public["tier"], 2)
        self.assertIn("quotations_withdrawn_count", public)
        self.assertIn("completion_rate", public)

    def test_owner_and_admin_see_everything_and_view_as_previews(self):
        self.set_visibility(about="only_me", contact="only_me")
        own = self.profile(self.owner)
        self.assertEqual(own["business_description"], "We print banners.")
        self.assertEqual(own["visibility"]["about"], "only_me")
        self.assertEqual(self.profile(self.admin)["contact_mobile"], "09171234567")
        preview = self.profile(self.owner, view_as="public")
        self.assertIsNone(preview["business_description"])
        self.assertIsNone(preview["contact_mobile"])
        self.assertFalse(preview["includes_sealed_activity"])
        self.assertEqual(preview["viewing_as"], "public")
        # Anyone else's ?as= is ignored.
        self.assertIsNone(self.profile(self.verified, view_as="public")["viewing_as"])

    def test_completed_orders_follow_the_setting(self):
        self.set_visibility(completed_orders="verified")
        with patch("app.api.routes.business.portfolio_service.completed_work", return_value=[]) as listed:
            self.current = self.unverified
            self.assertEqual(self.client.get(f"/business/{self.owner.id}/completed-work").json(), [])
            listed.assert_not_called()  # withheld before the orders are even read
            self.current = self.verified
            self.client.get(f"/business/{self.owner.id}/completed-work")
            listed.assert_called_once()

    def test_bad_choices_are_refused(self):
        self.assertEqual(self.set_visibility(contact="public").status_code, 422)
        self.assertEqual(self.set_visibility(about="everyone").status_code, 422)
        self.assertEqual(self.set_visibility(secret_section="public").status_code, 422)


if __name__ == "__main__":
    unittest.main()
