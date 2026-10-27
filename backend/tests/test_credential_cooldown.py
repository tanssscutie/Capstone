"""Credential change cooldown (password, email, mobile) and the change-email
flow. Isolated SQLite, emails captured instead of sent.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import unittest
from datetime import timedelta
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.core.clock import now_ph
from app.core.security import get_password_hash, verify_password
from app.models.user import User
from app.schemas.auth import EmailChangeConfirm, EmailChangeRequest, MobileNumberChange, PasswordChange
from app.services.auth_service import auth_service

PASSWORD = "oldpassword1"


class CredentialCooldownTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        p = patch("app.services.auth_service.engine", self.engine)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)
        self.sent = []  # (kind, to, code-or-new-email)
        for name in ("send_password_change_otp_email", "send_password_reset_otp_email",
                     "send_email_change_otp_email", "send_email_changed_notice"):
            p = patch(f"app.services.auth_service.{name}", lambda to, x, _n=name: self.sent.append((_n, to, x)))
            p.start()
            self.addCleanup(p.stop)
        self.user = self.save(User(business_name="Print Co", role="seller", mobile_number="09170000001",
                                   email="old@printco.ph", hashed_password=get_password_hash(PASSWORD)))
        self.save(User(business_name="Other", role="buyer", mobile_number="09170000002", email="taken@x.ph"))

    def save(self, record):
        with Session(self.engine) as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
            return record

    def load(self):
        with Session(self.engine) as session:
            return session.get(User, self.user.id)

    def age(self, **days):
        with Session(self.engine) as session:
            u = session.get(User, self.user.id)
            for field, d in days.items():
                setattr(u, field, now_ph() - timedelta(days=d))
            session.add(u)
            session.commit()

    def last_code(self, kind):
        return next(x for n, _, x in reversed(self.sent) if n == kind)

    def change_password(self, new):
        auth_service.request_password_change_otp(self.user.id)
        code = self.last_code("send_password_change_otp_email")
        current = PASSWORD if verify_password(PASSWORD, self.load().hashed_password) else "newpassword1"
        auth_service.change_password(self.user.id, PasswordChange(current_password=current, new_password=new, code=code))

    def test_password_cooldown(self):
        self.change_password("newpassword1")
        self.assertIsNotNone(self.load().password_change_available_at)
        with self.assertRaises(HTTPException) as ctx:
            auth_service.request_password_change_otp(self.user.id)
        self.assertEqual(ctx.exception.status_code, 429)
        self.age(password_changed_at=16)
        self.assertIsNone(self.load().password_change_available_at)
        self.change_password("newpassword2")

    def test_forgot_password_is_never_blocked(self):
        self.age(password_changed_at=1)
        auth_service.request_password_reset_otp("old@printco.ph")
        code = self.last_code("send_password_reset_otp_email")
        auth_service.reset_password("old@printco.ph", code, "resetpass123")
        self.assertTrue(verify_password("resetpass123", self.load().hashed_password))

    def test_mobile_cooldown(self):
        auth_service.change_mobile_number(self.user.id, MobileNumberChange(new_mobile_number="09170000009", current_password=PASSWORD))
        with self.assertRaises(HTTPException) as ctx:
            auth_service.change_mobile_number(self.user.id, MobileNumberChange(new_mobile_number="09170000010", current_password=PASSWORD))
        self.assertEqual(ctx.exception.status_code, 429)

    def test_change_email_flow(self):
        auth_service.request_email_change_otp(self.user.id, EmailChangeRequest(new_email="New@PrintCo.ph", current_password=PASSWORD))
        kind, to, code = self.sent[-1]
        self.assertEqual((kind, to), ("send_email_change_otp_email", "new@printco.ph"))
        with self.assertRaises(HTTPException):
            auth_service.confirm_email_change(self.user.id, EmailChangeConfirm(code="000000" if code != "000000" else "111111"))
        user = auth_service.confirm_email_change(self.user.id, EmailChangeConfirm(code=code))
        self.assertEqual(user.email, "new@printco.ph")
        self.assertIn(("send_email_changed_notice", "old@printco.ph", "new@printco.ph"), self.sent)
        with self.assertRaises(HTTPException) as ctx:
            auth_service.request_email_change_otp(self.user.id, EmailChangeRequest(new_email="third@printco.ph", current_password=PASSWORD))
        self.assertEqual(ctx.exception.status_code, 429)

    def test_change_email_refusals(self):
        for email, password, expected in (("taken@x.ph", PASSWORD, 409), ("new@x.ph", "wrongpassword", 401)):
            with self.assertRaises(HTTPException) as ctx:
                auth_service.request_email_change_otp(self.user.id, EmailChangeRequest(new_email=email, current_password=password))
            self.assertEqual(ctx.exception.status_code, expected)
        with Session(self.engine) as session:
            u = session.get(User, self.user.id)
            u.google_id = "g-123"
            session.add(u)
            session.commit()
        with self.assertRaises(HTTPException) as ctx:
            auth_service.request_email_change_otp(self.user.id, EmailChangeRequest(new_email="new@x.ph", current_password=PASSWORD))
        self.assertEqual(ctx.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
