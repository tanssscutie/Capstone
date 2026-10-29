"""AI quotation draft for sellers ("Draft with AI" on Submit Quotation).

Reads the requirement (title, scope, item, specifications, quantity, budget
range, required documents), the seller's own capabilities and items, and the
seller's OWN past quotations, then asks Gemini for a first draft: line items
with unit prices, one answer per specification row, lead time, payment terms,
validity and a note to the buyer.

Rules this module keeps:
- Never another supplier's price. Past quotations are loaded by the
  requesting seller's business_id only; nothing else about other
  respondents is read, sealed or released.
- Nothing is saved and nothing goes on the ledger. The draft fills the form;
  the seller reviews every line and price and still seals it themselves.
- Output is clamped to the same caps QuotationCreate enforces.

If GEMINI_API_KEY isn't set, or the call fails or returns something unusable,
this returns a template draft WITHOUT prices (one line from the title and
quantity, "complies" on every spec row) — same quiet fallback as
category_suggestion_service, so the button never breaks a demo.
"""
import json
import logging
import re
import time
from typing import List, Optional

from pydantic import BaseModel
from sqlmodel import Session, select

from app.core import platform_settings
from app.core.categories import item_name
from app.core.clock import now_ph
from app.core.config import settings
from app.core.database import engine
from app.models.quotation import Quotation
from app.models.requirement import Requirement
from app.models.user import User
from app.repositories import requirement_repository as repo
from app.schemas.requirement import QuotationDraftLine, QuotationDraftOut, QuotationDraftSpec
from app.services.requirement_service import (
    AlreadyQuoted,
    CannotQuoteOwnRequirement,
    RequirementNotFound,
    RequirementNotOpen,
)

logger = logging.getLogger("trustlink.quotation_draft")

# Same model and retry/timeout settings as category_suggestion_service.
DRAFT_MODEL = "gemini-3.6-flash"
MAX_ATTEMPTS = 2
RETRY_DELAY_SECONDS = 2
REQUEST_TIMEOUT_MS = 20_000

# The choices the Submit Quotation form offers (QuotationSubmission.tsx).
PAYMENT_TERMS = ("50 / 50", "30 / 60 / 10", "20 / 70 / 10", "100% on completion")
VALIDITY_DAYS = (15, 30, 60, 90)
DEFAULT_TERMS = "30 / 60 / 10"
DEFAULT_VALIDITY = 30
DEFAULT_LEAD_WEEKS = 2

MAX_LINES = 10
PAST_QUOTATIONS = 5


class _AiLine(BaseModel):
    description: str = ""
    quantity: float = 0
    unit_price: float = 0


class _AiSpec(BaseModel):
    label: str = ""
    complies: bool = True
    offered: Optional[str] = None


class _AiDraft(BaseModel):
    line_items: List[_AiLine] = []
    spec_responses: List[_AiSpec] = []
    lead_time_weeks: int = DEFAULT_LEAD_WEEKS
    payment_terms: str = DEFAULT_TERMS
    validity_days: int = DEFAULT_VALIDITY
    notes: str = ""


def _specs(req: Requirement) -> list[dict]:
    try:
        return [r for r in json.loads(req.specifications_json or "[]") if (r.get("label") or "").strip()]
    except Exception:
        return []


def _leading_number(text: str) -> float:
    m = re.search(r"\d[\d,]*(?:\.\d+)?", text or "")
    if not m:
        return 1
    try:
        value = float(m.group(0).replace(",", ""))
    except ValueError:
        return 1
    return value if value > 0 else 1


