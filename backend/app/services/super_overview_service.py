"""Super-admin dashboard: each administrator's workload over the last 30
days, and the health of the services TrustLink depends on. Read-only and
cheap — nothing here calls Gemini or sends an email; a check that can't
run reports "warning" instead of failing the page."""
import os
import time
from collections import Counter, defaultdict
from datetime import timedelta
from typing import List

from sqlalchemy import text
from sqlmodel import Session, select

from app.core import platform_settings
from app.core.clock import now_ph
from app.core.config import settings
from app.core.database import engine
from app.models.admin_action import AdminAction
from app.models.business_report import BusinessReport
from app.models.profile_change_request import ProfileChangeRequest
from app.models.user import User
from app.models.verification_review import VerificationReview

WINDOW_DAYS = 30
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BACKUP_STALE_DAYS = 7


def workload(session: Session) -> List[dict]:
    since = now_ph() - timedelta(days=WINDOW_DAYS)
    admins = session.exec(select(User).where(User.is_admin == True).order_by(User.created_at, User.id)).all()  # noqa: E712
    reviews = session.exec(select(VerificationReview).where(VerificationReview.created_at >= since)).all()
    reports = Counter(r.reviewed_by for r in session.exec(select(BusinessReport).where(
        BusinessReport.reviewed_at != None, BusinessReport.reviewed_at >= since)).all())  # noqa: E711
    changes = Counter(c.admin_id for c in session.exec(select(ProfileChangeRequest).where(
        ProfileChangeRequest.reviewed_at != None, ProfileChangeRequest.reviewed_at >= since)).all())  # noqa: E711
    actions = session.exec(select(AdminAction).where(AdminAction.created_at >= since)).all()
    action_count = Counter(a.admin_id for a in actions)
    last_action = {}
    for a in actions:
        if a.admin_id not in last_action or a.created_at > last_action[a.admin_id]:
            last_action[a.admin_id] = a.created_at
    review_hours = defaultdict(list)
    review_count = Counter()
    for r in reviews:
        review_count[r.admin_id] += 1
        if r.submitted_at:
            review_hours[r.admin_id].append((r.created_at - r.submitted_at).total_seconds() / 3600)
    out = []
    for u in admins:
        hours = review_hours.get(u.id)
        out.append({
            "id": u.id, "name": u.business_name, "admin_role": u.admin_role or "admin", "is_active": u.is_active,
            "verifications": review_count.get(u.id, 0), "reports": reports.get(u.id, 0),
            "change_requests": changes.get(u.id, 0), "actions": action_count.get(u.id, 0),
            "avg_review_hours": round(sum(hours) / len(hours), 1) if hours else None,
            "last_action_at": last_action.get(u.id),
        })
    return out


def _folder_size(path: str) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def health() -> List[dict]:
    checks = []

    started = time.perf_counter()
    try:
        with Session(engine) as session:
            session.exec(text("SELECT 1"))
        ms = round((time.perf_counter() - started) * 1000)
        checks.append({"name": "Database", "status": "ok", "detail": f"Responding ({ms} ms)"})
    except Exception as e:
        checks.append({"name": "Database", "status": "down", "detail": f"Not reachable: {type(e).__name__}"})

    try:
        from app.services import release_scheduler
        running = bool(release_scheduler._scheduler and release_scheduler._scheduler.running)
    except Exception:
        running = False
    checks.append({"name": "Release scheduler", "status": "ok" if running else "down",
                   "detail": "Releasing quotations at closing time" if running
                   else "Not running — sealed quotations won't be released on time"})

    if not settings.GEMINI_API_KEY:
        checks.append({"name": "AI (Gemini)", "status": "off", "detail": "No key on the server — the template fallbacks are used"})
    elif not platform_settings.ai_enabled():
        checks.append({"name": "AI (Gemini)", "status": "off", "detail": "Switched off under Platform rules"})
    else:
        checks.append({"name": "AI (Gemini)", "status": "ok", "detail": "Key set and switched on (not called by this check)"})

    checks.append({"name": "Email (SMTP)", "status": "ok" if settings.SMTP_HOST else "warning",
                   "detail": f"Sending through {settings.SMTP_HOST}" if settings.SMTP_HOST
                   else "No SMTP server — codes and alerts print to the backend console"})

    try:
        from app.services import matching_service
        if matching_service._qdrant_unavailable:
            q = ("warning", "Unavailable — the feed falls back to closing-time order")
        elif matching_service._qdrant is not None:
            q = ("ok", "Vector store loaded")
        else:
            q = ("warning", "Not loaded yet")
    except Exception:
        q = ("warning", "Unknown")
    checks.append({"name": "Semantic matching (Qdrant)", "status": q[0], "detail": q[1]})

    checks.append({"name": "File encryption", "status": "ok" if settings.FILE_ENCRYPTION_KEY else "down",
                   "detail": "Uploads encrypted at rest" if settings.FILE_ENCRYPTION_KEY else "No FILE_ENCRYPTION_KEY set"})

    uploads = os.path.join(BACKEND_ROOT, "uploads")
    size_mb = _folder_size(uploads) / 1_000_000 if os.path.isdir(uploads) else 0
    checks.append({"name": "Uploads on disk", "status": "ok", "detail": f"{size_mb:.1f} MB"})

    backups = os.path.join(BACKEND_ROOT, "backups")
    names = sorted((n for n in os.listdir(backups) if os.path.isdir(os.path.join(backups, n))), reverse=True) \
        if os.path.isdir(backups) else []
    if not names:
        checks.append({"name": "Last backup", "status": "warning", "detail": "No backup yet — run one under Backups & exports"})
    else:
        try:
            from datetime import datetime
            age = now_ph() - datetime.strptime(names[0], "%Y-%m-%d_%H%M%S")
            stale = age > timedelta(days=BACKUP_STALE_DAYS)
            days = age.days
            checks.append({"name": "Last backup", "status": "warning" if stale else "ok",
                           "detail": f"{names[0]} ({'today' if days == 0 else f'{days} day' + ('' if days == 1 else 's') + ' ago'})"})
        except ValueError:
            checks.append({"name": "Last backup", "status": "ok", "detail": names[0]})
    return checks


def overview() -> dict:
    with Session(engine) as session:
        return {"window_days": WINDOW_DAYS, "workload": workload(session), "health": health()}
