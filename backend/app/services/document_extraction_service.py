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

Document check (same Gemini call): the model also says whether the upload is
the document it's meant to be — "expected", "other_document" (a real
document, but a different one: a DTI uploaded as the BIR 2303) or
"not_a_document" (a selfie, a random photo, a screenshot of something else)
— with a short reason. A clear non-document is refused; a mismatch needs the
business to confirm. The AI never verifies anything on its own: an
administrator still approves every document, and when Gemini isn't
available the upload is accepted and marked "not auto-checked" for them.
The same check runs on quotation attachments labelled as a required
document (check_labelled_document).
"""
import hashlib
import io
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Optional

from pydantic import BaseModel

from app.core import platform_settings
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

# Speed (measured live on a 3000x2200 test certificate: 11.6s before, 5.5-8.6s
# after — Gemini's own latency varies with load — same correct number):
# - thinking_level "minimal": reading one printed number needs no reasoning
#   pass, and the model's default thinking was most of the wait.
# - photos are downscaled to this longest edge before upload — phone photos
#   run several MB, and a certificate number stays legible well below this.
THINKING_LEVEL = "minimal"
MAX_IMAGE_EDGE_PX = 1600


class _DocumentExtraction(BaseModel):
    id_number: str | None = None


class _DocumentCheck(BaseModel):
    verdict: str = ""  # expected | other_document | not_a_document
    detected_type: str = ""
    reason: str = ""
    id_number: str | None = None
    business_name: str | None = None


VERDICTS = ("expected", "other_document", "not_a_document")
NOT_CHECKED = "not_checked"

# (what the business says it is, short name, what the file shows) per doc_type.
DOC_TYPE_NAMES = {
    "DTI": ("a DTI Certificate of Business Name Registration", "DTI certificate", "certificate"),
    "SEC": ("an SEC Certificate of Registration or Incorporation", "SEC certificate", "certificate"),
    "BIR": ("a BIR Certificate of Registration (Form 2303)", "BIR 2303", "certificate"),
    "MAYORS_PERMIT": ("a Mayor's Permit or Business Permit from a Philippine city or municipality", "Mayor's Permit", "permit"),
}
CHECKABLE_MIME = ("image/jpeg", "image/png", "image/webp", "application/pdf")


@dataclass
class DocumentCheck:
    verdict: str  # expected | other_document | not_a_document | not_checked
    detected_type: str = ""
    reason: str = ""
    id_number: Optional[str] = None
    message: Optional[str] = None  # what the uploader is told (None when fine)
    business_name: Optional[str] = None  # DTI/SEC: the registered name printed on it


# The pick-time check and the upload's own check see the same bytes — don't
# ask Gemini twice. Small and in-process; a miss just means one more call.
_CACHE: "OrderedDict[tuple, DocumentCheck]" = OrderedDict()
_CACHE_MAX = 64


def _shrink_image(file_bytes: bytes, mime_type: str) -> tuple[bytes, str]:
    """Downscales a large photo to MAX_IMAGE_EDGE_PX and re-encodes it as JPEG.
    PDFs, small images, and anything Pillow can't read go through unchanged."""
    if not (mime_type or "").startswith("image/"):
        return file_bytes, mime_type
    try:
        from PIL import Image, ImageOps

        image = Image.open(io.BytesIO(file_bytes))
        image = ImageOps.exif_transpose(image)  # phone photos: honour rotation
        if max(image.size) <= MAX_IMAGE_EDGE_PX and len(file_bytes) <= 1_000_000:
            return file_bytes, mime_type
        image.thumbnail((MAX_IMAGE_EDGE_PX, MAX_IMAGE_EDGE_PX))
        out = io.BytesIO()
        image.convert("RGB").save(out, "JPEG", quality=85)
        return out.getvalue(), "image/jpeg"
    except Exception:
        logger.warning("Document extraction: couldn't downscale image, sending as-is", exc_info=True)
        return file_bytes, mime_type


