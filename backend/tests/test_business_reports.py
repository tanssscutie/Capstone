""""Report this business" and the admin's review. Isolated SQLite.

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
from app.models.business_report import BusinessReport
from app.models.notification import Notification
from app.models.user import User

DETAILS = "Took the deposit then stopped replying after the award."


class BusinessReportTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        for target in ("app.services.report_service.engine", "app.services.business_service.engine"):
            p = patch(target, self.engine)
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True, verification_status="verified"))
        self.supplier = self.save(User(business_name="Shady Prints", role="seller", is_verified=True,
                                       verification_status="verified"))
        self.unverified = self.save(User(business_name="New", role="buyer", is_verified=False))
        self.admin = self.save(User(business_name="Admin", is_admin=True))

        self.current = self.buyer
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

    def report(self, target=None, user=None, **overrides):
        self.current = user or self.buyer
        payload = dict(reason="NOT_HONORED", details=DETAILS)
        payload.update(overrides)
        return self.client.post(f"/business/{(target or self.supplier).id}/report", json=payload)

    def as_admin(self):
        self.current = self.admin
        return self.client

    def test_report_is_filed_and_shown_to_admin(self):
        self.assertEqual(self.report().status_code, 201)
        rows = self.as_admin().get("/business/admin/reports").json()
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual((r["reporter_name"], r["reported_name"], r["status"]), ("Buyer", "Shady Prints", "open"))
        self.assertEqual(r["reason_label"], "Didn't honor an award or agreement")
        self.assertEqual(r["reported_open_reports"], 1)
        self.assertEqual(self.as_admin().get("/business/admin/stats").json()["open_reports_count"], 1)

    def test_reported_business_is_never_told(self):
        self.report()
        with Session(self.engine) as session:
            self.assertEqual(session.exec(select(Notification)).all(), [])
        self.current = self.supplier
        self.assertEqual(self.client.get("/business/admin/reports").status_code, 403)

    def test_guards(self):
        self.assertEqual(self.report(target=self.buyer).status_code, 400)            # self
        self.assertEqual(self.report(target=self.admin).status_code, 404)            # admin
        self.assertEqual(self.report(user=self.unverified).status_code, 403)         # unverified reporter
        self.assertEqual(self.report(reason="BOGUS").status_code, 422)               # unknown reason
        self.assertEqual(self.report(details="bad").status_code, 422)                # too short
        self.assertEqual(self.report().status_code, 201)
        self.assertEqual(self.report().status_code, 409)                             # one open per pair

    def test_daily_cap(self):
        targets = [self.save(User(business_name=f"Shop {i}", role="seller", is_verified=True)) for i in range(6)]
        for t in targets[:5]:
            self.assertEqual(self.report(target=t).status_code, 201)
        self.assertEqual(self.report(target=targets[5]).status_code, 429)

    def test_admin_review_closes_the_report(self):
        self.report()
        with Session(self.engine) as session:
            report_id = session.exec(select(BusinessReport)).one().id
        r = self.as_admin().post(f"/business/admin/reports/{report_id}/review",
                                 json={"action": "warn", "notes": "Asked them to re-verify."})
        self.assertEqual(r.status_code, 204)
        row = self.as_admin().get("/business/admin/reports").json()[0]
        self.assertEqual((row["status"], row["admin_notes"]), ("resolved", "Asked them to re-verify."))
        self.assertEqual(self.as_admin().post(f"/business/admin/reports/{report_id}/review",
                                              json={"action": "dismiss"}).status_code, 409)
        self.assertEqual(self.report().status_code, 201)  # can report again once the first is closed


if __name__ == "__main__":
    unittest.main()
