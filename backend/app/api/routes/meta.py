from typing import List

from fastapi import APIRouter, Depends

from app.core import platform_settings
from app.core.addresses import ncr_addresses_out
from app.core.config import settings
from app.core.categories import ATTRIBUTES, category_tree_out
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.meta import AttributeOut, CategoryOut, NcrCityAddressesOut, SpecSuggestionOut, SpecSuggestionRequest
from app.services import spec_suggestion_service

router = APIRouter()


# Public on purpose: the register form needs the category list before anyone
# is logged in. Nothing here is per-user.
@router.get("/categories", response_model=List[CategoryOut])
def list_categories():
    return category_tree_out()


@router.get("/attributes", response_model=List[AttributeOut])
def list_attributes():
    return list(ATTRIBUTES.values())


# Platform rules the UI explains (minimum quotations etc.) — from .env.
@router.get("/rules")
def market_rules():
    return {"min_quotations": platform_settings.min_quotations(), "auto_extend_days": platform_settings.auto_extend_days()}


@router.get("/banner")
def maintenance_banner():
    """The maintenance banner a super admin set — empty when there is none."""
    return {"message": platform_settings.maintenance_banner()}


# Metro Manila cities -> barangays -> ZIP codes, for the delivery address form.
@router.get("/ncr-addresses", response_model=List[NcrCityAddressesOut])
def list_ncr_addresses():
    return ncr_addresses_out()


# Logged-in only, unlike the lists above: it runs the embedding model.
@router.post("/suggest-attribute", response_model=SpecSuggestionOut)
def suggest_attribute(payload: SpecSuggestionRequest, _user: User = Depends(get_current_user)):
    return spec_suggestion_service.suggest(payload.label, payload.category, payload.item_code) or SpecSuggestionOut()
