"""Upload validation shared by every file upload.

The extension alone is just the file's name — a program renamed to
"permit.pdf" used to pass. This checks the contents:

1. Signature ("magic bytes"): the first bytes must match the extension
   (PDF starts with %PDF, PNG with \\x89PNG, DOCX is a zip with word/…).
2. Openable: a PDF must parse and have pages, and must not need a password;
   an image must decode; a DOCX/XLSX that is password-protected (stored as an
   encrypted OLE container instead of a zip) is refused. A buyer or admin who
   can't open the file later is the same as no file, so it's caught at upload.

check_contents() is for upload paths that already check extension and size;
validate_upload() does all of it for the ones that didn't.
"""
import io
import os
import zipfile
from typing import Iterable

from fastapi import HTTPException, status

OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # legacy .doc/.xls, and encrypted Office files
PNG = b"\x89PNG\r\n\x1a\n"
JPEG = b"\xff\xd8\xff"

KIND_LABEL = {
    ".pdf": "PDF", ".png": "PNG image", ".jpg": "JPEG image", ".jpeg": "JPEG image", ".webp": "WebP image",
    ".doc": "Word document", ".docx": "Word document", ".xls": "Excel file", ".xlsx": "Excel file",
    ".ai": "Illustrator file", ".psd": "Photoshop file",
}


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _zip_has(contents: bytes, member: str) -> bool:
    try:
        with zipfile.ZipFile(io.BytesIO(contents)) as z:
            return member in z.namelist()
    except zipfile.BadZipFile:
        return False


def _signature_ok(ext: str, contents: bytes) -> bool:
    head = contents[:1024]
    if ext == ".pdf":
        return b"%PDF-" in head  # the spec allows a little junk before the header
    if ext == ".png":
        return contents.startswith(PNG)
    if ext in (".jpg", ".jpeg"):
        return contents.startswith(JPEG)
    if ext == ".webp":
        return contents[:4] == b"RIFF" and contents[8:12] == b"WEBP"
    if ext in (".doc", ".xls"):
        return contents.startswith(OLE)
    if ext == ".docx":
        return contents.startswith(OLE) or (contents.startswith(b"PK\x03\x04") and _zip_has(contents, "word/document.xml"))
    if ext == ".xlsx":
        return contents.startswith(OLE) or (contents.startswith(b"PK\x03\x04") and _zip_has(contents, "xl/workbook.xml"))
    if ext == ".ai":
        return b"%PDF-" in head or contents.startswith(b"%!PS-Adobe")
    if ext == ".psd":
        return contents.startswith(b"8BPS")
    return True  # nothing known to check against


def _check_pdf(contents: bytes) -> None:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(contents))
        if reader.is_encrypted:
            # Owner-password-only PDFs (print/copy restrictions) still open
            # with an empty password — those are fine.
            if not reader.decrypt(""):
                raise _bad("This PDF is password-protected. Upload a copy without a password so it can be opened.")
        if len(reader.pages) == 0:
            raise _bad("This PDF has no pages.")
    except HTTPException:
        raise
    except (PdfReadError, ValueError, KeyError, TypeError, IndexError, OSError):
        raise _bad("This PDF is damaged and can't be opened. Export or scan it again.")
    except Exception:
        # pypdf can raise other errors on odd files; treat unknown as damaged.
        raise _bad("This PDF is damaged and can't be opened. Export or scan it again.")


def _check_image(contents: bytes) -> None:
    from PIL import Image

    try:
        with Image.open(io.BytesIO(contents)) as img:
            img.verify()
    except Exception:
        raise _bad("This image is damaged and can't be opened. Take or export it again.")


def check_contents(ext: str, contents: bytes) -> None:
    """Raise 400 when the bytes aren't really a file of this type, or can't be opened."""
    ext = ext.lower()
    if not _signature_ok(ext, contents):
        label = KIND_LABEL.get(ext, ext.lstrip(".").upper() + " file")
        raise _bad(f"This file isn't really a {label} — its contents don't match the {ext} name.")
    if ext in (".docx", ".xlsx") and contents.startswith(OLE):
        raise _bad("This document is password-protected. Save a copy without a password and upload that.")
    if ext == ".pdf":
        _check_pdf(contents)
    elif ext in (".png", ".jpg", ".jpeg", ".webp"):
        _check_image(contents)


def validate_upload(filename: str | None, contents: bytes, allowed: Iterable[str], max_bytes: int) -> str:
    """Extension allowlist + empty/size + check_contents. Returns the lowercased extension."""
    allowed = set(allowed)
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in allowed:
        raise _bad(f"That file type isn't allowed. Use one of: {', '.join(sorted(allowed))}")
    if not contents:
        raise _bad("That file is empty")
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Files can be up to {max_bytes // (1024 * 1024)} MB",
        )
    check_contents(ext, contents)
    return ext
