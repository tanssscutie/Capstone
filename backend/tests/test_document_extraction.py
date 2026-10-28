"""Document extraction speedups that don't need a live Gemini call.

Run from backend: venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import asyncio
import io
import os
import time
import unittest
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

from PIL import Image

from app.services import document_extraction_service as extraction
from app.services.document_extraction_service import DocumentCheck
from app.services.business_service import business_service


def jpeg(size):
    out = io.BytesIO()
    Image.new("RGB", size, "white").save(out, "JPEG", quality=95)
    return out.getvalue()


class ShrinkImageTests(unittest.TestCase):
    def test_large_photo_is_downscaled(self):
        data, mime = extraction._shrink_image(jpeg((4000, 3000)), "image/jpeg")
        self.assertEqual(mime, "image/jpeg")
        self.assertEqual(max(Image.open(io.BytesIO(data)).size), extraction.MAX_IMAGE_EDGE_PX)

    def test_small_image_and_pdf_pass_through(self):
        small = jpeg((800, 600))
        self.assertEqual(extraction._shrink_image(small, "image/jpeg"), (small, "image/jpeg"))
        pdf = b"%PDF-1.4 certificate"
        self.assertEqual(extraction._shrink_image(pdf, "application/pdf"), (pdf, "application/pdf"))

    def test_unreadable_image_passes_through(self):
        self.assertEqual(extraction._shrink_image(b"not an image", "image/png"), (b"not an image", "image/png"))


class ExtractionDoesNotBlockTests(unittest.TestCase):
    def test_two_extractions_run_concurrently(self):
        """Each fake Gemini call sleeps 0.5s; on the event loop they'd take 1s+."""
        class Upload:
            content_type = "image/jpeg"

            async def read(self):
                return b"img"

        def slow(*_):
            time.sleep(0.5)
            return DocumentCheck(verdict="expected", id_number="123456")

        async def both():
            return await asyncio.gather(
                business_service.extract_document_fields("DTI", Upload()),
                business_service.extract_document_fields("BIR", Upload()),
            )

        with patch("app.services.business_service.document_extraction_service.check_business_document", side_effect=slow):
            start = time.time()
            results = asyncio.run(both())
            elapsed = time.time() - start
        self.assertEqual([r.id_number for r in results], ["123456", "123456"])
        self.assertLess(elapsed, 0.9)


if __name__ == "__main__":
    unittest.main()
