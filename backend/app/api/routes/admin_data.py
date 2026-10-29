"""Backups and CSV exports — super admins only. See admin_data_service."""
from fastapi import APIRouter, Depends, Response
from fastapi.concurrency import run_in_threadpool

from app.core.clock import now_ph
from app.core.security import require_super_admin
from app.models.user import User
from app.services import admin_audit, admin_data_service

router = APIRouter()


@router.get("/admin/backups")
def list_backups(_super: User = Depends(require_super_admin)):
    """Backup folders on the server, newest first — listed, never downloadable here."""
    return admin_data_service.list_backups()


@router.post("/admin/backups")
async def run_backup(actor: User = Depends(require_super_admin)):
    """Database dump + encrypted uploads into backend/backups/<date_time>/."""
    result = await run_in_threadpool(admin_data_service.run_backup)
    admin_audit.record(None, actor.id, "backup_created", details=f"{result['name']} ({result['size_mb']} MB)")
    return result


@router.get("/admin/export/{kind}.csv")
def export_csv(kind: str, actor: User = Depends(require_super_admin)):
    """users | requirements | ledger. Never sealed content: no quotation figures, the ledger without payloads."""
    content = admin_data_service.export(kind)
    admin_audit.record(None, actor.id, "data_exported", details=f"{kind}.csv")
    stamp = now_ph().strftime("%Y%m%d-%H%M")
    return Response(content=content, media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="trustlink-{kind}-{stamp}.csv"'})
