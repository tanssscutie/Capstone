"""Locked business details and change requests (change_request_service):
onboarding edits keep the locked fields, one pending request per account,
validation, admin-only review, approve applies / reject changes nothing.
Isolated SQLite.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import unittest
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app.api.routes.business import router as business_router
from app.core.security import get_current_user
from app.models.notification import Notification
from app.models.user import User


class ChangeRequestTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.business_service.engine", "app.services.change_request_service.engine"):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        for target in ("app.services.business_service.matching_service", "app.services.change_request_service.matching_service"):
            p = patch(target)
            p.start().embed_to_json.return_value = "[]"
            self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.seller = self.save(User(
            business_name="Santiago", role="seller", is_verified=True, verification_status="verified",
            onboarding_completed=True, registered_name="Santiago Printing", business_type="SOLE_PROP",
            industry_category="Printing", city="Pasig", province="Metro Manila", contact_person="Ana Santiago",
            contact_mobile="+63 917 555 0142", capabilities="Offset,Digital,Binding", service_areas="Pasig",
            offered_items='[{"code": "tarpaulin", "other_text": null}]',
        ))
        self.admin = self.save(User(business_name="Admin", is_admin=True))
        self.current = self.seller
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

    def user(self):
        with Session(self.engine) as session:
            return session.get(User, self.seller.id)

    def request(self, changes, reason="We registered a new trade name with DTI.", user=None):
        self.current = user or self.seller
        return self.client.post("/business/change-requests", json={"changes": changes, "reason": reason})

    def review(self, request_id, approve, notes=None, user=None):
        self.current = user or self.admin
        return self.client.post(f"/business/admin/change-requests/{request_id}/review",
                                json={"approve": approve, "notes": notes})

    def test_onboarding_edit_keeps_locked_fields(self):
        r = self.client.post("/business/onboarding", json=dict(
            registered_name="Totally Different Inc", business_type="CORPORATION", industry_category="Packaging & Labeling",
            city="Makati", province="Metro Manila", contact_person="Someone Else", contact_mobile="+63 900 000 0000",
            capabilities=["Offset", "Digital", "Binding", "Large format"], service_areas=["Pasig", "Taguig"],
            offered_items=[{"code": "tarpaulin"}],
        ))
        self.assertEqual(r.status_code, 204, r.text)
        u = self.user()
        self.assertEqual(u.registered_name, "Santiago Printing")
        self.assertEqual(u.business_type, "SOLE_PROP")
        self.assertEqual(u.industry_category, "Printing")
        self.assertEqual(u.city, "Pasig")
        self.assertEqual(u.contact_person, "Ana Santiago")
        self.assertEqual(u.contact_mobile, "+63 917 555 0142")
        # Capabilities and service areas stay editable.
        self.assertEqual(u.capabilities, "Offset,Digital,Binding,Large format")
        self.assertEqual(u.service_areas, "Pasig,Taguig")

    def test_validation_and_one_pending(self):
        self.assertEqual(self.request({"email": "x@y.z"}).status_code, 422)  # not a locked field
        self.assertEqual(self.request({"registered_name": "Santiago Printing"}).status_code, 422)  # unchanged
        self.assertEqual(self.request({"industry_category": "Cooking"}).status_code, 422)
        self.assertEqual(self.request({"contact_mobile": "call me"}).status_code, 422)
        self.assertEqual(self.request({"city": "Makati"}, reason="moved").status_code, 422)  # reason too short
        r = self.request({"registered_name": "Santiago Print Shop", "city": "Makati"})
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["changes"]["city"], {"from": "Pasig", "to": "Makati"})
        self.assertEqual(self.request({"province": "Rizal"}).status_code, 409)  # one pending per account
        mine = self.client.get("/business/change-requests/mine").json()
        self.assertEqual([m["status"] for m in mine], ["pending"])
        with Session(self.engine) as session:
            alert = session.exec(select(Notification).where(Notification.user_id == self.seller.id)).first()
        self.assertIn("1–3 business days", alert.detail)

    def test_only_admin_reviews(self):
        rid = self.request({"city": "Makati"}).json()["id"]
        self.current = self.seller
        self.assertEqual(self.client.get("/business/admin/change-requests").status_code, 403)
        self.assertEqual(self.review(rid, True, user=self.seller).status_code, 403)
        self.current = self.admin
        listed = self.client.get("/business/admin/change-requests").json()
        self.assertEqual(listed[0]["business_name"], "Santiago Printing")

    def test_approve_applies_and_reject_changes_nothing(self):
        rid = self.request({"contact_person": "Ben Santiago"}).json()["id"]
        self.assertEqual(self.review(rid, False).status_code, 422)  # reject needs a note
        self.assertEqual(self.review(rid, False, "Upload an updated DTI first").status_code, 204)
        self.assertEqual(self.user().contact_person, "Ana Santiago")
        self.assertEqual(self.review(rid, True).status_code, 409)  # already reviewed

        rid = self.request({"contact_person": "Ben Santiago", "industry_category": "Packaging & Labeling"}).json()["id"]
        self.assertEqual(self.review(rid, True).status_code, 204)
        u = self.user()
        self.assertEqual(u.contact_person, "Ben Santiago")
        self.assertEqual(u.industry_category, "Packaging & Labeling")
        self.assertIsNone(u.offered_items)  # picked again for the new category
        self.assertTrue(u.is_verified)


if __name__ == "__main__":
    unittest.main()
