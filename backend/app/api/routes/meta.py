from typing import List

from fastapi import APIRouter, Depends

from app.core.addresses import ncr_addresses_out
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


# Metro Manila cities -> barangays -> ZIP codes, for the delivery address form.
@router.get("/ncr-addresses", response_model=List[NcrCityAddressesOut])
def list_ncr_addresses():
    return ncr_addresses_out()


# Logged-in only, unlike the lists above: it runs the embedding model.
@router.post("/suggest-attribute", response_model=SpecSuggestionOut)
def suggest_attribute(payload: SpecSuggestionRequest, _user: User = Depends(get_current_user)):
    return spec_suggestion_service.suggest(payload.label, payload.category, payload.item_code) or SpecSuggestionOut()