def extract_id_number(doc_type: str, file_bytes: bytes, mime_type: str) -> str | None:
    if not platform_settings.ai_enabled():
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

    file_bytes, mime_type = _shrink_image(file_bytes, mime_type)

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
                    thinking_config=types.ThinkingConfig(thinking_level=THINKING_LEVEL),
                ),
            )
            # Debug only, and never the value itself — it's a registration number.
            logger.debug("Document extraction answered for doc_type=%s (mime=%s, bytes=%d)",
                         doc_type, mime_type, len(file_bytes))
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


def _ask_gemini(prompt: str, file_bytes: bytes, mime_type: str) -> Optional[_DocumentCheck]:
    """One vision call: verdict + reason + (for business documents) the ID
    number. None on any failure — the caller then accepts the upload as
    "not auto-checked"."""
    try:
        from google import genai
        from google.genai import types
    except Exception:
        logger.exception("Document check: google-genai import failed")
        return None
    try:
        client = genai.Client(api_key=settings.GEMINI_API_KEY, http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS))
    except Exception:
        logger.exception("Document check: client construction failed")
        return None
    file_bytes, mime_type = _shrink_image(file_bytes, mime_type)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = client.models.generate_content(
                model=EXTRACTION_MODEL,
                contents=[types.Part.from_bytes(data=file_bytes, mime_type=mime_type), prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=_DocumentCheck,
                    thinking_config=types.ThinkingConfig(thinking_level=THINKING_LEVEL),
                ),
            )
            return _DocumentCheck.model_validate_json(response.text)
        except Exception:
            logger.exception("Document check failed (attempt %d/%d)", attempt, MAX_ATTEMPTS)
            if attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS)
    return None


def _check(expected: str, short: str, noun: str, id_hint: Optional[str], file_bytes: bytes, mime_type: str) -> DocumentCheck:
    mime_type = (mime_type or "").lower()
    if not platform_settings.ai_enabled() or mime_type not in CHECKABLE_MIME:
        return DocumentCheck(verdict=NOT_CHECKED)
    key = (hashlib.sha256(file_bytes).hexdigest(), expected, id_hint)
    if key in _CACHE:
        _CACHE.move_to_end(key)
        return _CACHE[key]

    prompt = (
        "You check files uploaded to a Philippine B2B procurement platform. "
        f"The uploader says this file is {expected}. Classify it:\n"
        "- \"expected\": it is that document — a scan, a PDF, or a legible photo of it (be lenient with "
        "angle, lighting and light blur).\n"
        "- \"other_document\": it is a real document, but a different one.\n"
        "- \"not_a_document\": it is not a document at all — a selfie, a photo of a person, place or object, "
        "a meme, or a screenshot of something unrelated.\n"
        "detected_type: a short name for what it looks like, e.g. \"a selfie\", \"a DTI certificate\", "
        "\"a screenshot of a chat\". reason: one short sentence. "
        + (f"If the verdict is \"expected\", also find {id_hint} and return it in id_number exactly as printed; "
           "otherwise leave id_number empty. Never guess or invent a number that isn't legible. "
           "Also return the registered business name printed on it in business_name (empty if none or not legible)."
           if id_hint else "Leave id_number and business_name empty.")
    )
    ai = _ask_gemini(prompt, file_bytes, mime_type)
    if ai is None or ai.verdict not in VERDICTS:
        return DocumentCheck(verdict=NOT_CHECKED)  # not cached: a later try may work

    detected = (ai.detected_type or "").strip().rstrip(".")[:80]
    # "This looks like BIR Certificate…" reads wrong — the model sometimes drops the article.
    if detected and detected.split(" ", 1)[0].lower() not in ("a", "an", "the"):
        detected = f"{'an' if detected[0].lower() in 'aeiou' else 'a'} {detected}"
    result = DocumentCheck(
        verdict=ai.verdict, detected_type=detected, reason=(ai.reason or "").strip()[:300],
        id_number=((ai.id_number or "").strip() or None) if ai.verdict == "expected" else None,
        business_name=((ai.business_name or "").strip()[:200] or None) if ai.verdict == "expected" else None,
    )
    if ai.verdict == "not_a_document":
        result.message = (f"This looks like {detected or 'a photo'}, not a {short}. "
                          f"Upload a scan or clear photo of the {noun}.")
    elif ai.verdict == "other_document":
        result.message = (f"This looks like {detected or 'a different document'}, not a {short}. "
                          f"Upload the right one — or confirm if it really is your {short}.")
    _CACHE[key] = result
    if len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)
    return result


