"""Assistive Document Extraction (thesis Innovation & Technology section): a
pre-trained vision model reads an uploaded DTI/SEC/BIR/Mayor's Permit image
and suggests the certificate/ID number printed on it, so a business doesn't
have to retype it by hand. This is a convenience function only, exactly as
scoped in the paper — the suggestion lands in an ordinary editable text
field on the frontend, the business reviews and can change it before
anything is submitted, and it never determines verification status, trust
tier, release, or awards. Those all still run through the same
declared_id_number the business actually submits (see
business_service._validate_document) — this module never writes to the
database at all.

If GEMINI_API_KEY isn't set, or the call fails for any reason (bad key,
rate limit, network error, an unreadable image, a response that doesn't
parse), extract_id_number quietly returns None rather than raising — the
same manual-entry upload flow that already worked keeps working exactly
the same way whether or not this feature is configured.

Uses client.models.generate_content, not the newer client.interactions.create
— both exist on the installed google-genai SDK, but a live test of the
Interactions API against the real API consistently hung past 100s in this
environment (httpx.ReadTimeout — connects fine, response never lands),
while generate_content answered the same request in a couple of seconds.
Verified end-to-end with a real key: a synthetic test certificate image
with "Registration Number: 8837215690" printed on it came back with
exactly that string.
"""
import logging
import time

from pydantic import BaseModel

from app.core.config import settings

logger = logging.getLogger("trustlink.document_extraction")

# What to ask the model to find, per doc_type — phrased around the same
# shapes business_service.ID_FORMAT_PATTERNS checks, so a legible extraction
# should already pass that check once the business reviews and submits it.
DOC_TYPE_ID_HINT = {
    "DTI": "the DTI Certificate of Business Name Registration number (digits only, 6 to 15 digits, no dashes or spaces)",
    "SEC": "the SEC registration or company number (letters and digits, 6 to 20 characters)",
    "BIR": "the BIR Certificate of Registration TIN, formatted like 123-456-789 or 123-456-789-000",
    "MAYORS_PERMIT": "the Mayor's / Business Permit number",
}

# gemini-2.5-flash (and older) return 404 "no longer available to new users"
# on this API key — confirmed live. gemini-3.6-flash is what Google's own
# error message pointed to, and it responds correctly.
EXTRACTION_MODEL = "gemini-3.6-flash"

# Observed live: Gemini's vision path is sometimes just intermittently slow/
# overloaded (a ReadTimeout with no response, or a 503 "high demand") — not
# a hard outage, since a retry a few seconds later can succeed where the
# first attempt didn't. One retry captures that without piling up a long
# worst-case wait behind a browser's ~6-connections-per-origin limit.
MAX_ATTEMPTS = 2
RETRY_DELAY_SECONDS = 2
REQUEST_TIMEOUT_MS = 15_000


class _DocumentExtraction(BaseModel):
    id_number: str | None = None


def extract_id_number(doc_type: str, file_bytes: bytes, mime_type: str) -> str | None:
    if not settings.GEMINI_API_KEY:
        return None
    hint = DOC_TYPE_ID_HINT.get(doc_type)
    if not hint:
        return None

    try:
        from google import genai
        from google.genai import types
    except Exception:
        logger.exception("Document extraction: google-genai import failed")
        return None

    try:
        # An explicit timeout matters here specifically: this call sits behind
        # a browser form submission, and a browser only opens ~6 connections
        # per origin — a Gemini call that hangs with no timeout (seen live:
        # a 503 "high demand" response that took a very long time to arrive)
        # can tie up a connection slot long enough to queue out an unrelated
        # request on the same page, like the onboarding form's own submit.
        client = genai.Client(api_key=settings.GEMINI_API_KEY, http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS))
    except Exception:
        logger.exception("Document extraction: client construction failed")
        return None

    prompt = (
        "This is a photo or scan of a Philippine business document. "
        f"Find {hint}. Return only that identifier exactly as printed — "
        "no labels, no extra words, no punctuation beyond what's part of "
        "the number itself. If you can't find it, or the image is too "
        "blurry or cropped to be sure, return an empty string. Never "
        "guess or invent a number that isn't actually legible in the image."
    )

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = client.models.generate_content(
                model=EXTRACTION_MODEL,
                contents=[
                    types.Part.from_bytes(data=file_bytes, mime_type=mime_type or "image/jpeg"),
                    prompt,
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=_DocumentExtraction,
                ),
            )
            logger.warning(
                "Document extraction raw response for doc_type=%s (mime=%s, bytes=%d): %r",
                doc_type, mime_type, len(file_bytes), response.text,
            )
            result = _DocumentExtraction.model_validate_json(response.text)
            value = (result.id_number or "").strip()
            return value or None
        except Exception:
            # Never let an extraction failure block the document upload flow —
            # the business can always type the number in by hand, same as before
            # this feature existed.
            logger.exception("Document extraction failed for doc_type=%s (attempt %d/%d)", doc_type, attempt, MAX_ATTEMPTS)
            if attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS)
    return None
