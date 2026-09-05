from fastapi import APIRouter

from .routes import auth as auth_route
from .routes import requirements as requirements_route
from .routes import business as business_route
from .routes import notifications as notifications_route
from .routes import messages as messages_route

api_router = APIRouter()

api_router.include_router(auth_route.router, prefix="/auth", tags=["auth"])
api_router.include_router(requirements_route.router, prefix="/requirements", tags=["requirements"])
api_router.include_router(business_route.router, prefix="/business", tags=["business"])
api_router.include_router(notifications_route.router, prefix="/notifications", tags=["notifications"])
api_router.include_router(messages_route.router, prefix="/messages", tags=["messages"])