# Spec values with units, normalized to one standard unit per kind so values
# typed differently ("3 x 6 ft", "36 x 72 in", "0.9 x 1.8 m") compare as the same
# thing. The buyer's original text is always what's displayed — the normalized
# copy is stored beside it (SpecRow.normalized_value / normalized_unit).
#
# Standard units: length → cm, paper weight → gsm, film thickness → microns.
import re
from typing import Optional

# unit as typed → (standard unit, factor to multiply by)
_UNITS: dict[str, tuple[str, float]] = {
    "mm": ("cm", 0.1),
    "cm": ("cm", 1.0),
    "m": ("cm", 100.0), "meter": ("cm", 100.0), "meters": ("cm", 100.0), "metro": ("cm", 100.0),
    "in": ("cm", 2.54), "inch": ("cm", 2.54), "inches": ("cm", 2.54), '"': ("cm", 2.54),
    "ft": ("cm", 30.48), "feet": ("cm", 30.48), "foot": ("cm", 30.48), "'": ("cm", 30.48),
    "gsm": ("gsm", 1.0), "g/m2": ("gsm", 1.0), "g/m²": ("gsm", 1.0),
    "microns": ("microns", 1.0), "micron": ("microns", 1.0), "mic": ("microns", 1.0), "µm": ("microns", 1.0),
    "mil": ("microns", 25.4), "mils": ("microns", 25.4),
}

_PART = re.compile(r"^(\d+(?:\.\d+)?)\s*([a-zµ²/\"']*)$")


def _fmt(n: float) -> str:
    return f"{n:.2f}".rstrip("0").rstrip(".")


def normalize(value: str, default_unit: Optional[str] = None) -> Optional[tuple[str, str]]:
    """("3 x 6", "ft") → ("91.44 x 182.88", "cm"); ("120gsm", None) → ("120", "gsm").
    A unit written on the last number applies to the ones before it
    ("3 x 6 ft"); otherwise default_unit (the spec's own unit) applies.
    None when the value isn't plain numbers with a known unit — free text
    ("Custom", "A4") is simply left as typed."""
    text = value.lower().replace(",", "").replace("×", "x").replace(" by ", " x ").strip()
    if not text:
        return None
    parts = []
    for raw in text.split("x"):
        m = _PART.match(raw.strip())
        if not m:
            return None
        parts.append((float(m.group(1)), m.group(2) or None))
    trailing = parts[-1][1]
    standard = None
    out = []
    for number, unit in parts:
        unit = unit or trailing or (default_unit.lower() if default_unit else None)
        if unit not in _UNITS:
            return None
        std, factor = _UNITS[unit]
        if standard and std != standard:
            return None
        standard = std
        out.append(_fmt(number * factor))
    return " x ".join(out), standard
