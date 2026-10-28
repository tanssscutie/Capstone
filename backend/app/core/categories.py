# The 2 categories the study scopes procurement to (thesis Scope and
# Delimitation — Supported Categories), each broken down into the items a
# buyer can request and the specifications each item asks for.
#
# Single source of truth: the frontend reads all of this from
# GET /meta/categories (see app/api/routes/meta.py) instead of keeping its own
# copy. CATEGORIES (the flat list) is still compared verbatim by registration
# and the category-suggestion feature (app/services/category_suggestion_service.py).
#
# Three pieces:
#   ATTRIBUTES      — the shared dictionary. Every spec anywhere is one of these,
#                     by id: label, type (number | select | text), unit, options,
#                     and synonyms (English + Filipino/Taglish) that
#                     spec_suggestion_service matches a buyer's own row labels against.
#   GENERAL_SPECS   — asked of every item.
#   CATEGORY_TREE   — per category: the category layer's specs, then its items,
#                     each with its own item layer.
# get_item_specs() merges General → Category → Item by attribute id; a later
# layer overrides an earlier one's fields (required, label, unit, options, type).
#
# DRAFTS: every attribute and item spec marked draft=True was guessed and is
# pending review — only Tarpaulin's size / finish / eyelets came from the brief,
# plus the general layer (quantity, unit, preferred brand, remarks).
#
# Size and Color aren't in the general layer: an item that needs a size asks
# for it in its own layer (with its unit), and anything else the buyer adds as
# their own row — "Did you mean Size?" still matches it to the attribute.
# The flag is exposed by the API so reviewers can list what's still a guess.
#
# A spec is stored on a requirement as a {attribute_id, label, value} row, the
# unit folded into the label ("Size (ft)") — see spec_label() — so rows still
# read on their own, and requirements posted before attribute ids existed load fine.
import re
from typing import Optional

OTHER_ITEM_CODE = "other"
OTHER_ITEM_NAME = "Other"

# The value a buyer picks for a technical spec they don't know (paper weight,
# thickness, …) — "Not sure — supplier to recommend". Accepted only on specs
# marked can_recommend, whatever their type. Same constant as
# SUPPLIER_TO_RECOMMEND in frontend/lib/data/categories.ts.
SUPPLIER_TO_RECOMMEND = "Supplier to recommend"

# General attributes that aren't spec rows: they're the requirement's own
# quantity column, composed as "<quantity> <unit>" (e.g. "500 pcs").
QUANTITY_ATTRIBUTE_IDS = ("quantity", "unit")


def _attr(id: str, label: str, type: str = "text", *, unit: Optional[str] = None,
          options: Optional[list[str]] = None, synonyms: Optional[list[str]] = None,
          draft: bool = True) -> dict:
    return {"id": id, "label": label, "type": type, "unit": unit, "options": options or [],
            "synonyms": synonyms or [], "draft": draft}


_SIDES = ["1 side", "2 sides"]
_LAMINATION = ["None", "Matte", "Glossy"]
_YES_NO = ["Yes", "No"]
_PRINT_COLORS = ["Plain", "1 color", "2 colors", "Full color"]

