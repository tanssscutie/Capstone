"""Who sees which part of a business profile — chosen by the owner, per
section, and enforced in the profile API (never only in the UI).

Levels: public (any signed-in business), verified (verified businesses only),
only_me. The owner and administrators always see everything. Contact details
are never public: verified at most (the existing rule against harvesting
numbers).

Always public, whatever the settings — the verification badge, tier and the
transparency/track record (activity counts): they're what lets a stranger
trust a business, so a business can't hide them.
"""
import json
from typing import Dict, Optional

from app.models.user import User

SECTIONS = ("about", "links", "highlights", "offered_items", "service_areas", "completed_orders", "contact")
LEVELS = ("public", "verified", "only_me")
DEFAULTS: Dict[str, str] = {**{s: "public" for s in SECTIONS}, "contact": "verified"}
NOT_PUBLIC = {"contact"}
VIEW_AS = ("public", "verified")


def load(user: User) -> Dict[str, str]:
    try:
        stored = json.loads(user.profile_visibility or "{}")
    except (TypeError, ValueError):
        stored = {}
    out = dict(DEFAULTS)
    for section, level in (stored or {}).items():
        if section in SECTIONS and level in LEVELS and not (section in NOT_PUBLIC and level == "public"):
            out[section] = level
    return out


def check(choices: Dict[str, str]) -> Dict[str, str]:
    """Validates an owner's choices; returns the full set. ValueError on a bad one."""
    for section, level in choices.items():
        if section not in SECTIONS:
            raise ValueError(f"Unknown profile section: {section}")
        if level not in LEVELS:
            raise ValueError(f"Choose public, verified or only_me for {section}")
        if section in NOT_PUBLIC and level == "public":
            raise ValueError("Contact details can be shown to verified businesses at most")
    return {**DEFAULTS, **choices}


def audience(viewer: User, owner: User, view_as: Optional[str] = None) -> str:
    """owner | admin | verified | public. The owner can preview their profile
    as others see it (view_as) — then they're treated exactly like them."""
    if viewer.id == owner.id:
        return view_as if view_as in VIEW_AS else "owner"
    if viewer.is_admin:
        return "admin"
    return "verified" if viewer.is_verified and viewer.verification_status == "verified" else "public"


def visible(level: str, who: str) -> bool:
    if who in ("owner", "admin"):
        return True
    if level == "public":
        return True
    if level == "verified":
        return who == "verified"
    return False


def hidden_sections(owner: User, who: str) -> list[str]:
    choices = load(owner)
    return [s for s in SECTIONS if not visible(choices[s], who)]
