# Metro Manila delivery addresses: city -> barangays -> ZIP code.
#
# Data: app/data/ncr_addresses.json, built by scripts/build_ncr_addresses.py.
#   - Barangays: PSA PSGC Q1 2026 (official, all 1,715 NCR barangays).
#   - ZIP codes: an open, Grit-derived list — NOT PHLPost's. A barangay only
#     carries a ZIP when that list gives exactly one for its exact name; the
#     rest leave it to the buyer, who picks from the city's own ZIP list.
#     Rebuild the file from PHLPost's official list when it's available.
#
# The frontend reads all of this from GET /meta/ncr-addresses instead of
# keeping its own copy; requirement_service validates against it on create.
import json
import os
import re
from functools import lru_cache
from typing import Optional

_DATA = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "ncr_addresses.json")
ZIP_PATTERN = re.compile(r"^\d{4}$")


@lru_cache(maxsize=1)
def _load() -> dict:
    with open(_DATA, encoding="utf-8") as f:
        return json.load(f)["cities"]


def ncr_addresses_out() -> list[dict]:
    """[{city, zips: [{zip, area}], barangays: [{name, zip?}]}] for the form."""
    return [
        {
            "city": city,
            "zips": entry["zips"],
            "barangays": [{"name": b["name"], "zip": b.get("zip")} for b in entry["barangays"]],
        }
        for city, entry in _load().items()
    ]


def find_barangay(city: str, name: str) -> Optional[dict]:
    """The barangay's record if it's one of `city`'s, matched case-insensitively."""
    entry = _load().get(city)
    if not entry or not name:
        return None
    wanted = name.strip().casefold()
    return next((b for b in entry["barangays"] if b["name"].casefold() == wanted), None)


def barangay_label(name: str) -> str:
    """"San Antonio" -> "Brgy. San Antonio"; numbered ones ("Barangay 12") stay as-is."""
    return name if name.lower().startswith(("barangay", "brgy")) else f"Brgy. {name}"


def compose_site_address(street: str, barangay: Optional[str], zip_code: Optional[str]) -> str:
    """"Unit 4B, Exchange Rd." + "San Antonio" + "1605" ->
    "Unit 4B, Exchange Rd., Brgy. San Antonio 1605". The city is shown on its own."""
    parts = [street.strip().rstrip(",")]
    if barangay:
        parts.append(barangay_label(barangay.strip()))
    line = ", ".join(p for p in parts if p)
    return f"{line} {zip_code}" if zip_code else line