_ATTRIBUTE_LIST = [
    # ---- general ----
    _attr("quantity", "Quantity", "number", synonyms=["qty", "dami", "ilan", "bilang", "ilang piraso", "how many"], draft=False),
    _attr("unit", "Unit", "select", options=["pcs", "sets", "boxes", "packs", "rolls", "reams", "sheets"],
          synonyms=["unit of measure", "uom", "per", "yunit"], draft=False),
    _attr("size", "Size", synonyms=["dimensions", "dimension", "sukat", "laki", "haba at lapad", "measurement", "sizing"], draft=False),
    _attr("color", "Color", synonyms=["colour", "kulay", "color scheme", "kulay ng print"], draft=False),
    _attr("preferred_brand", "Preferred brand", synonyms=["brand", "tatak", "gustong brand", "brand name", "make"], draft=False),
    _attr("remarks", "Remarks", synonyms=["notes", "note", "paalala", "iba pa", "tala", "comments", "additional notes"], draft=False),
    # ---- category layer ----
    _attr("artwork", "Design file", "select", options=["Print-ready file provided", "Needs layout / design"],
          synonyms=["design", "layout", "artwork", "artwork file", "print-ready file", "disenyo", "may design na", "file"]),
    _attr("food_grade", "Food-grade", "select", options=_YES_NO,
          synonyms=["food safe", "pang-pagkain", "food contact", "for food"]),
    # ---- item layer ----
    _attr("paper_type", "Paper", "select", synonyms=["paper type", "papel", "uri ng papel", "klase ng papel", "paper stock", "stock"]),
    _attr("paper_weight", "Paper weight", "number", unit="gsm",
          synonyms=["kapal ng papel", "bigat ng papel", "paper thickness", "gsm", "paper gsm", "grammage"]),
    _attr("printed_sides", "Printed sides", "select", options=_SIDES,
          synonyms=["sides", "print sides", "harap at likod", "back to back", "isang side", "front and back"]),
    _attr("lamination", "Lamination", "select", options=_LAMINATION, synonyms=["laminate", "nakalaminate", "lamina", "coating"]),
    _attr("fold", "Fold", "select", options=["None", "Bi-fold", "Tri-fold", "Z-fold"], synonyms=["folding", "tupi", "pagkakatupi"]),
    _attr("finish", "Finish", "select", options=["Matte", "Glossy"], synonyms=["surface finish", "matte o glossy", "kintab"], draft=False),
    _attr("eyelets", "Eyelets", "select", options=["None", "Corners only", "Every 2 ft"],
          synonyms=["grommets", "eyelet", "butas", "butas sa gilid"], draft=False),
    _attr("material", "Material", "select", synonyms=["materials", "materyales", "gawa sa", "substrate", "media"]),
    _attr("cut", "Cut", "select", options=["Kiss cut", "Die cut", "Square cut"], synonyms=["cutting", "hiwa", "gupit", "cut type"]),
    _attr("page_count", "Number of pages", "number", synonyms=["pages", "page count", "ilang pahina", "bilang ng pahina", "pahina"]),
    _attr("binding", "Binding", "select", options=["Saddle stitch", "Perfect binding", "Spiral / Wire-O"],
          synonyms=["bind", "tahi", "pagkaka-bind", "binding type"]),
    _attr("cover_paper", "Cover paper", synonyms=["cover stock", "papel ng cover", "pabalat"]),
    _attr("inside_paper", "Inside paper", synonyms=["inner pages paper", "papel sa loob", "text paper"]),
    _attr("finishing", "Finishing", "select", options=["None", "Foil stamping", "Embossing", "Spot UV"],
          synonyms=["special finish", "foil", "emboss", "spot uv", "palamuti"]),
    _attr("envelope", "Envelope included", "select", options=_YES_NO, synonyms=["envelope", "sobre", "may sobre"]),
    _attr("signage_type", "Type", "select",
          options=["Acrylic", "Panaflex / Lightbox", "Sintra board", "Stainless / Metal", "Wall vinyl"],
          synonyms=["signage type", "sign type", "uri ng signage", "klase ng karatula"]),
    _attr("installation", "Installation needed", "select", options=_YES_NO,
          synonyms=["installation", "install", "ikakabit", "pagkakabit", "with installation"]),
    _attr("illuminated", "Illuminated", "select", options=_YES_NO, synonyms=["lighted", "may ilaw", "backlit", "with lights"]),
    _attr("garment", "Garment", "select", options=["T-shirt", "Polo shirt", "Hoodie", "Cap", "Tote bag"],
          synonyms=["apparel", "damit", "shirt type", "item type"]),
    _attr("print_method", "Print method", "select", options=["Silkscreen", "DTF", "Sublimation", "Embroidery", "Heat transfer vinyl"],
          synonyms=["printing method", "paraan ng pag-print", "print process", "technique"]),
    _attr("sizes_breakdown", "Sizes breakdown", synonyms=["size breakdown", "sizes", "ilang small medium large", "size run"]),
    _attr("print_locations", "Print locations", synonyms=["print placement", "saan ipi-print", "placement", "print area"]),
    _attr("label_format", "Format", "select", options=["Roll", "Sheet"], synonyms=["roll or sheet", "label format", "nakarolyo"]),
    _attr("box_wall", "Wall", "select", options=["Single wall (B-flute)", "Single wall (C-flute)", "Double wall"],
          synonyms=["flute", "wall type", "kapal ng karton", "ply"]),
    _attr("board", "Board", "select", options=["SBS / Ivory board", "Kraft board", "Duplex board"],
          synonyms=["board type", "paperboard", "uri ng board"]),
    _attr("printing", "Printing", "select", options=_PRINT_COLORS,
          synonyms=["print colors", "number of colors", "ilang kulay", "printed"]),
    _attr("window", "Window", "select", options=_YES_NO, synonyms=["window cutout", "may bintana", "clear window"]),
    _attr("zipper", "Zipper", "select", options=_YES_NO, synonyms=["zip", "ziplock", "resealable", "may zipper"]),
    _attr("fill_capacity", "Fill capacity", synonyms=["capacity", "laman", "kasya", "volume", "net weight"]),
    _attr("handle", "Handle", "select", options=["None", "Twisted paper", "Flat paper", "Rope / Ribbon"],
          synonyms=["hawakan", "handle type", "tali"]),
    _attr("thickness", "Thickness", "number", unit="microns", synonyms=["kapal", "gauge", "microns", "kapal ng plastik"]),
    _attr("closure", "Closure", "select", options=["None", "Zip lock", "Adhesive seal", "Drawstring"],
          synonyms=["seal", "sarahan", "closure type"]),
    _attr("attachment", "Attachment", "select", options=["Hole only", "With string", "With plastic fastener"],
          synonyms=["string", "tali", "fastener"]),
    _attr("container", "Container", synonyms=["bottle", "lalagyan", "container type", "bote"]),
]
ATTRIBUTES: dict[str, dict] = {a["id"]: a for a in _ATTRIBUTE_LIST}


