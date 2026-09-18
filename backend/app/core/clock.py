"""The single time convention this backend stores and compares every
timestamp in: naive Philippine wall-clock time (UTC+8), never true UTC.

Why: a client-supplied datetime (e.g. a requirement's closing time) always
arrives with an explicit "+08:00" offset, but the MySQL DATETIME column it
lands in has no timezone of its own — the driver drops the offset without
converting, keeping the wall-clock numbers exactly as typed. So closes_at
has always effectively been stored as naive PHT. Meanwhile every
server-authored timestamp (created_at, submitted_at, released_at, ...) used
datetime.utcnow() — true UTC, 8 hours behind. Comparing one against the
other silently skewed by 8 hours in both directions: a closing time stayed
enforceable ~8h after the moment a business actually saw it pass, and a
just-created row's created_at read ~8h in the future relative to "now",
making "posted just now" render as "posted 8 hours ago" the instant it
appeared. now_ph() is what "now" means everywhere in this backend; every
model's created_at/uploaded_at-style default and every comparison against a
stored datetime should use it instead of datetime.utcnow().

Deliberately NOT used for JWT exp/iat (app/core/security.py) — those follow
the JWT spec's own UTC convention, checked against the verifying library's
own clock, and were never part of this bug.
"""
from datetime import datetime, timedelta

PH_UTC_OFFSET = timedelta(hours=8)


def now_ph() -> datetime:
    return datetime.utcnow() + PH_UTC_OFFSET


def to_ph_naive(value: datetime) -> datetime:
    """Normalizes a datetime that may or may not carry a timezone into this
    backend's one convention: naive PHT wall-clock. An aware value is
    converted properly; a naive value is assumed to already be PHT (the
    only kind of naive datetime a client-facing field here should ever
    hold) and passed through unchanged."""
    if value.tzinfo is None:
        return value
    from datetime import timezone
    return value.astimezone(timezone(PH_UTC_OFFSET)).replace(tzinfo=None)
