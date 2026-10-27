"""Release alerts: when quotations open, the buyer AND every respondent is
alerted. Isolated SQLite.

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
from app.core.config import settings
from app.models.notification import Notification
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.services.requirement_service import requirement_service


class ReleaseAlertTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        p = patch("app.services.requirement_service.engine", self.engine)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)
        self.buyer = self.save(User(business_name="Buyer", role="buyer", is_verified=True))
        n = settings.MIN_QUOTATIONS_TO_RELEASE
        self.sellers = [self.save(User(business_name=f"S{i}", role="seller", is_verified=True)) for i in range(n + 1)]

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def test_every_respondent_and_buyer_alerted(self):
        req = self.save(Requirement(ref_code="REQ-1", title="Tarps", owner_id=self.buyer.id, location="Pasig",
                                    category="Printing", status="open", closes_at=now_ph() - timedelta(minutes=1)))
        respondents = self.sellers[:settings.MIN_QUOTATIONS_TO_RELEASE]
        for s in respondents:
            self.save(Quotation(requirement_id=req.id, business_id=s.id, submission_hash="h",
                                status="sealed", total_price=1000))
        self.assertEqual(requirement_service.release_due_requirements(), 1)
        with Session(self.engine) as session:
            alerts = session.exec(select(Notification).where(Notification.type == "REQUIREMENT_RELEASED")).all()
        alerted = {a.user_id for a in alerts}
        self.assertEqual(alerted, {self.buyer.id, *(s.id for s in respondents)})
        self.assertNotIn(self.sellers[-1].id, alerted)
        self.assertTrue(all(a.related_requirement_id == req.id for a in alerts))


if __name__ == "__main__":
    unittest.main()