def _use(attribute_id: str, *, required: Optional[bool] = None, **overrides) -> dict:
    """One layer's use of an attribute: the id plus whatever it overrides
    (required, label, unit, options, type). Unset fields fall through to the
    earlier layer, then to the dictionary."""
    assert attribute_id in ATTRIBUTES, attribute_id
    use = {"id": attribute_id, **overrides}
    if required is not None:
        use["required"] = required
    return use


GENERAL_SPECS: list[dict] = [
    _use("quantity", required=True),
    _use("unit", required=True),
    _use("preferred_brand"),
    _use("remarks"),
]

CATEGORY_TREE: list[dict] = [
    {
        "name": "Printing",
        "specs": [_use("artwork", required=True)],
        "items": [
            {"code": "business_cards", "name": "Business cards", "specs": [
                _use("size", required=True, type="select", options=["2 x 3.5 in (standard)", "2.5 x 2.5 in (square)", "Custom"]),
                _use("paper_type", required=True, options=["Matte", "Glossy", "Textured / Linen"]),
                _use("printed_sides", required=True),
                _use("lamination", required=True),
            ]},
            {"code": "flyers_brochures", "name": "Flyers / Brochures", "specs": [
                _use("size", required=True, type="select", options=["A4", "A5", "Letter", "Legal", "Custom"]),
                _use("fold", required=True),
                _use("paper_type", required=True, options=["Matte", "Glossy"]),
                _use("paper_weight", required=True, can_recommend=True),
                _use("printed_sides", required=True),
            ]},
            {"code": "tarpaulin", "name": "Tarpaulin", "specs": [
                _use("size", required=True, unit="ft"),
                _use("finish", required=True),
                _use("eyelets", required=True),
            ]},
            {"code": "stickers_decals", "name": "Stickers / Decals", "specs": [
                _use("size", required=True, unit="in"),
                _use("material", required=True, options=["Vinyl", "Paper", "Clear / Transparent"]),
                _use("cut", required=True),
                _use("lamination", required=True),
            ]},
            {"code": "posters", "name": "Posters", "specs": [
                _use("size", required=True, type="select", options=["A3", "A2", "A1", "18 x 24 in", "24 x 36 in", "Custom"]),
                _use("paper_type", required=True, options=["Matte", "Glossy", "Photo paper"]),
                _use("lamination", required=True),
            ]},
            {"code": "booklets_catalogs", "name": "Booklets / Catalogs", "specs": [
                _use("size", required=True, type="select", options=["A4", "A5", "Letter", "Custom"]),
                _use("page_count", required=True),
                _use("binding", required=True),
                _use("cover_paper", required=True, can_recommend=True),
                _use("inside_paper", required=True, can_recommend=True),
            ]},
            {"code": "invitations_certificates", "name": "Invitations / Certificates", "specs": [
                _use("size", required=True, type="select", options=["A4", "5 x 7 in", "4 x 6 in", "Custom"]),
                _use("paper_type", required=True, options=["Cardstock", "Specialty / Textured", "Glossy"]),
                _use("finishing", required=True),
                _use("envelope", required=True),
            ]},
            {"code": "signage", "name": "Signage", "specs": [
                _use("signage_type", required=True),
                _use("size", required=True, unit="ft"),
                _use("installation", required=True),
                _use("illuminated", required=True),
            ]},
            {"code": "shirt_apparel_printing", "name": "Shirt / Apparel printing", "specs": [
                _use("garment", required=True),
                _use("print_method", required=True),
                _use("sizes_breakdown", required=True),
                _use("print_locations", required=True),
                _use("color", required=True, label="Garment color"),
            ]},
        ],
    },
    {
        "name": "Packaging & Labeling",
        "specs": [_use("artwork", required=True), _use("food_grade", required=True)],
        "items": [
            {"code": "product_labels", "name": "Product labels", "specs": [
                _use("size", required=True, unit="in"),
                _use("material", required=True, options=["Paper", "Vinyl", "Clear / Transparent", "Waterproof synthetic"]),
                _use("label_format", required=True),
                _use("finish", required=True, options=["None", "Matte", "Glossy"]),
            ]},
            {"code": "corrugated_boxes", "name": "Corrugated boxes", "specs": [
                _use("size", required=True, label="Inside dimensions (L x W x H)", unit="cm"),
                _use("box_wall", required=True),
                _use("printing", required=True),
            ]},
            {"code": "folding_cartons", "name": "Folding cartons / Paper boxes", "specs": [
                _use("size", required=True, label="Dimensions (L x W x H)", unit="cm"),
                _use("board", required=True),
                _use("printing", required=True),
                _use("finish", required=True, options=["None", "Matte lamination", "Glossy lamination", "Spot UV"]),
                _use("window", required=True),
            ]},
            {"code": "stand_up_pouches", "name": "Stand-up pouches", "specs": [
                _use("size", required=True, label="Size (W x H)", unit="cm"),
                _use("material", required=True, options=["Kraft paper", "Clear PET/PE", "Metallized foil", "Matte PET"]),
                _use("zipper", required=True),
                _use("fill_capacity", required=True, can_recommend=True),
            ]},
            {"code": "paper_bags", "name": "Paper bags", "specs": [
                _use("size", required=True, label="Size (W x H x gusset)", unit="in"),
                _use("paper_type", required=True, options=["Kraft brown", "Kraft white", "Art paper / Laminated"]),
                _use("handle", required=True),
                _use("printing", required=True),
            ]},
            {"code": "plastic_poly_bags", "name": "Plastic / Poly bags", "specs": [
                _use("size", required=True, label="Size (W x H)", unit="in"),
                _use("material", required=True, options=["LDPE", "HDPE", "PP", "Biodegradable"]),
                _use("thickness", required=True, can_recommend=True),
                _use("closure", required=True),
                _use("printing", required=True),
            ]},
            {"code": "hang_tags", "name": "Hang tags", "specs": [
                _use("size", required=True, unit="in"),
                _use("paper_type", required=True, options=["Cardstock", "Kraft", "Textured"]),
                _use("printed_sides", required=True),
                _use("attachment", required=True),
            ]},
            {"code": "shrink_sleeves", "name": "Shrink sleeves", "specs": [
                _use("container", required=True),
                _use("size", required=True, label="Sleeve size (W x H)", unit="mm"),
                _use("material", required=True, options=["PVC", "PETG", "OPS"]),
                _use("printing", required=True),
            ]},
        ],
    },
]

