"""AI Detail draft for buyers ("Write with AI" on Post a requirement).

Reads what the buyer has filled in on Step 1 so far (category, item or the
"Other" item name, title, specifications, quantity, budget) and asks Gemini
for the Detail text suppliers read before quoting.

Rules this module keeps:
- Nothing is saved. The text fills the Detail box; the buyer edits it and
  the form asks before replacing anything they already typed.
- Output is clamped to RequirementCreate's scope length (10–3000).
- No prices are invented: the budget is mentioned only as the buyer gave it.

If GEMINI_API_KEY isn't set, or the call fails or returns something unusable,
this returns a template sentence built from the same inputs — the same quiet
fallback as quotation_draft_service, so the button never breaks a demo.
"""
import logging
import time
from typing import Optional

from pydantic import BaseModel

from app.core import platform_settings
from app.core.config import settings
from app.schemas.requirement import DetailDraftOut, DetailDraftRequest

logger = logging.getLogger("trustlink.detail_draft")

# Same model and retry/timeout settings as quotation_draft_service.
DRAFT_MODEL = "gemini-3.6-flash"
MAX_ATTEMPTS = 2
RETRY_DELAY_SECONDS = 2
REQUEST_TIMEOUT_MS = 20_000

SCOPE_MIN = 10
SCOPE_MAX = 3000
AI_TARGET_CHARS = 900


class _AiDetail(BaseModel):
    detail: str = ""


def _specs(data: DetailDraftRequest) -> list[tuple[str, str]]:
    return [(s.label.strip(), s.value.strip()) for s in data.specifications if s.label.strip() and s.value.strip()]


def _budget(data: DetailDraftRequest) -> Optional[str]:
    if not (data.price_min and data.price_max):
        return None
    text = f"PHP {data.price_min:,.0f} – {data.price_max:,.0f}"
    return text + (" (strict maximum)" if data.strict_budget else " (indicative)")


def _what(data: DetailDraftRequest) -> str:
    return (data.item.strip() or data.title.strip() or data.category.strip() or "the items below").rstrip(".")


def template(data: DetailDraftRequest) -> str:
    """A plain, factual Detail from the inputs — no AI, no invented facts."""
    parts = []
    qty = data.quantity.strip()
    parts.append(f"We need {qty + ' of ' if qty else ''}{_what(data)}" + (f" for: {data.title.strip()}." if data.title.strip() and data.title.strip() != _what(data) else "."))
    specs = _specs(data)
    if specs:
        parts.append("Specifications: " + "; ".join(f"{label}: {value}" for label, value in specs) + ".")
    budget = _budget(data)
    if budget:
        parts.append(f"Budget: {budget}.")
    parts.append("Please include delivery to our site in your price, and note anything you would recommend we change.")
    return " ".join(parts)[:SCOPE_MAX]


def build_prompt(data: DetailDraftRequest) -> str:
    specs = "\n".join(f"- {label}: {value}" for label, value in _specs(data)) or "(none yet)"
    return (
        "You help a buyer in Metro Manila, Philippines write the 'Detail' of a procurement "
        "requirement on a B2B sealed-quotation platform. Suppliers read it before pricing. "
        "Write 2–4 short, clear paragraphs or a few sentences: what is needed, what it is for "
        "(only if the title says so), the key specifications in plain words, and what suppliers "
        "should include or ask about. Do not invent facts, brands, dates, prices or quantities "
        "that are not given; do not mention the budget unless it is given. Do not use markdown. "
        "Write in the same language as the buyer's title and existing text (English or Taglish). "
        f"Keep it under {AI_TARGET_CHARS} characters.\n\n"
        f"Category: {data.category or '(not picked)'}\n"
        f"Item: {data.item or '(not picked)'}\n"
        f"Title: {data.title or '(none)'}\n"
        f"Quantity: {data.quantity or '(not given)'}\n"
        f"Budget: {_budget(data) or '(not given)'}\n"
        f"Specifications:\n{specs}\n"
        f"Buyer's current text (improve it if useful): {data.current_text.strip()[:1500] or '(empty)'}\n\n"
        "Return JSON with one field: detail."
    )


def _ask_gemini(prompt: str) -> Optional[_AiDetail]:
    try:
        from google import genai
        from google.genai import types
    except Exception:
        logger.exception("Detail draft: google-genai import failed")
        return None
    try:
        client = genai.Client(api_key=settings.GEMINI_API_KEY, http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS))
    except Exception:
        logger.exception("Detail draft: client construction failed")
        return None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = client.models.generate_content(
                model=DRAFT_MODEL,
                contents=[prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=_AiDetail,
                ),
            )
            return _AiDetail.model_validate_json(response.text)
        except Exception:
            logger.exception("Detail draft failed (attempt %d/%d)", attempt, MAX_ATTEMPTS)
            if attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS)
    return None


def draft(data: DetailDraftRequest) -> DetailDraftOut:
    if not platform_settings.ai_enabled():
        return DetailDraftOut(text=template(data), source="template",
                              message="AI writing isn't set up, so this is a starting template. Edit it to fit.")
    ai = _ask_gemini(build_prompt(data))
    text = (ai.detail if ai else "").strip()[:SCOPE_MAX]
    if len(text) < SCOPE_MIN:
        return DetailDraftOut(text=template(data), source="template",
                              message="The AI couldn't write this right now, so this is a starting template. Edit it to fit.")
    return DetailDraftOut(text=text, source="ai", message="AI draft — read it and edit anything that isn't right.")
