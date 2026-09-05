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


def start_scheduler(interval_seconds: int = 15, closing_soon_interval_seconds: int = 300) -> BackgroundScheduler:
    """Starts the background jobs that release sealed quotations once a
    requirement's closing time has passed (the only thing that can move a
    requirement from 'open' to 'closed' — no API endpoint does it, by design,
    so release is always clock-triggered rather than person-triggered) and
    that send REQUIREMENT_CLOSING alerts to owners whose requirement is about
    to close. The closing-soon check runs far less often — it only needs to
    catch each requirement once, sometime inside a 24-hour window, not track
    a hard deadline to the second the way release does."""
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    scheduler = BackgroundScheduler()
    scheduler.add_job(_run_release_check, "interval", seconds=interval_seconds, id="release_due_requirements")
    scheduler.add_job(_run_closing_soon_check, "interval", seconds=closing_soon_interval_seconds, id="notify_closing_soon")
    scheduler.start()
    _scheduler = scheduler
    return scheduler


def stop_scheduler():
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None