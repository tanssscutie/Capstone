"""Platform rules — super admins change them here; see app/core/platform_settings.py."""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session

from app.core import platform_settings
from app.core.clock import now_ph
from app.core.database import engine
from app.core.security import require_super_admin
from app.models.platform_setting import PlatformSetting
from app.models.user import User
from app.services import admin_audit

router = APIRouter()


class RuleIn(BaseModel):
    value: Any


def _rules() -> list:
    overrides = platform_settings._overrides()
    out = []
    for key, d in platform_settings.DEFINITIONS.items():
        out.append({
            "key": key, "label": d["label"], "type": d["type"], "help": d["help"],
            "min": d.get("min"), "max": d.get("max"), "max_length": d.get("max_length"),
            "value": platform_settings.get(key), "default": d["default"](), "overridden": key in overrides,
        })
    return out


def _audit(actor_id: int, action: str, details: str) -> None:
    admin_audit.record(None, actor_id, action, details=details)


@router.get("/admin/platform-rules")
def list_rules(_super: User = Depends(require_super_admin)):
    """Every editable rule: its value in force, the .env default, and whether it's overridden."""
    return _rules()


@router.put("/admin/platform-rules/{key}")
def set_rule(key: str, payload: RuleIn, actor: User = Depends(require_super_admin)):
    if key not in platform_settings.DEFINITIONS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown rule")
    try:
        value = platform_settings.parse(key, payload.value)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    stored = ("true" if value else "false") if isinstance(value, bool) else str(value)
    with Session(engine) as session:
        row = session.get(PlatformSetting, key) or PlatformSetting(key=key, value=stored)
        row.value, row.updated_by, row.updated_at = stored, actor.id, now_ph()
        session.add(row)
        session.commit()
    platform_settings.clear_cache()
    _audit(actor.id, "platform_rule_changed", f"{key} = {stored}")
    return _rules()


@router.delete("/admin/platform-rules/{key}")
def reset_rule(key: str, actor: User = Depends(require_super_admin)):
    """Back to the server's .env default."""
    if key not in platform_settings.DEFINITIONS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown rule")
    with Session(engine) as session:
        row = session.get(PlatformSetting, key)
        if row:
            session.delete(row)
            session.commit()
    platform_settings.clear_cache()
    _audit(actor.id, "platform_rule_reset", key)
    return _rules()
