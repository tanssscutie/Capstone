"""Admin roles: admin vs super_admin, require_super_admin, the startup
backfill that guarantees a super admin, and the create/promote helpers used
by scripts/create_admin.py. Isolated SQLite.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import unittest
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app.core import database
from app.core.security import get_current_user, require_super_admin, verify_password
from app.models.user import User
from app.services.admin_accounts import create_admin, promote


class AdminRoleTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)

    def add(self, **kw):
        with Session(self.engine) as s:
            u = User(**kw)
            s.add(u)
            s.commit()
            s.refresh(u)
            return u.id

    def test_backfill_makes_the_oldest_active_admin_super(self):
        self.add(business_name="Old, disabled", is_admin=True, is_active=False)
        first_active = self.add(business_name="Ana", is_admin=True)
        other = self.add(business_name="Ben", is_admin=True)
        shop = self.add(business_name="Shop", role="seller")
        with patch.object(database, "engine", self.engine):
            database._migrate_admin_roles()
            database._migrate_admin_roles()  # idempotent
        with Session(self.engine) as s:
            roles = {u.id: u.admin_role for u in s.exec(select(User)).all()}
        self.assertEqual(roles[first_active], "super_admin")
        self.assertEqual(roles[other], "admin")
        self.assertIsNone(roles[shop])
        self.assertEqual(sum(1 for r in roles.values() if r == "super_admin"), 1)

    def test_backfill_keeps_an_existing_super_admin(self):
        self.add(business_name="Ana", is_admin=True, admin_role="admin")
        boss = self.add(business_name="Boss", is_admin=True, admin_role="super_admin")
        with patch.object(database, "engine", self.engine):
            database._migrate_admin_roles()
        with Session(self.engine) as s:
            supers = [u.id for u in s.exec(select(User).where(User.admin_role == "super_admin")).all()]
        self.assertEqual(supers, [boss])

    def test_require_super_admin(self):
        app = FastAPI()
        current = {}
        app.dependency_overrides[get_current_user] = lambda: current["user"]

        @app.get("/x")
        def x(_u: User = Depends(require_super_admin)):
            return {"ok": True}

        client = TestClient(app)
        for user, code in [(User(business_name="S", is_admin=True, admin_role="super_admin"), 200),
                           (User(business_name="A", is_admin=True, admin_role="admin"), 403),
                           (User(business_name="B", role="buyer"), 403)]:
            current["user"] = user
            self.assertEqual(client.get("/x").status_code, code, user.business_name)

    def test_create_and_promote(self):
        with Session(self.engine) as s:
            u = create_admin(s, "Ana Santos", " Ana@TrustLink.ph ", "longpassword", "admin")
            self.assertEqual((u.email, u.is_admin, u.admin_role), ("ana@trustlink.ph", True, "admin"))
            self.assertTrue(verify_password("longpassword", u.hashed_password))
            self.assertIsNotNone(u.privacy_consent_at)
            with self.assertRaises(HTTPException) as dup:
                create_admin(s, "Other", "ana@trustlink.ph", "longpassword")
            self.assertEqual(dup.exception.status_code, 409)
            with self.assertRaises(HTTPException):
                create_admin(s, "Short", "short@x.ph", "1234")
            self.assertEqual(promote(s, u, "super_admin").admin_role, "super_admin")

            shop = User(business_name="Shop", role="seller", email="shop@x.ph")
            s.add(shop)
            s.commit()
            with self.assertRaises(HTTPException):
                promote(s, shop, "admin")  # business accounts never become admins


if __name__ == "__main__":
    unittest.main()