# Every category accepts "Other": no item layer, so it asks the general and
# category specs only, plus whatever custom rows the buyer adds.
for _category in CATEGORY_TREE:
    _category["items"].append({"code": OTHER_ITEM_CODE, "name": OTHER_ITEM_NAME, "specs": []})

CATEGORIES: list[str] = [c["name"] for c in CATEGORY_TREE]


def _find_category(category: str) -> Optional[dict]:
    return next((c for c in CATEGORY_TREE if c["name"] == category), None)


def items_for(category: str) -> list[dict]:
    """The category's items, "Other" last. Empty for an unknown category."""
    c = _find_category(category)
    return c["items"] if c else []


def find_item(category: str, item_code: str) -> Optional[dict]:
    return next((i for i in items_for(category) if i["code"] == item_code), None)


def item_name(category: str, item_code: Optional[str]) -> Optional[str]:
    item = find_item(category, item_code) if item_code else None
    return item["name"] if item else None


def get_item_specs(category: str, item_code: str) -> list[dict]:
    """The item's full spec list, merged by attribute id: General → Category
    → Item, a later layer overriding an earlier one's fields. Listed in the
    order a buyer answers them — the item's own specs first, then the
    category's, then the general ones (quantity, unit, brand, remarks); a spec
    keeps the position of the first layer in that order that names it. Empty
    for an unknown item."""
    c = _find_category(category)
    item = find_item(category, item_code) if c else None
    if not item:
        return []
    merged: dict[str, dict] = {}
    for layer in (GENERAL_SPECS, c["specs"], item["specs"]):
        for use in layer:
            merged.setdefault(use["id"], {}).update(use)
    order: list[str] = []
    for layer in (item["specs"], c["specs"], GENERAL_SPECS):
        order += [use["id"] for use in layer if use["id"] not in order]
    out = []
    for attribute_id in order:
        use = merged[attribute_id]
        attr = ATTRIBUTES[attribute_id]
        out.append({
            "id": attribute_id,
            "label": use.get("label", attr["label"]),
            "type": use.get("type", attr["type"]),
            "unit": use.get("unit", attr["unit"]),
            "options": use.get("options", attr["options"]),
            "required": use.get("required", False),
            # Offers "Not sure — supplier to recommend" (SUPPLIER_TO_RECOMMEND).
            "can_recommend": use.get("can_recommend", False),
            "draft": attr["draft"],
        })
    return out


