"""Closing-soon alerts for saved requirements: one per saver, never the owner,
never someone who already quoted. Isolated SQLite.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import unittest
from datetime import timedelta
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app.core.clock import now_ph
from app.models.notification import Notification
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.saved_requirement import SavedRequirement
from app.models.user import User
from app.services.requirement_service import requirement_service


class SavedClosingAlertTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        p = patch("app.services.requirement_service.engine", self.engine)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)

        self.owner = self.save(User(business_name="Owner", role="buyer", is_verified=True))
        self.saver = self.save(User(business_name="Saver", role="seller", is_verified=True))
        self.quoter = self.save(User(business_name="Quoter", role="seller", is_verified=True))
        self.req = self.save(Requirement(ref_code="REQ-1", title="Tarps", owner_id=self.owner.id, location="Pasig",
                                         status="open", closes_at=now_ph() + timedelta(hours=5)))

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def alerts(self, user):
        with Session(self.engine) as session:
            return session.exec(select(Notification).where(Notification.user_id == user.id)
                                .where(Notification.type == "REQUIREMENT_CLOSING")).all()

    def test_saver_gets_one_alert(self):
        self.save(SavedRequirement(user_id=self.saver.id, requirement_id=self.req.id))
        requirement_service.notify_closing_soon()
        requirement_service.notify_closing_soon()
        alerts = self.alerts(self.saver)
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0].title, "A requirement you saved closes soon")
        self.assertIn("REQ-1", alerts[0].detail)
        self.assertEqual(alerts[0].related_requirement_id, self.req.id)
        # The owner still gets their own, once.
        self.assertEqual(len(self.alerts(self.owner)), 1)
        self.assertEqual(self.alerts(self.owner)[0].title, "Your requirement is closing soon")

    def test_owner_and_quoters_are_skipped(self):
        self.save(SavedRequirement(user_id=self.owner.id, requirement_id=self.req.id))
        self.save(SavedRequirement(user_id=self.quoter.id, requirement_id=self.req.id))
        self.save(Quotation(requirement_id=self.req.id, business_id=self.quoter.id, submission_hash="h",
                            status="sealed", total_price=1000))
        requirement_service.notify_closing_soon()
        self.assertEqual(len(self.alerts(self.quoter)), 0)
        self.assertEqual(len(self.alerts(self.owner)), 1)  # the owner alert only

    def test_not_yet_inside_the_window(self):
        with Session(self.engine) as session:
            req = session.get(Requirement, self.req.id)
            req.closes_at = now_ph() + timedelta(hours=30)
            session.add(req)
            session.commit()
        self.save(SavedRequirement(user_id=self.saver.id, requirement_id=self.req.id))
        requirement_service.notify_closing_soon()
        self.assertEqual(len(self.alerts(self.saver)), 0)


if __name__ == "__main__":
    unittest.main()
