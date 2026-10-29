"""Admin Documents page: admin-only routes, upload validation, encrypted
storage, .xlsx/.csv table parsing, whitelisted project notes, data sets,
and "who can call it" on /openapi.json. Isolated SQLite + temp folder.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import io
import os
import tempfile
import unittest
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app.api.routes.admin_library import router as library_router
from app.core.config import settings
from app.core.security import get_current_user
from app.models.admin_document import AdminDocument
from app.models.user import User


def xlsx_bytes() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Interviews"
    ws.append(["Respondent", "City", "Years in business"])
    ws.append(["R1", "Pasig", 4])
    ws.append([None, None, None])  # blank rows are skipped
    ws.append(["R2", "Makati", 2.0])
    wb.create_sheet("Codes").append(["Code", "Meaning"])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


class AdminLibraryTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        for target, value in [("app.services.admin_library_service.engine", self.engine),
                              ("app.services.admin_library_service.UPLOAD_DIR", self.folder.name)]:
            p = patch(target, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(settings, "FILE_ENCRYPTION_KEY", Fernet.generate_key().decode())
        p.start()
        self.addCleanup(p.stop)

        with Session(self.engine) as s:
            s.add(User(id=1, business_name="Admin Ana", is_admin=True))
            s.add(User(id=2, business_name="Shop", role="seller", is_verified=True))
            s.commit()
        self.current = User(id=1, business_name="Admin Ana", is_admin=True)
        app = FastAPI()
        app.include_router(library_router, prefix="/business")
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(app)

    def upload(self, filename, contents, title="Interview data", category="interview_data"):
        return self.client.post("/business/admin/library", data={"title": title, "category": category},
                                files={"file": (filename, contents)})

    def test_businesses_are_refused_everywhere(self):
        self.current = User(id=2, business_name="Shop", role="seller", is_verified=True)
        for path in ("/business/admin/library", "/business/admin/notes", "/business/admin/notes/CONNECT_NOTES.md",
                     "/business/admin/datasets"):
            self.assertEqual(self.client.get(path).status_code, 403, path)
        self.assertEqual(self.upload("a.csv", b"a,b\n1,2\n").status_code, 403)

    def test_xlsx_opens_as_table_and_is_encrypted_on_disk(self):
        data = xlsx_bytes()
        r = self.upload("interviews.xlsx", data)
        self.assertEqual(r.status_code, 201, r.text)
        doc = r.json()
        self.assertTrue(doc["opens_as_table"])
        self.assertEqual(doc["uploaded_by"], "Admin Ana")

        with Session(self.engine) as s:
            stored = s.exec(select(AdminDocument)).one()
        with open(stored.file_path, "rb") as f:
            self.assertNotEqual(f.read(), data)  # encrypted at rest

        table = self.client.get(f"/business/admin/library/{doc['id']}/table").json()
        sheets = {sh["name"]: sh for sh in table["sheets"]}
        self.assertEqual(list(sheets), ["Interviews", "Codes"])
        self.assertEqual(sheets["Interviews"]["rows"],
                         [["Respondent", "City", "Years in business"], ["R1", "Pasig", "4"], ["R2", "Makati", "2"]])
        self.assertEqual(sheets["Interviews"]["total_rows"], 3)

        file = self.client.get(f"/business/admin/library/{doc['id']}/file")
        self.assertEqual(file.content, data)

        self.assertEqual(self.client.delete(f"/business/admin/library/{doc['id']}").status_code, 204)
        self.assertFalse(os.path.exists(stored.file_path))
        self.assertEqual(self.client.get("/business/admin/library").json(), [])

    def test_csv_table(self):
        doc = self.upload("survey.csv", "Q1,Q2\nYes,No\n﻿".encode("utf-8"), category="survey").json()
        table = self.client.get(f"/business/admin/library/{doc['id']}/table").json()
        self.assertEqual(table["sheets"][0]["rows"][:2], [["Q1", "Q2"], ["Yes", "No"]])

    def test_upload_validation(self):
        self.assertEqual(self.upload("tool.exe", b"MZ...").status_code, 400)
        self.assertEqual(self.upload("fake.xlsx", b"not a spreadsheet").status_code, 400)
        self.assertEqual(self.upload("a.csv", b"").status_code, 400)
        self.assertEqual(self.upload("a.csv", b"a,b", title=" ").status_code, 422)
        self.assertEqual(self.upload("a.csv", b"a,b", category="secrets").status_code, 422)
        with patch("app.services.admin_library_service.MAX_BYTES", 5):
            self.assertEqual(self.upload("a.csv", b"a,b,c,d,e,f").status_code, 413)

    def test_pdf_is_not_a_table(self):
        from pdf_fixtures import make_pdf
        doc = self.upload("chapter1.pdf", make_pdf("Chapter 1"), title="Chapter 1", category="thesis").json()
        self.assertFalse(doc["opens_as_table"])
        self.assertEqual(self.client.get(f"/business/admin/library/{doc['id']}/table").status_code, 400)

    def test_notes_are_whitelisted(self):
        self.assertIn("CONNECT_NOTES.md", self.client.get("/business/admin/notes").json())
        r = self.client.get("/business/admin/notes/CONNECT_NOTES.md")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Round 2 bago ang defense", r.json()["content"])
        for name in (".env", "backend%2F.env", "..%2FCONNECT_NOTES.md", "backups", "README.md",
                     "%2E%2E%2Fbackend%2F.env"):
            self.assertEqual(self.client.get(f"/business/admin/notes/{name}").status_code, 404, name)

    def test_datasets(self):
        d = self.client.get("/business/admin/datasets").json()
        self.assertTrue(any(c["name"] == "Printing" for c in d["categories"]))
        self.assertTrue(any(c["city"] == "Pasig" for c in d["ncr_addresses"]))
        self.assertEqual({t["code"] for t in d["document_types"]}, {"DTI", "SEC", "BIR", "MAYORS_PERMIT"})
        self.assertIn("other", [r["code"] for r in d["withdrawal_reasons"]])
        self.assertEqual(d["profile_visibility"]["levels"], ["public", "verified", "only_me"])
        self.assertTrue(d["market_rules"])


class OpenApiAccessTests(unittest.TestCase):
    def test_each_operation_says_who_can_call_it(self):
        from app.main import app
        paths = TestClient(app).get("/openapi.json").json()["paths"]
        self.assertEqual(paths["/business/admin/library"]["get"]["x-access"], "Admins only")
        self.assertEqual(paths["/meta/categories"]["get"]["x-access"], "Public")
        self.assertEqual(paths["/requirements/{requirement_id}/delivery"]["post"]["x-access"], "Verified businesses")
        self.assertTrue(all("x-access" in op for ops in paths.values() for op in ops.values()))


if __name__ == "__main__":
    unittest.main()
