"""Admin audit log: who did what, to whom, and when — verification and
report decisions, restrictions lifted, change requests, files opened,
Documents uploads, the admin team, platform rules, backups and exports.

record() never fails the action it describes: if the row can't be written
it is logged and skipped. Super admins read it (with filters) and export it
as CSV — admin_audit routes in api/routes/admin_audit.py.
"""
import csv
import io
import logging
from datetime import datetime
from typing import List, Optional

from sqlmodel import Session, select

from app.core.database import engine
from app.models.admin_action import AdminAction
from app.models.user import User

logger = logging.getLogger("trustlink.audit")

ACTION_LABELS = {
    "verification_approved": "Approved a verification",
    "verification_rejected": "Rejected a verification",
    "report_dismissed": "Dismissed a report",
    "report_actioned": "Acted on a report",
    "restriction_lifted": "Lifted a restriction",
    "change_request_approved": "Approved a change request",
    "change_request_rejected": "Rejected a change request",
    "business_document_viewed": "Opened a business document",
    "withdrawal_proof_viewed": "Opened a withdrawal proof",
    "library_uploaded": "Uploaded to Documents",
    "library_deleted": "Deleted from Documents",
    "admin_created": "Added an administrator",
    "admin_role_changed": "Changed an admin's role",
    "admin_disabled": "Disabled an administrator",
    "admin_enabled": "Re-enabled an administrator",
    "admin_password_reset": "Reset an admin's password",
    "platform_rule_changed": "Changed a platform rule",
    "platform_rule_reset": "Reset a platform rule",
    "backup_created": "Ran a backup",
    "data_exported": "Exported data (CSV)",
}


def record(session: Optional[Session], admin_id: int, action: str, target_user_id: Optional[int] = None,
           details: Optional[str] = None) -> None:
    try:
        row = AdminAction(admin_id=admin_id, action=action, target_user_id=target_user_id,
                          details=(details or None) and details[:1000])
        if session is None:
            with Session(engine) as own:
                own.add(row)
                own.commit()
        else:
            session.add(row)
            session.commit()
    except Exception:
        if session is not None:
            session.rollback()
        logger.exception("Could not write the audit entry %s by admin %s", action, admin_id)


def _name(u: Optional[User]) -> Optional[str]:
    if not u:
        return None
    return u.display_name or u.registered_name or u.business_name


def entries(admin_id: Optional[int] = None, action: Optional[str] = None, q: str = "",
            since: Optional[datetime] = None, limit: int = 500) -> List[dict]:
    with Session(engine) as session:
        query = select(AdminAction).order_by(AdminAction.created_at.desc(), AdminAction.id.desc())
        if admin_id:
            query = query.where(AdminAction.admin_id == admin_id)
        if action:
            query = query.where(AdminAction.action == action)
        if since:
            query = query.where(AdminAction.created_at >= since)
        rows = session.exec(query).all()
        users = {u.id: u for u in session.exec(select(User).where(
            User.id.in_({r.admin_id for r in rows} | {r.target_user_id for r in rows if r.target_user_id}))).all()} if rows else {}
        out = []
        needle = q.strip().lower()
        for r in rows:
            item = {
                "id": r.id, "created_at": r.created_at, "admin_id": r.admin_id,
                "admin_name": _name(users.get(r.admin_id)) or f"Admin #{r.admin_id}",
                "action": r.action, "action_label": ACTION_LABELS.get(r.action, r.action),
                "target_user_id": r.target_user_id,
                "target_name": _name(users.get(r.target_user_id)) if r.target_user_id else None,
                "details": r.details,
            }
            if needle and not any(needle in str(v).lower() for v in (item["admin_name"], item["action_label"],
                                                                      item["target_name"], item["details"]) if v):
                continue
            out.append(item)
            if len(out) >= limit:
                break
        return out


def to_csv(rows: List[dict]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["When (PHT)", "Administrator", "Action", "Target business", "Details"])
    for r in rows:
        w.writerow([r["created_at"].strftime("%Y-%m-%d %H:%M:%S"), r["admin_name"], r["action_label"],
                    r["target_name"] or "", r["details"] or ""])
    return buf.getvalue()


def admins() -> List[dict]:
    with Session(engine) as session:
        return [{"id": u.id, "name": _name(u)} for u in session.exec(select(User).where(User.is_admin == True)).all()]  # noqa: E712
