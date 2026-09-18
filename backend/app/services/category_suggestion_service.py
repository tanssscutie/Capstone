"""Auto-tag/category suggestion (thesis Innovation & Technology section): reads
a requirement's title and scope, still being drafted, and suggests which of
the platform's 10 fixed categories it belongs to — so a buyer who forgets to
pick one, or picks a close-but-wrong one, gets a nudge toward the category
that actually gets their post in front of the right suppliers. A convenience
function only: the category field it feeds is the same tappable pill list it
always was, the buyer can pick any category regardless of what this suggests,
and this never writes to the database itself.

If GEMINI_API_KEY isn't set, the call fails for any reason, or the model
returns something that isn't verbatim one of the 10 categories, this quietly
returns None — the same manual pill-tapping flow that already worked keeps
working exactly the same way whether or not this feature is configured.
"""
import logging
import time

from pydantic import BaseModel

from app.core.categories import CATEGORIES
from app.core.config import settings

logger = logging.getLogger("trustlink.category_suggestion")

# Same model as document_extraction_service — generate_content, not the newer
# interactions.create, which hung indefinitely against the real API in this
# environment (see that module's docstring for the full finding).
SUGGESTION_MODEL = "gemini-3.6-flash"

# See document_extraction_service.py's matching constants — Gemini has been
# observed intermittently slow/overloaded rather than hard-down, so one
# retry meaningfully improves the odds without an unbounded wait.
MAX_ATTEMPTS = 2
RETRY_DELAY_SECONDS = 2
REQUEST_TIMEOUT_MS = 15_000


class _CategorySuggestion(BaseModel):
    category: str | None = None


def suggest_category(title: str, scope: str) -> str | None:
    if not settings.GEMINI_API_KEY:
        return None
    title = (title or "").strip()
    scope = (scope or "").strip()
    if not title:
        return None

    try:
        from google import genai
        from google.genai import types
    except Exception:
        logger.exception("Category suggestion: google-genai import failed")
        return None

    try:
        # See document_extraction_service.py's matching comment: no timeout
        # here means a slow/overloaded Gemini response can tie up one of the
        # browser's ~6 per-origin connection slots long enough to queue out
        # an unrelated request on the same page.
        client = genai.Client(api_key=settings.GEMINI_API_KEY, http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS))
    except Exception:
        logger.exception("Category suggestion: client construction failed")
        return None

    options = "\n".join(f"- {c}" for c in CATEGORIES)
    prompt = (
        "A business is posting a procurement requirement on a B2B "
        "sourcing platform. Based on its title and scope, pick the "
        "single best-fitting category from this exact list:\n"
        f"{options}\n\n"
        f"Title: {title}\n"
        f"Scope: {scope or '(not written yet)'}\n\n"
        "Return the category exactly as spelled above — no changes, no "
        "extra words. If nothing on the list is a reasonable fit, "
        "return an empty string rather than guessing."
    )

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = client.models.generate_content(
                model=SUGGESTION_MODEL,
                contents=[prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=_CategorySuggestion,
                ),
            )
            result = _CategorySuggestion.model_validate_json(response.text)
            value = (result.category or "").strip()
            # Fail closed on anything but an exact match — never hand the
            # frontend a category it doesn't recognize.
            return value if value in CATEGORIES else None
        except Exception:
            logger.exception("Category suggestion failed (attempt %d/%d)", attempt, MAX_ATTEMPTS)
            if attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS)
    return None