def _own_past_prices(session: Session, business_id: int, req: Requirement) -> list[dict]:
    """The seller's own recent quotations — same category first. Only rows
    where business_id is the requesting seller; never anyone else's."""
    rows = session.exec(
        select(Quotation, Requirement)
        .where(Quotation.business_id == business_id)
        .where(Quotation.requirement_id == Requirement.id)
        .where(Quotation.requirement_id != req.id)
        .order_by(Quotation.id.desc())
        .limit(30)
    ).all()
    rows = sorted(rows, key=lambda qr: qr[1].category != req.category)[:PAST_QUOTATIONS]
    out = []
    for q, r in rows:
        try:
            lines = json.loads(q.line_items or "[]")
        except Exception:
            lines = []
        out.append({
            "requirement": r.title,
            "category": r.category,
            "quantity": r.quantity,
            "total_price": q.total_price,
            "line_items": [
                {"description": li.get("description"), "quantity": li.get("quantity"), "unit_price": li.get("unit_price")}
                for li in lines[:MAX_LINES]
            ],
        })
    return out


def _template(req: Requirement, specs: list[dict], message: str) -> QuotationDraftOut:
    item = item_name(req.category, req.item_code) if req.item_code and req.item_code != "other" else None
    description = (item or req.title or "Item")[:200]
    return QuotationDraftOut(
        source="template",
        message=message,
        line_items=[QuotationDraftLine(description=description, quantity=_leading_number(req.quantity), unit_price=0)],
        spec_responses=[QuotationDraftSpec(label=s["label"].strip(), complies=True, offered=None) for s in specs],
        lead_time_weeks=DEFAULT_LEAD_WEEKS,
        payment_terms=DEFAULT_TERMS,
        validity_days=DEFAULT_VALIDITY,
        notes="",
    )


def _clamp(ai: _AiDraft, req: Requirement, specs: list[dict]) -> QuotationDraftOut:
    """Keep only what QuotationCreate would accept, in the form's own choices."""
    default_qty = _leading_number(req.quantity)
    lines = []
    for li in ai.line_items[:MAX_LINES]:
        desc = (li.description or "").strip()[:200]
        if not desc:
            continue
        qty = li.quantity if li.quantity and li.quantity > 0 else default_qty
        price = round(li.unit_price, 2) if li.unit_price and li.unit_price > 0 else 0
        lines.append(QuotationDraftLine(description=desc, quantity=round(qty, 2), unit_price=price))

    # Exactly one answer per spec row, in the requirement's order; the AI's
    # answer only where its label matches.
    by_label = {(s.label or "").strip().lower(): s for s in ai.spec_responses}
    spec_out = []
    for row in specs:
        label = row["label"].strip()
        answer = by_label.get(label.lower())
        offered = ((answer.offered or "").strip()[:200] or None) if answer else None
        complies = True if not answer else (answer.complies or not offered)
        spec_out.append(QuotationDraftSpec(label=label, complies=complies, offered=None if complies else offered))

    terms = ai.payment_terms if ai.payment_terms in PAYMENT_TERMS else DEFAULT_TERMS
    validity = min(VALIDITY_DAYS, key=lambda v: abs(v - (ai.validity_days or DEFAULT_VALIDITY)))
    weeks = max(1, min(52, int(ai.lead_time_weeks or DEFAULT_LEAD_WEEKS)))
    if not lines:
        return _template(req, specs, "The AI draft had no usable line items, so this is a template without prices.")
    return QuotationDraftOut(
        source="ai",
        message="AI draft — review every line and price before sealing.",
        line_items=lines,
        spec_responses=spec_out,
        lead_time_weeks=weeks,
        payment_terms=terms,
        validity_days=validity,
        notes=(ai.notes or "").strip()[:500],
    )


def _offered_items(seller: User) -> str:
    """offered_items is JSON [{code, other_text}] — readable names for the prompt."""
    try:
        rows = json.loads(seller.offered_items or "[]")
    except Exception:
        return (seller.offered_items or "")[:500]
    names = [(r.get("other_text") or (r.get("code") or "").replace("_", " ")).strip() for r in rows if isinstance(r, dict)]
    return ", ".join(n for n in names if n)[:1500]


