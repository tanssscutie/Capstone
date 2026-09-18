"""AI profile assistant (thesis Innovation & Technology section, second half
of "AI Integration" — the first half is Assistive Document Extraction): drafts
a short public-facing bio for a business from what it already told the
platform at onboarding (type, category, capabilities, service areas, city).
A convenience function only — the business reviews and can rewrite or clear
it entirely before it's ever saved; this never writes to the database
itself, and a business can also just leave business_description blank and
type their own, same as before this feature existed.

If GEMINI_API_KEY isn't set, or the call fails for any reason, quietly
returns None — same fallback contract as document_extraction_service and
category_suggestion_service.
"""
import logging
import time

from pydantic import BaseModel

from app.core.config import settings

logger = logging.getLogger("trustlink.profile_assistant")

# generate_content, not the newer interactions.create — see
# document_extraction_service's docstring for why (the Interactions API hung
# indefinitely against the real API in this environment).
DESCRIPTION_MODEL = "gemini-3.6-flash"

# See document_extraction_service.py's matching constants — Gemini has been
# observed intermittently slow/overloaded rather than hard-down, so one
# retry meaningfully improves the odds without an unbounded wait.
MAX_ATTEMPTS = 2
RETRY_DELAY_SECONDS = 2
REQUEST_TIMEOUT_MS = 15_000


class _DescriptionSuggestion(BaseModel):
    description: str | None = None


def suggest_description(
    business_type: str, industry_category: str, capabilities: list[str],
    service_areas: list[str], city: str, province: str,
) -> str | None:
    if not settings.GEMINI_API_KEY:
        return None
    if not industry_category or not capabilities:
        return None

    try:
        from google import genai
        from google.genai import types
    except Exception:
        logger.exception("Profile description suggestion: google-genai import failed")
        return None

    try:
        # See document_extraction_service.py's matching comment: no timeout
        # here means a slow/overloaded Gemini response can tie up one of the
        # browser's ~6 per-origin connection slots long enough to queue out
        # an unrelated request on the same page.
        client = genai.Client(api_key=settings.GEMINI_API_KEY, http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS))
    except Exception:
        logger.exception("Profile description suggestion: client construction failed")
        return None

    prompt = (
        "Write a short, professional public profile bio (1-2 sentences, "
        "under 40 words) for a Philippine B2B supplier business on a "
        "sourcing platform, so other verified businesses browsing "
        "requirements know what this business offers at a glance. "
        "Plain, factual, no marketing superlatives (no \"best\", "
        "\"leading\", \"world-class\") and no emoji. Base it only on:\n"
        f"Business type: {business_type}\n"
        f"Category: {industry_category}\n"
        f"Capabilities: {', '.join(capabilities)}\n"
        f"Service areas: {', '.join(service_areas) or 'not specified'}\n"
        f"Based in: {city}, {province}\n"
        "Return an empty string if this isn't enough to write anything factual."
    )

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = client.models.generate_content(
                model=DESCRIPTION_MODEL,
                contents=[prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=_DescriptionSuggestion,
                ),
            )
            result = _DescriptionSuggestion.model_validate_json(response.text)
            value = (result.description or "").strip()
            return value[:500] or None
        except Exception:
            logger.exception("Profile description suggestion failed (attempt %d/%d)", attempt, MAX_ATTEMPTS)
            if attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS)
    return None