def category_tree_out() -> list[dict]:
    """GET /meta/categories: every category with its items' merged specs."""
    return [
        {"name": c["name"], "items": [
            {"code": i["code"], "name": i["name"], "specs": get_item_specs(c["name"], i["code"])}
            for i in c["items"]
        ]}
        for c in CATEGORY_TREE
    ]


def spec_label(spec: dict) -> str:
    """The label a spec is stored under — the unit folded in."""
    return f"{spec['label']} ({spec['unit']})" if spec.get("unit") else spec["label"]


_NUMBER = re.compile(r"^\d+(\.\d+)?$")


def is_number(value: str) -> bool:
    """Plain non-negative decimal, commas allowed ("1,000", "2.5"). Same rule
    as isNumber() in frontend/lib/data/categories.ts."""
    return bool(_NUMBER.match(value.replace(",", "").strip()))


_QUANTITY = re.compile(r"^\s*([\d,]+(?:\.\d+)?)\s*(.*)$")


def split_quantity(quantity: str) -> tuple[str, str]:
    """"500 pcs" → ("500", "pcs"). The number part is "" when the text doesn't
    start with one (free-text quantities from before the general layer)."""
    m = _QUANTITY.match(quantity or "")
    return (m.group(1), m.group(2).strip()) if m else ("", (quantity or "").strip())


def validate_item_specs(category: str, item_code: str, specs: list[dict], quantity: str = "") -> None:
    """Raises ValueError if item_code isn't one of the category's items, or if
    the item's merged specs aren't satisfied by specs ({attribute_id?, label,
    value} rows) plus quantity ("<number> <unit>"). Rows matched by
    attribute_id, else by stored label; rows matching neither are the buyer's
    own custom rows and pass as-is. Messages match the frontend's
    (itemSpecError in frontend/lib/data/categories.ts)."""
    item = find_item(category, item_code)
    if not item:
        raise ValueError(f"Pick an item from {category}.")
    by_id = {s["attribute_id"]: s["value"].strip() for s in specs if s.get("attribute_id")}
    by_label = {s["label"].strip(): s["value"].strip() for s in specs}
    qty_number, qty_unit = split_quantity(quantity)
    for spec in get_item_specs(category, item_code):
        label = spec_label(spec)
        if spec["id"] == "quantity":
            value = (quantity or "").strip() and (qty_number or quantity.strip())
        elif spec["id"] == "unit":
            value = qty_unit
        else:
            value = by_id.get(spec["id"]) or by_label.get(label, "")
        if not value:
            if spec["required"]:
                raise ValueError(f"Add a value for {label} — it's required for {item['name']}.")
            continue
        if value == SUPPLIER_TO_RECOMMEND and spec["can_recommend"]:
            continue
        if spec["type"] == "select" and value not in spec["options"]:
            raise ValueError(f"{label} must be one of: {', '.join(spec['options'])}.")
        if spec["type"] == "number" and not is_number(value):
            raise ValueError(f"{label} must be a number.")
        # A quantity is a count (pcs, sets, boxes, ...): a whole number above 0,
        # at most 7 digits. Thousands commas are fine ("1,000").
        if spec["id"] == "quantity":
            digits = value.replace(",", "").strip()
            if not digits.isascii() or not digits.isdigit() or int(digits) <= 0 or len(digits) > 7:
                raise ValueError(f"{label} must be a whole number above 0.")
