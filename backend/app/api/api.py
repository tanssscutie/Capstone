from fastapi import APIRouter

from .routes import auth as auth_route
from .routes import requirements as requirements_route
from .routes import business as business_route
from .routes import admin_library as admin_library_route
from .routes import admin_team as admin_team_route
from .routes import platform_rules as platform_rules_route
from .routes import admin_audit as admin_audit_route
from .routes import admin_data as admin_data_route
from .routes import notifications as notifications_route
from .routes import messages as messages_route
from .routes import meta as meta_route

api_router = APIRouter()

api_router.include_router(auth_route.router, prefix="/auth", tags=["auth"])
api_router.include_router(requirements_route.router, prefix="/requirements", tags=["requirements"])
api_router.include_router(business_route.router, prefix="/business", tags=["business"])
api_router.include_router(admin_library_route.router, prefix="/business", tags=["business"])
api_router.include_router(admin_team_route.router, prefix="/business", tags=["business"])
api_router.include_router(platform_rules_route.router, prefix="/business", tags=["business"])
api_router.include_router(admin_audit_route.router, prefix="/business", tags=["business"])
api_router.include_router(admin_data_route.router, prefix="/business", tags=["business"])
api_router.include_router(notifications_route.router, prefix="/notifications", tags=["notifications"])
api_router.include_router(messages_route.router, prefix="/messages", tags=["messages"])
api_router.include_router(meta_route.router, prefix="/meta", tags=["meta"])
