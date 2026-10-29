"""Admin team (super admins only): create, promote/demote, disable/enable,
reset password — and the platform is never left without an active super
admin. Isolated SQLite.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import os
import unittest
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine

from app.api.routes.admin_team import router as team_router
from app.core.security import get_current_user, verify_password
from app.models.user import User


class AdminTeamTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        p = patch("app.services.admin_team_service.engine", self.engine)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self.engine.dispose)
        self.boss = self.save(User(business_name="Boss", email="boss@x.ph", is_admin=True, admin_role="super_admin"))
        self.ana = self.save(User(business_name="Ana", email="ana@x.ph", is_admin=True, admin_role="admin"))
        self.current = self.boss
        app = FastAPI()
        app.include_router(team_router, prefix="/business")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

    def save(self, record):
        with Session(self.engine) as s:
            s.add(record)
            s.commit()
            s.refresh(record)
            s.expunge(record)
            return record

    def get(self, uid):
        with Session(self.engine) as s:
            return s.get(User, uid)

    def test_only_super_admins(self):
        self.current = self.ana
        self.assertEqual(self.client.get("/business/admin/team").status_code, 403)
        self.assertEqual(self.client.post(f"/business/admin/team/{self.ana.id}/role", json={"role": "super_admin"}).status_code, 403)

    def test_create_and_list(self):
        r = self.client.post("/business/admin/team", json={"name": "Carlo", "email": "carlo@x.ph", "password": "longpassword"})
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["admin_role"], "admin")
        self.assertEqual([m["name"] for m in self.client.get("/business/admin/team").json()], ["Boss", "Ana", "Carlo"])
        self.assertEqual(self.client.post("/business/admin/team", json={"name": "Dup", "email": "carlo@x.ph",
                                                                        "password": "longpassword"}).status_code, 409)
        self.assertEqual(self.client.post("/business/admin/team", json={"name": "Weak", "email": "weak@x.ph",
                                                                        "password": "short"}).status_code, 422)

    def test_last_super_admin_is_protected(self):
        r = self.client.post(f"/business/admin/team/{self.boss.id}/role", json={"role": "admin"})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.get(self.boss.id).admin_role, "super_admin")

        # With a second active super admin, demoting works.
        self.client.post(f"/business/admin/team/{self.ana.id}/role", json={"role": "super_admin"})
        self.assertEqual(self.client.post(f"/business/admin/team/{self.boss.id}/role", json={"role": "admin"}).status_code, 200)
        # Now Ana is the last active super admin: she can't demote herself.
        self.current = self.get(self.ana.id)
        self.assertEqual(self.client.post(f"/business/admin/team/{self.ana.id}/role", json={"role": "admin"}).status_code, 409)

    def test_disable_rules(self):
        self.assertEqual(self.client.post(f"/business/admin/team/{self.boss.id}/active", json={"active": False}).status_code, 409)
        r = self.client.post(f"/business/admin/team/{self.ana.id}/active", json={"active": False})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(self.get(self.ana.id).is_active)
        self.client.post(f"/business/admin/team/{self.ana.id}/active", json={"active": True})
        self.assertTrue(self.get(self.ana.id).is_active)

    def test_disabled_super_admin_does_not_count(self):
        other = self.save(User(business_name="Off", is_admin=True, admin_role="super_admin", is_active=False))
        self.assertEqual(self.client.post(f"/business/admin/team/{self.boss.id}/role", json={"role": "admin"}).status_code, 409)
        self.assertIsNotNone(other.id)

    def test_reset_password(self):
        r = self.client.post(f"/business/admin/team/{self.ana.id}/reset-password")
        self.assertEqual(r.status_code, 200)
        temporary = r.json()["temporary_password"]
        self.assertGreaterEqual(len(temporary), 10)
        self.assertTrue(verify_password(temporary, self.get(self.ana.id).hashed_password))

    def test_business_accounts_are_not_admins_here(self):
        shop = self.save(User(business_name="Shop", role="seller"))
        self.assertEqual(self.client.post(f"/business/admin/team/{shop.id}/role", json={"role": "admin"}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
