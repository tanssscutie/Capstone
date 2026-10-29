"""Admin team — super admins only. See admin_team_service."""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.security import require_super_admin
from app.models.user import User
from app.services.admin_team_service import admin_team_service

router = APIRouter()


class AdminCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=8, max_length=200)
    role: str = Field(default="admin", pattern="^(admin|super_admin)$")
    mobile: Optional[str] = Field(default=None, max_length=20)


class AdminRoleIn(BaseModel):
    role: str = Field(pattern="^(admin|super_admin)$")


class AdminActiveIn(BaseModel):
    active: bool


@router.get("/admin/team")
def list_admins(_super: User = Depends(require_super_admin)):
    """Every administrator account, oldest first."""
    return admin_team_service.list()


@router.post("/admin/team", status_code=201)
def create_admin(payload: AdminCreateIn, actor: User = Depends(require_super_admin)):
    return admin_team_service.create(actor.id, payload.name, payload.email, payload.password, payload.role, payload.mobile)


@router.post("/admin/team/{user_id}/role")
def set_admin_role(user_id: int, payload: AdminRoleIn, actor: User = Depends(require_super_admin)):
    """Promote or demote. The last active super admin can't be demoted."""
    return admin_team_service.set_role(actor.id, user_id, payload.role)


@router.post("/admin/team/{user_id}/active")
def set_admin_active(user_id: int, payload: AdminActiveIn, actor: User = Depends(require_super_admin)):
    """Disable or re-enable. Not your own account; not the last active super admin."""
    return admin_team_service.set_active(actor.id, user_id, payload.active)


@router.post("/admin/team/{user_id}/reset-password")
def reset_admin_password(user_id: int, actor: User = Depends(require_super_admin)):
    """A new temporary password — returned once, to hand to that administrator."""
    return admin_team_service.reset_password(actor.id, user_id)
