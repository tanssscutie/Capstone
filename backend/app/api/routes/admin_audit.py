"""Admin audit log — super admins only. See admin_audit."""
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Response

from app.core.clock import now_ph
from app.core.security import require_super_admin
from app.models.user import User
from app.services import admin_audit

router = APIRouter()


def _since(days: Optional[int]):
    return now_ph() - timedelta(days=days) if days else None


@router.get("/admin/audit-log")
def audit_log(admin_id: Optional[int] = None, action: Optional[str] = None, q: str = "", days: Optional[int] = None,
              _super: User = Depends(require_super_admin)):
    """Newest first (up to 500), filtered by administrator, action, period (days) and free text."""
    return {
        "entries": admin_audit.entries(admin_id, action, q, _since(days)),
        "actions": [{"value": k, "label": v} for k, v in admin_audit.ACTION_LABELS.items()],
        "admins": admin_audit.admins(),
    }


@router.get("/admin/audit-log.csv")
def audit_log_csv(admin_id: Optional[int] = None, action: Optional[str] = None, q: str = "", days: Optional[int] = None,
                  actor: User = Depends(require_super_admin)):
    """The same filters, as a CSV download (up to 10,000 rows)."""
    rows = admin_audit.entries(admin_id, action, q, _since(days), limit=10_000)
    admin_audit.record(None, actor.id, "data_exported", details=f"Audit log ({len(rows)} rows)")
    stamp = now_ph().strftime("%Y%m%d-%H%M")
    return Response(content=admin_audit.to_csv(rows), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="trustlink-audit-log-{stamp}.csv"'})
