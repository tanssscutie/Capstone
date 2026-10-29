"""Platform rules a super admin can change from the admin console, on top of
the server's .env defaults: a PlatformSetting row overrides the default;
deleting it ("Reset") brings the default back.

Read through the helpers below (min_quotations(), ai_enabled(), …) — never
settings.X directly for these. Values are cached for a few seconds, and any
database error falls back to the default, so a rule lookup never fails a
request.
"""
import time
from typing import Any, Dict, Optional

from app.core.config import settings

CACHE_SECONDS = 5

DEFINITIONS: Dict[str, dict] = {
    "min_quotations_to_release": {
        "label": "Quotations needed to release", "type": "int", "min": 1, "max": 20,
        "help": "Fewer than this at closing: the closing date is extended once, then the requirement is archived.",
        "default": lambda: settings.MIN_QUOTATIONS_TO_RELEASE,
    },
    "auto_extend_days": {
        "label": "Auto-extension (days)", "type": "int", "min": 1, "max": 30,
        "help": "How long closing is extended when too few quotations arrived.",
        "default": lambda: settings.AUTO_EXTEND_DAYS,
    },
    "withdrawal_window_days": {
        "label": "Withdrawal window (days)", "type": "int", "min": 7, "max": 365,
        "help": "Withdrawals counted for the warning → suspension → ban policy.",
        "default": lambda: 90,
    },
    "ai_enabled": {
        "label": "AI features", "type": "bool",
        "help": "Document check, number extraction, category and detail suggestions, quotation drafts. "
                "Also needs the Gemini key on the server.",
        "default": lambda: True,
    },
    "maintenance_banner": {
        "label": "Maintenance banner", "type": "text", "max_length": 300,
        "help": "Shown at the top of every page for signed-in users. Empty = no banner.",
        "default": lambda: "",
    },
}

_cache: Dict[str, Any] = {}
_cached_at = 0.0


def clear_cache() -> None:
    global _cached_at
    _cache.clear()
    _cached_at = 0.0


def _overrides() -> Dict[str, str]:
    global _cached_at
    if time.monotonic() - _cached_at < CACHE_SECONDS:
        return _cache
    try:
        from sqlmodel import Session, select
        from app.core.database import engine
        from app.models.platform_setting import PlatformSetting

        with Session(engine) as session:
            rows = {r.key: r.value for r in session.exec(select(PlatformSetting)).all()}
    except Exception:
        rows = {}  # no table yet, or the database is unreachable: defaults
    _cache.clear()
    _cache.update(rows)
    _cached_at = time.monotonic()
    return _cache


def parse(key: str, raw: Any) -> Any:
    """The value in its type, or ValueError with a message for the admin."""
    d = DEFINITIONS[key]
    if d["type"] == "int":
        try:
            value = int(str(raw).strip())
        except ValueError:
            raise ValueError(f"{d['label']} must be a whole number.")
        if not d["min"] <= value <= d["max"]:
            raise ValueError(f"{d['label']} must be between {d['min']} and {d['max']}.")
        return value
    if d["type"] == "bool":
        if isinstance(raw, bool):
            return raw
        text = str(raw).strip().lower()
        if text not in ("true", "false", "1", "0"):
            raise ValueError(f"{d['label']} must be on or off.")
        return text in ("true", "1")
    text = str(raw or "").strip()
    if len(text) > d["max_length"]:
        raise ValueError(f"{d['label']} can be at most {d['max_length']} characters.")
    return text


def get(key: str) -> Any:
    raw: Optional[str] = _overrides().get(key)
    if raw is not None:
        try:
            return parse(key, raw)
        except ValueError:
            pass
    return DEFINITIONS[key]["default"]()


def min_quotations() -> int:
    return get("min_quotations_to_release")


def auto_extend_days() -> int:
    return get("auto_extend_days")


def withdrawal_window_days() -> int:
    return get("withdrawal_window_days")


def ai_enabled() -> bool:
    """Gemini can be called: the key is configured AND the switch is on."""
    return bool(settings.GEMINI_API_KEY) and bool(get("ai_enabled"))


def maintenance_banner() -> str:
    return get("maintenance_banner")