# ---------- identity check: a valid ID and a selfie holding it ----------

class _IdAnswer(BaseModel):
    verdict: str = ""  # valid | not_valid
    id_type_seen: str = ""
    reason: str = ""
    full_name: str = ""
    id_number: str = ""
    birthdate: str = ""  # YYYY-MM-DD or ""
    expiry_date: str = ""  # YYYY-MM-DD or ""


class _SelfieAnswer(BaseModel):
    verdict: str = ""  # valid | not_valid
    face_matches_id: bool = False
    same_id_card: bool = False
    reason: str = ""


@dataclass
class IdCheck:
    verdict: str  # valid | not_valid | not_checked
    reason: str = ""
    full_name: str = ""
    id_number: str = ""
    birthdate: str = ""
    expiry_date: str = ""
    message: Optional[str] = None


@dataclass
class SelfieCheck:
    verdict: str  # valid | not_valid | not_checked
    face_match: Optional[bool] = None
    reason: str = ""
    message: Optional[str] = None


_ID_CACHE: "OrderedDict[tuple, object]" = OrderedDict()
IMAGE_MIME = ("image/jpeg", "image/png", "image/webp")


def _ask_gemini_json(prompt: str, files: list[tuple[bytes, str]], schema):
    """One vision call over one or more images, answered as `schema`. None on any failure."""
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=settings.GEMINI_API_KEY, http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS))
    except Exception:
        logger.exception("Identity check: Gemini client unavailable")
        return None
    parts = []
    for data, mime in files:
        data, mime = _shrink_image(data, mime)
        parts.append(types.Part.from_bytes(data=data, mime_type=mime))
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = client.models.generate_content(
                model=EXTRACTION_MODEL,
                contents=[*parts, prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=schema,
                    thinking_config=types.ThinkingConfig(thinking_level=THINKING_LEVEL),
                ),
            )
            return schema.model_validate_json(response.text)
        except Exception:
            logger.exception("Identity check failed (attempt %d/%d)", attempt, MAX_ATTEMPTS)
            if attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS)
    return None


def _cached(key, compute):
    if key in _ID_CACHE:
        _ID_CACHE.move_to_end(key)
        return _ID_CACHE[key]
    result = compute()
    if result.verdict != NOT_CHECKED:  # a failed call may work next time
        _ID_CACHE[key] = result
        if len(_ID_CACHE) > _CACHE_MAX:
            _ID_CACHE.popitem(last=False)
    return result


def check_valid_id(id_name: str, file_bytes: bytes, mime_type: str) -> IdCheck:
    """Strict: a real, current photo of the front of this Philippine government
    ID — not a screenshot, photocopy, edited or cropped image. Also reads the
    name, number, birthdate and expiry. When unsure, not_valid."""
    mime_type = (mime_type or "").lower()
    if not platform_settings.ai_enabled() or mime_type not in IMAGE_MIME:
        return IdCheck(verdict=NOT_CHECKED)

    def compute() -> IdCheck:
        prompt = (
            "You verify identity documents for a Philippine business platform. Be STRICT. "
            f"The person says this image is the FRONT of their {id_name}. "
            "verdict \"valid\" ONLY if ALL hold: it is a photo of the physical card itself (not a screenshot, not a "
            "photo of a screen or monitor, not a photocopy or printout, not a scan of a scan); it is that kind of "
            "Philippine government ID; all four corners are visible; the photo of the holder, the name and the ID "
            "number are clearly legible; there is no sign of editing, pasted text or tampering; it is not a sample or "
            "specimen card. Otherwise verdict \"not_valid\". If you are unsure, answer \"not_valid\". "
            "id_type_seen: what ID it actually is. reason: one short sentence a user can act on. "
            "Read full_name exactly as printed (given names, middle name, surname), id_number, birthdate and "
            "expiry_date (YYYY-MM-DD; empty if none or not legible). Never guess a value that isn't legible."
        )
        ai = _ask_gemini_json(prompt, [(file_bytes, mime_type)], _IdAnswer)
        if ai is None or ai.verdict not in ("valid", "not_valid"):
            return IdCheck(verdict=NOT_CHECKED)
        result = IdCheck(verdict=ai.verdict, reason=(ai.reason or "").strip()[:300],
                         full_name=(ai.full_name or "").strip()[:200], id_number=(ai.id_number or "").strip()[:60],
                         birthdate=(ai.birthdate or "").strip()[:10], expiry_date=(ai.expiry_date or "").strip()[:10])
        if ai.verdict == "not_valid":
            result.message = (f"We can't accept this as your {id_name}: {result.reason or 'it isn\'t clear enough'} "
                              "Take a new photo of the front of the card itself — all four corners in view, no glare, "
                              "not a screenshot or photocopy.")
        return result

    return _cached((hashlib.sha256(file_bytes).hexdigest(), "id", id_name), compute)


