import logging

from apscheduler.schedulers.background import BackgroundScheduler

from app.services.requirement_service import requirement_service

logger = logging.getLogger("trustlink.release_scheduler")

_scheduler: BackgroundScheduler | None = None


def _run_release_check():
    try:
        released = requirement_service.release_due_requirements()
        if released:
            logger.info("Released %d requirement(s) at closing time", released)
    except Exception:
        logger.exception("Release check failed")


def _run_closing_soon_check():
    try:
        notified = requirement_service.notify_closing_soon()
        if notified:
            logger.info("Sent %d closing-soon alert(s)", notified)
    except Exception:
        logger.exception("Closing-soon check failed")


def _run_award_expiry_check():
    try:
        expired = requirement_service.expire_due_award_notices()
        if expired:
            logger.info("Auto-declined %d unanswered Notice(s) of Award", expired)
    except Exception:
        logger.exception("Award-expiry check failed")


def start_scheduler(interval_seconds: int = 15, closing_soon_interval_seconds: int = 300) -> BackgroundScheduler:
    """Starts the background jobs that release sealed quotations once a
    requirement's closing time has passed (the only thing that can move a
    requirement from 'open' to 'closed' — no API endpoint does it, by design,
    so release is always clock-triggered rather than person-triggered), that
    send REQUIREMENT_CLOSING alerts to owners whose requirement is about
    to close, and that auto-decline a Notice of Award nobody responded to in
    time. The closing-soon check runs far less often — it only needs to
    catch each requirement once, sometime inside a 24-hour window, not track
    a hard deadline to the second the way release (and award expiry) does."""
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    scheduler = BackgroundScheduler()
    scheduler.add_job(_run_release_check, "interval", seconds=interval_seconds, id="release_due_requirements")
    scheduler.add_job(_run_closing_soon_check, "interval", seconds=closing_soon_interval_seconds, id="notify_closing_soon")
    scheduler.add_job(_run_award_expiry_check, "interval", seconds=interval_seconds, id="expire_due_award_notices")
    scheduler.start()
    _scheduler = scheduler
    return scheduler


def stop_scheduler():
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None