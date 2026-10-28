from typing import List, Optional

from pydantic import BaseModel, Field


class ItemSpecOut(BaseModel):
    """One spec of an item, already merged General → Category → Item
    (app/core/categories.get_item_specs)."""
    id: str  # ATTRIBUTES id
    label: str
    type: str  # text | number | select
    unit: Optional[str] = None
    options: List[str] = []
    required: bool
    # Offers "Not sure — supplier to recommend" (categories.SUPPLIER_TO_RECOMMEND).
    can_recommend: bool = False
    # Guessed, pending review — see the DRAFTS note in app/core/categories.py.
    draft: bool = False


class CategoryItemOut(BaseModel):
    code: str
    name: str
    specs: List[ItemSpecOut] = []


class NcrZipOut(BaseModel):
    zip: str
    area: str  # the post office area the ZIP covers, e.g. "Ortigas Center"


class NcrBarangayOut(BaseModel):
    name: str
    # Only when the data is sure (see app/core/addresses.py) — otherwise the
    # form asks the buyer to pick from the city's ZIP list.
    zip: Optional[str] = None


class NcrCityAddressesOut(BaseModel):
    city: str
    zips: List[NcrZipOut]
    barangays: List[NcrBarangayOut]


class CategoryOut(BaseModel):
    name: str
    items: List[CategoryItemOut]


class AttributeOut(BaseModel):
    id: str
    label: str
    type: str
    unit: Optional[str] = None
    options: List[str] = []
    synonyms: List[str] = []
    draft: bool = False


class SpecSuggestionRequest(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    category: Optional[str] = Field(default=None, max_length=100)
    item_code: Optional[str] = Field(default=None, max_length=60)


class SpecSuggestionOut(BaseModel):
    """A hint only ("Ito ba ay …?") — every field null when nothing clears
    the threshold (app/services/spec_suggestion_service.py)."""
    attribute_id: Optional[str] = None
    label: Optional[str] = None
    unit: Optional[str] = None
    score: Optional[float] = None
