"""Does the name on an ID belong to the person named on the account?
Tolerant of how Philippine names are written: case, accents and ñ, commas
("DELA CRUZ, JUAN P."), middle names or initials left out, and suffixes
(Jr., III). Strict on the rest: every full word of the shorter name must
appear in the longer one."""
import re
import unicodedata

SUFFIXES = {"JR", "SR", "II", "III", "IV", "V"}


def _tokens(name: str) -> list[str]:
    text = unicodedata.normalize("NFKD", name or "")
    text = "".join(c for c in text if not unicodedata.combining(c)).upper()
    text = re.sub(r"[^A-Z\s]", " ", text)
    return [t for t in text.split() if t not in SUFFIXES]


def compare(id_name: str, person_name: str) -> str:
    """match | partial | mismatch | unchecked (a name missing)."""
    a = [t for t in _tokens(id_name) if len(t) > 1]
    b = [t for t in _tokens(person_name) if len(t) > 1]
    if not a or not b:
        return "unchecked"
    # "DELA CRUZ" vs "DELACRUZ": also compare with spaces removed.
    if "".join(a) == "".join(b):
        return "match"
    sa, sb = set(a), set(b)
    shorter, longer = (sa, sb) if len(sa) <= len(sb) else (sb, sa)
    common = sa & sb
    if len(common) >= 2 and shorter <= longer:
        return "match"
    if common:
        return "partial"
    return "mismatch"
