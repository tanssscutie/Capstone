"""Real, tiny PDFs for upload tests — uploads are checked by
app.core.file_validation, so a few bytes starting with %PDF no longer pass."""
import io

from pypdf import PdfWriter


def make_pdf(label: str = "test", password: str | None = None) -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.add_metadata({"/Title": label})
    if password:
        writer.encrypt(user_password=password, owner_password=password)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def make_png() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (22, 78, 120)).save(buf, "PNG")
    return buf.getvalue()