def build_prompt(req: Requirement, specs: list[dict], seller: User, past: list[dict]) -> str:
    item = item_name(req.category, req.item_code) if req.item_code and req.item_code != "other" else None
    budget = (
        f"PHP {req.price_min:,.0f} – {req.price_max:,.0f}" if req.price_min and req.price_max else "not given"
    )
    spec_lines = "\n".join(f"- label \"{s['label']}\" — required: {s.get('value', '')}" for s in specs) or "(none)"
    docs = ", ".join(d for d in (req.required_documents or "").split(",") if d) or "(none)"
    return (
        "You help a supplier in Metro Manila, Philippines draft a sealed quotation on a B2B "
        "procurement platform. Draft a realistic first version for the supplier to review. "
        "Prices are in Philippine pesos. Base unit prices on the supplier's OWN past prices "
        "when relevant, otherwise on typical Philippine market prices. Price realistically: do "
        "not lower prices just to fit the buyer's indicative budget — if a realistic total is "
        "above it, say so briefly in the notes. Do not invent certifications, and do not promise "
        "documents; the supplier attaches required documents separately.\n\n"
        "REQUIREMENT\n"
        f"Title: {req.title}\n"
        f"Category: {req.category}" + (f" · Item: {item}" if item else "") + "\n"
        f"Quantity: {req.quantity}\n"
        f"Indicative budget: {budget}\n"
        f"Delivery to: {req.city}\n"
        f"Scope: {(req.scope or '')[:2000]}\n"
        f"Specifications (answer every one, using the exact label):\n{spec_lines}\n"
        f"Required documents: {docs}\n\n"
        "SUPPLIER (the one quoting)\n"
        f"Capabilities: {seller.capabilities or '(not listed)'}\n"
        f"Items offered: {_offered_items(seller) or '(not listed)'}\n"
        f"Their own recent quotations: {json.dumps(past, ensure_ascii=False) if past else '(none yet)'}\n\n"
        "Return JSON with: line_items (description, quantity, unit_price — at most "
        f"{MAX_LINES}), spec_responses (label exactly as quoted above, complies, offered — offered only when it "
        "does not comply, saying what is offered instead), lead_time_weeks (integer), "
        f"payment_terms (exactly one of: {', '.join(PAYMENT_TERMS)}), validity_days "
        f"(one of: {', '.join(str(v) for v in VALIDITY_DAYS)}), and notes (a short, "
        "professional note to the buyer, under 400 characters)."
    )


def _ask_gemini(prompt: str) -> Optional[_AiDraft]:
    try:
        from google import genai
        from google.genai import types
    except Exception:
        logger.exception("Quotation draft: google-genai import failed")
        return None
    try:
        client = genai.Client(api_key=settings.GEMINI_API_KEY, http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS))
    except Exception:
        logger.exception("Quotation draft: client construction failed")
        return None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = client.models.generate_content(
                model=DRAFT_MODEL,
                contents=[prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=_AiDraft,
                ),
            )
            return _AiDraft.model_validate_json(response.text)
        except Exception:
            logger.exception("Quotation draft failed (attempt %d/%d)", attempt, MAX_ATTEMPTS)
            if attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS)
    return None


def draft(requirement_id: int, seller_id: int) -> QuotationDraftOut:
    with Session(engine) as session:
        req = repo.get_requirement(session, requirement_id)
        if not req:
            raise RequirementNotFound()
        if req.owner_id == seller_id:
            raise CannotQuoteOwnRequirement()
        if req.status != "open" or req.closes_at <= now_ph():
            raise RequirementNotOpen()
        if repo.get_active_quotation(session, requirement_id, seller_id):
            raise AlreadyQuoted()
        seller = session.get(User, seller_id)
        specs = _specs(req)
        if not platform_settings.ai_enabled():
            return _template(req, specs, "AI drafting isn't set up, so this is a template without prices.")
        prompt = build_prompt(req, specs, seller, _own_past_prices(session, seller_id, req))

    ai = _ask_gemini(prompt)
    if ai is None:
        return _template(req, specs, "The AI couldn't draft this right now, so this is a template without prices.")
    return _clamp(ai, req, specs)
