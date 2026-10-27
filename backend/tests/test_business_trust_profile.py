"""Trust profile regressions using isolated SQLite, never the application DB.

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

from app.api.routes.business import router
from app.core.security import get_current_user
from app.models.business_document import BusinessDocument
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.services.business_service import business_service


class BusinessTrustProfileTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        self.engine_patch = patch("app.services.business_service.engine", self.engine)
        self.engine_patch.start()
        self.now = datetime(2026, 10, 13, 12)
        self.requirement_sequence = 0
        self.clock_patch = patch("app.services.business_service.now_ph", return_value=self.now)
        self.clock_patch.start()
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.engine_patch.stop)
        self.addCleanup(self.clock_patch.stop)
        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True,
                                   verification_status="verified", created_at=datetime(2025, 3, 2),
                                   verification_date=datetime(2025, 4, 3), contact_person="Private Person",
                                   contact_mobile="09123456789", hashed_password="private-hash"))
        self.seller = self.save(User(business_name="Supplier", role="seller"))
        self.admin = self.save(User(business_name="Admin", is_admin=True))
        self.app = FastAPI()
        self.app.include_router(router, prefix="/business")
        self.client = TestClient(self.app)

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def requirement(self, status="closed", **kwargs):
        self.requirement_sequence += 1
        return self.save(Requirement(ref_code=f"REQ-{self.requirement_sequence}", title="Test", owner_id=self.buyer.id,
                                     location="Manila", status=status,
                                     closes_at=kwargs.pop("closes_at", self.now - timedelta(days=1)), **kwargs))

    def quotation(self, req, status="released", **kwargs):
        return self.save(Quotation(requirement_id=req.id, business_id=self.seller.id,
                                   submission_hash="hash", status=status, total_price=987654,
                                   notes="confidential notes", **kwargs))

    def award(self, status="awarded", quote_status="released"):
        req = self.requirement(status)
        q = self.quotation(req, quote_status)
        req.awarded_quotation_id = q.id
        self.save(req)
        return req, q

    def profile(self, business=None, viewer=None):
        return business_service.get_public_profile((business or self.buyer).id, (viewer or self.seller).id)

    def test_verified_metadata_and_exact_dates_without_document_secrets(self):
        for doc_type in ("DTI", "DTI", "SEC", "BIR"):
            self.save(BusinessDocument(user_id=self.buyer.id, doc_type=doc_type, file_path="private/path",
                                       declared_owner_name="Secret", declared_business_name="Buyer",
                                       declared_id_number="123456789", validation_status="pass"))
        p = self.profile()
        self.assertTrue(p.is_verified)
        self.assertEqual(p.member_since, datetime(2025, 3, 2))
        self.assertEqual(p.verification_date, datetime(2025, 4, 3))
        self.assertEqual(p.registration_document_types, ["DTI", "SEC"])
        for secret in ("private/path", "123456789", "private-hash", "Secret"):
            self.assertNotIn(secret, p.model_dump_json())

    def test_unverified_and_stale_verification_have_no_badge_or_date(self):
        self.buyer.verification_status = "rejected"
        self.save(self.buyer)
        p = self.profile()
        self.assertFalse(p.is_verified)
        self.assertIsNone(p.verification_date)
        self.assertFalse(self.profile(self.seller, self.buyer).is_verified)

    def test_buyer_counts_only_known_posted_statuses_and_confirmed_awards(self):
        self.requirement("open")
        self.requirement("cancelled", cancelled_at=self.now)
        self.requirement("draft")
        self.award("award_pending")
        self.award()
        self.award(quote_status="withdrawn")
        p = self.profile()
        self.assertEqual(p.requirements_posted_count, 5)
        self.assertEqual(p.requirements_awarded_count, 1)
        self.assertEqual(p.quotations_awarded_count, 0)

    def test_supplier_awards_exclude_pending_shortlisted_and_withdrawn(self):
        self.award()
        self.award("award_pending")
        self.award(quote_status="withdrawn")
        self.quotation(self.requirement(), shortlisted=True)
        p = self.profile(self.seller, self.buyer)
        self.assertEqual(p.quotations_awarded_count, 1)
        self.assertEqual(p.requirements_awarded_count, 0)

    def test_cancellations_and_withdrawals_require_actual_timestamps(self):
        self.requirement("cancelled", cancelled_at=self.now)
        self.requirement("cancelled")
        req = self.requirement()
        self.quotation(req, "withdrawn", withdrawn_at=self.now)
        self.quotation(req, "withdrawn")
        self.quotation(req, "voided")
        self.assertEqual(self.profile().requirements_cancelled_count, 1)
        p = self.profile(self.seller, self.buyer)
        self.assertEqual(p.quotations_withdrawn_count, 1)
        self.assertEqual(p.quotations_submitted_count, 3)

    def test_sealed_activity_hidden_until_deadline_and_release(self):
        self.quotation(self.requirement("open"), "sealed")  # overdue, not released
        future = self.now + timedelta(days=1)
        self.quotation(self.requirement("cancelled", closes_at=future), "withdrawn", withdrawn_at=self.now)
        self.quotation(self.requirement(closes_at=future))  # even an invalid early release
        self.quotation(self.requirement(), "sealed")
        self.quotation(self.requirement())
        public = self.profile(self.seller, self.buyer)
        owner = self.profile(self.seller, self.seller)
        self.assertEqual(public.quotations_submitted_count, 1)
        self.assertEqual(public.quotations_withdrawn_count, 0)
        self.assertEqual(owner.quotations_submitted_count, 5)
        self.assertEqual(owner.quotations_withdrawn_count, 1)
        self.assertEqual(self.profile(self.seller, self.admin).quotations_submitted_count, 5)
        for secret in ("987654", "confidential notes", "submission_hash", "total_price"):
            self.assertNotIn(secret, public.model_dump_json())

    def test_contacts_hidden_from_unverified_viewers(self):
        public = self.profile()
        self.assertFalse(public.contact_details_visible)
        self.assertIsNone(public.contact_person)
        self.assertIsNone(public.contact_mobile)

    def test_contacts_visible_to_verified_viewer_owner_and_admin(self):
        self.seller.is_verified = True
        self.seller.verification_status = "verified"
        self.save(self.seller)
        for viewer in (self.seller, self.buyer, self.admin):
            own = self.profile(viewer=viewer)
            self.assertTrue(own.contact_details_visible)
            self.assertEqual(own.contact_mobile, "09123456789")
            self.assertEqual(own.contact_person, "Private Person")

    def test_incomplete_profile_has_real_creation_date_and_zero_counts(self):
        p = self.profile(self.seller, self.buyer)
        self.assertEqual(p.registered_name, "Supplier")
        self.assertEqual(p.member_since, self.seller.created_at)
        self.assertEqual(p.registration_document_types, [])
        self.assertEqual(p.quotations_submitted_count, 0)

    def test_http_authentication_required(self):
        self.assertEqual(self.client.get(f"/business/{self.buyer.id}/profile").status_code, 401)

    def test_http_uses_authenticated_viewer_and_ignores_requested_counts(self):
        self.app.dependency_overrides[get_current_user] = lambda: self.seller
        response = self.client.get(f"/business/{self.buyer.id}/profile?viewer_id={self.admin.id}&requirements_posted_count=99")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["contact_mobile"])
        self.assertEqual(response.json()["requirements_posted_count"], 0)

    def test_missing_admin_and_inactive_profiles_are_not_public_businesses(self):
        self.app.dependency_overrides[get_current_user] = lambda: self.seller
        for business_id in (99999, self.admin.id):
            self.assertEqual(self.client.get(f"/business/{business_id}/profile").status_code, 404)
        self.buyer.is_active = False
        self.save(self.buyer)
        self.assertEqual(self.client.get(f"/business/{self.buyer.id}/profile").status_code, 404)

    def test_inactive_viewer_cannot_access_contacts(self):
        self.seller.is_active = False
        self.save(self.seller)
        self.app.dependency_overrides[get_current_user] = lambda: self.seller
        self.assertEqual(self.client.get(f"/business/{self.buyer.id}/profile").status_code, 403)


if __name__ == "__main__":
    unittest.main()
