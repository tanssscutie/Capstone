"""Email copies of the important in-app alerts. Isolated SQLite; no SMTP.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import threading
import time
import unittest
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.models.notification import Notification
from app.models.user import User
from app.repositories import notification_repository as notif_repo
from app.services import email_service


class EmailAlertTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        self.sent = []
        self.done = threading.Event()

        def fake_send(to, subject, body):
            self.sent.append((to, subject, body))
            self.done.set()

        p = patch.object(email_service, "send_email", side_effect=fake_send)
        p.start()
        self.addCleanup(p.stop)

    def user(self, **kwargs):
        fields = dict(business_name="Shop", email="shop@example.com")
        fields.update(kwargs)
        with Session(self.engine) as session:
            u = User(**fields)
            session.add(u)
            session.commit()
            session.refresh(u)
            return u.id

    def alert(self, user_id, type_="DECISION", category="activity", rid=7):
        with Session(self.engine) as session:
            return notif_repo.create_if_allowed(session, user_id=user_id, type_=type_, category=category,
                                                title="You've been proposed as the winner",
                                                detail="RQ-601 · Tarps — respond within 3 days.",
                                                related_requirement_id=rid)

    def wait(self):
        self.done.wait(2)
        time.sleep(0.05)  # let any other queued send land before asserting
        return self.sent

    def test_important_alert_is_emailed_with_a_link(self):
        uid = self.user()
        self.assertIsNotNone(self.alert(uid))
        (to, subject, body), = self.wait()
        self.assertEqual(to, "shop@example.com")
        self.assertIn("You've been proposed as the winner", subject)
        self.assertIn("RQ-601", body)
        self.assertIn("/requirement?id=7", body)

    def test_chat_and_qa_stay_in_app_only(self):
        uid = self.user()
        self.alert(uid, type_="MESSAGE_RECEIVED", category="messages")
        self.alert(uid, type_="QUESTION_ASKED")
        self.assertEqual(self.wait(), [])
        with Session(self.engine) as session:
            self.assertEqual(len(session.query(Notification).all()), 2)  # still created in-app

    def test_respects_preferences_and_missing_email(self):
        self.alert(self.user(notify_email=False))
        self.alert(self.user(email=None, business_name="No email"))
        self.alert(self.user(notify_activity=False, email="muted@example.com"))  # no alert at all
        self.assertEqual(self.wait(), [])

    def test_slow_or_failing_smtp_never_blocks_or_breaks_the_alert(self):
        def slow_fail(*_):
            time.sleep(0.5)
            raise email_service.EmailSendError("smtp down")

        uid = self.user()
        with patch.object(email_service, "send_email", side_effect=slow_fail):
            start = time.time()
            notification = self.alert(uid)
            self.assertLess(time.time() - start, 0.3)
        self.assertIsNotNone(notification)


if __name__ == "__main__":
    unittest.main()
