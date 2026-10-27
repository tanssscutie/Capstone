"""Structured NCR delivery address: barangay + ZIP. Isolated SQLite.

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

from app.api.routes.meta import router as meta_router
from app.api.routes.requirements import router as requirements_router
from app.core import addresses
from app.core.security import require_buyer
from app.models.requirement import Requirement
from app.models.user import User


class AddressDataTests(unittest.TestCase):
    def test_every_ncr_city_has_its_barangays_and_zips(self):
        data = {c["city"]: c for c in addresses.ncr_addresses_out()}
        self.assertEqual(len(data), 17)
        self.assertEqual(sum(len(c["barangays"]) for c in data.values()), 1715)
        for city, entry in data.items():
            self.assertTrue(entry["barangays"], city)
            self.assertTrue(entry["zips"], city)
            for z in entry["zips"]:
                self.assertRegex(z["zip"], r"^\d{4}$")

    def test_auto_zip_is_only_ever_one_of_the_citys_own(self):
        for c in addresses.ncr_addresses_out():
            city_zips = {z["zip"] for z in c["zips"]}
            for b in c["barangays"]:
                if b["zip"]:
                    self.assertIn(b["zip"], city_zips, (c["city"], b["name"]))

    def test_compose(self):
        self.assertEqual(addresses.compose_site_address("Unit 4B, Exchange Rd.", "San Antonio", "1605"),
                         "Unit 4B, Exchange Rd., Brgy. San Antonio 1605")
        self.assertEqual(addresses.compose_site_address("12 Rizal Ave.", "Barangay 12", "1012"),
                         "12 Rizal Ave., Barangay 12 1012")
        self.assertEqual(addresses.compose_site_address("Ortigas Ave.", None, None), "Ortigas Ave.")


class DeliveryAddressApiTests(unittest.TestCase):
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

        with Session(self.engine) as session:
            buyer = User(business_name="Buyer", role="buyer", industry_category="Printing",
                         is_verified=True, verification_status="verified")
            session.add(buyer)
            session.commit()
            session.refresh(buyer)
            session.expunge(buyer)
        app = FastAPI()
        app.include_router(requirements_router, prefix="/requirements")
        app.include_router(meta_router, prefix="/meta")
        app.dependency_overrides[require_buyer] = lambda: buyer
        self.client = TestClient(app)

    def post(self, **overrides):
        payload = dict(
            category="Printing", item_code="tarpaulin", title="Event tarpaulins", scope="Tarpaulins for a store opening.",
            specifications=[{"label": "Size (ft)", "value": "3 x 6"}, {"label": "Finish", "value": "Matte"}],
            quantity="10 pcs", price_min=1000, price_max=2000, city="Quezon City",
            site_address="Unit 4B, 12 Commonwealth Ave.", barangay="alicia", zip_code="1105",
            required_documents=["BIR 2303"], closes_at=(datetime.now() + timedelta(days=7)).isoformat(),
        )
        payload.update(overrides)
        return self.client.post("/requirements", json=payload)

    def test_meta_endpoint_is_public(self):
        r = self.client.get("/meta/ncr-addresses")
        self.assertEqual(r.status_code, 200)
        qc = next(c for c in r.json() if c["city"] == "Quezon City")
        self.assertIn({"name": "Alicia", "zip": "1105"}, qc["barangays"])

    def test_structured_address_is_validated_and_composed(self):
        r = self.post()
        self.assertEqual(r.status_code, 201, r.text)
        body = r.json()
        self.assertEqual((body["barangay"], body["zip_code"]), ("Alicia", "1105"))  # PSGC spelling
        self.assertEqual(body["site_address"], "Unit 4B, 12 Commonwealth Ave., Brgy. Alicia 1105")
        with Session(self.engine) as session:
            req = session.get(Requirement, body["id"])
        self.assertEqual(req.location, "Quezon City — Unit 4B, 12 Commonwealth Ave., Brgy. Alicia 1105")

    def test_rejections(self):
        self.assertEqual(self.post(barangay="Not A Barangay").status_code, 422)
        self.assertEqual(self.post(barangay="Alicia", city="Pasig").status_code, 422)  # wrong city
        self.assertEqual(self.post(zip_code=None).status_code, 422)
        self.assertEqual(self.post(zip_code="11O5").status_code, 422)
        self.assertEqual(self.post(zip_code="110").status_code, 422)

    def test_older_clients_without_barangay_still_work(self):
        r = self.post(barangay=None, zip_code=None, site_address="Ortigas Ave.")
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["site_address"], "Ortigas Ave.")


if __name__ == "__main__":
    unittest.main()
