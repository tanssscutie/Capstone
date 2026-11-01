"""Upload contents checks (app.core.file_validation): the file must really be
what its name says, and must open.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import io
import unittest
import zipfile

from fastapi import HTTPException

from app.core.file_validation import check_contents, validate_upload
from pdf_fixtures import make_pdf, make_png

OK = {".pdf", ".png", ".jpg", ".docx"}
MB = 1024 * 1024


def docx() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<w:document/>")
    return buf.getvalue()


class FileValidationTests(unittest.TestCase):
    def rejects(self, name, contents, phrase):
        with self.assertRaises(HTTPException) as ctx:
            validate_upload(name, contents, OK, MB)
        self.assertIn(phrase, ctx.exception.detail)
        return ctx.exception

    def test_real_files_pass(self):
        self.assertEqual(validate_upload("permit.PDF", make_pdf(), OK, MB), ".pdf")
        validate_upload("photo.png", make_png(), OK, MB)
        validate_upload("quote.docx", docx(), OK, MB)

    def test_renamed_program_is_refused(self):
        self.rejects("permit.pdf", b"MZ\x90\x00 this is a windows program", "isn't really a PDF")
        self.rejects("photo.png", make_pdf(), "isn't really a PNG image")
        self.rejects("quote.docx", b"PK\x03\x04 not a word file", "isn't really a Word document")

    def test_password_protected_pdf_is_refused(self):
        self.rejects("permit.pdf", make_pdf(password="secret"), "password-protected")

    def test_owner_only_restrictions_are_fine(self):
        from pypdf import PdfWriter
        w = PdfWriter()
        w.add_blank_page(width=100, height=100)
        w.encrypt(user_password="", owner_password="owner")
        buf = io.BytesIO()
        w.write(buf)
        validate_upload("permit.pdf", buf.getvalue(), OK, MB)

    def test_damaged_pdf_is_refused(self):
        self.rejects("permit.pdf", b"%PDF-1.4 this is not a real pdf body", "damaged")
        self.rejects("permit.pdf", make_pdf()[:60], "damaged")

    def test_damaged_image_is_refused(self):
        self.rejects("photo.png", make_png()[:20], "damaged")

    def test_encrypted_office_file_is_refused(self):
        self.rejects("quote.docx", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 600, "password-protected")

    def test_type_empty_and_size(self):
        self.rejects("tool.exe", b"MZ", "isn't allowed")
        self.rejects("permit.pdf", b"", "empty")
        self.assertEqual(self.rejects("permit.pdf", make_pdf() + b"\x00" * MB, "MB").status_code, 413)

    def test_check_contents_alone(self):
        check_contents(".pdf", make_pdf())
        with self.assertRaises(HTTPException):
            check_contents(".jpg", make_png())


if __name__ == "__main__":
    unittest.main()