def check_selfie_with_id(id_bytes: bytes, id_mime: str, selfie_bytes: bytes, selfie_mime: str) -> SelfieCheck:
    """Strict: a live photo of one real person holding that same ID next to
    their face, and the face matches the ID photo. Never overridable."""
    id_mime, selfie_mime = (id_mime or "").lower(), (selfie_mime or "").lower()
    if not platform_settings.ai_enabled() or id_mime not in IMAGE_MIME or selfie_mime not in IMAGE_MIME:
        return SelfieCheck(verdict=NOT_CHECKED)

    def compute() -> SelfieCheck:
        prompt = (
            "You verify identity for a Philippine business platform. Be STRICT. The FIRST image is the person's "
            "government ID. The SECOND image must be a selfie of that person holding that same ID card next to their "
            "face. verdict \"valid\" ONLY if ALL hold: the second image is a live photo of exactly one real person "
            "(not a photo of a photo or a screen, not a printout, no mask, no sunglasses, face fully visible); they are "
            "holding a physical ID card that is the same card as in the first image; and the face in the selfie is "
            "plausibly the same person as the photo on the ID. Otherwise \"not_valid\". If unsure, \"not_valid\". "
            "face_matches_id and same_id_card: your answers to those two checks. reason: one short sentence a user "
            "can act on."
        )
        ai = _ask_gemini_json(prompt, [(id_bytes, id_mime), (selfie_bytes, selfie_mime)], _SelfieAnswer)
        if ai is None or ai.verdict not in ("valid", "not_valid"):
            return SelfieCheck(verdict=NOT_CHECKED)
        verdict = "valid" if ai.verdict == "valid" and ai.face_matches_id and ai.same_id_card else "not_valid"
        result = SelfieCheck(verdict=verdict, face_match=bool(ai.face_matches_id), reason=(ai.reason or "").strip()[:300])
        if verdict == "not_valid":
            result.message = (f"We can't accept this selfie: {result.reason or 'the check didn\'t pass'} "
                              "Take a new photo of yourself holding the same ID next to your face — face and card "
                              "clearly visible, good light, no mask or sunglasses.")
        return result

    key = (hashlib.sha256(id_bytes).hexdigest(), hashlib.sha256(selfie_bytes).hexdigest(), "selfie")
    return _cached(key, compute)


def check_business_document(doc_type: str, file_bytes: bytes, mime_type: str) -> DocumentCheck:
    """Onboarding / permit uploads: is this the DTI/SEC/BIR/Mayor's Permit it
    says it is? Also reads the ID number (the old extract_id_number)."""
    names = DOC_TYPE_NAMES.get(doc_type)
    if not names:
        return DocumentCheck(verdict=NOT_CHECKED)
    expected, short, noun = names
    return _check(expected, short, noun, DOC_TYPE_ID_HINT.get(doc_type), file_bytes, mime_type)


def check_labelled_document(label: str, file_bytes: bytes, mime_type: str) -> DocumentCheck:
    """A quotation attachment filed under one of the buyer's required
    documents ("DENR Permit", "Material spec sheet")."""
    label = (label or "").strip()[:100]
    if not label:
        return DocumentCheck(verdict=NOT_CHECKED)
    return _check(f"a \"{label}\" document", label, "document", None, file_bytes, mime_type)
