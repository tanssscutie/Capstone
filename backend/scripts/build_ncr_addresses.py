"""Builds backend/app/data/ncr_addresses.json: NCR cities -> barangays (PSGC,
official) + the city's ZIP codes, with a barangay's ZIP filled in ONLY when
the source data gives exactly one ZIP for it. Never guesses.

Usage: python -I build_ncr_address.py <psgc_data_dir> <grit_sql> <out_json>
"""
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict

psgc_dir, sql_path, out_path = sys.argv[1:4]

APP_CITIES = ['Caloocan', 'Las Piñas', 'Makati', 'Malabon', 'Mandaluyong', 'Manila', 'Marikina',
              'Muntinlupa', 'Navotas', 'Parañaque', 'Pasay', 'Pasig', 'Pateros', 'Quezon City',
              'San Juan', 'Taguig', 'Valenzuela']


def fold(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()


def norm(s):
    s = fold(s)
    s = re.sub(r"\(.*?\)", " ", s)
    s = s.replace("sto.", "santo ").replace("sta.", "santa ")
    s = re.sub(r"\b(barangay|brgy|bgy|pob|poblacion|village|vill|subd|subdivision|city|of)\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


CITY_BY_FOLD = {norm(c): c for c in APP_CITIES}
CITY_BY_FOLD.update({"markina": "Marikina", "quezon": "Quezon City", "las pi as": "Las Piñas",
                     "para aque": "Parañaque", "pinas las": "Las Piñas"})


def app_city_from_text(name):
    n = norm(name.replace("(North)", "").replace("(South)", ""))
    if n in CITY_BY_FOLD:
        return CITY_BY_FOLD[n]
    for key, city in CITY_BY_FOLD.items():
        if key and (n.startswith(key) or key.startswith(n)):
            return city
    return None


# ---- ZIP rows (Grit-derived, MIT): (id, region, province, city, area, zip, ...)
raw = open(sql_path, "rb").read().decode("utf-8", errors="replace")
ROW = re.compile(r"\((\d+), '((?:[^'\\]|\\.)*)', (?:NULL|'(?:[^'\\]|\\.)*'), '((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)', '(\d{4})'")
zips_by_city = defaultdict(dict)          # city -> zip -> area label
zip_sets = defaultdict(lambda: defaultdict(set))  # city -> norm(area) -> {zip}
skipped = Counter()
for m in ROW.finditer(raw):
    _, region, city_txt, area, zipc = m.groups()
    if region != "NCR":
        continue
    if "Post Office Boxes" in city_txt or "P.O. Box" in area:
        skipped["po boxes"] += 1
        continue
    city = app_city_from_text(city_txt.replace("\\'", "'"))
    if not city:
        skipped[city_txt] += 1
        continue
    area = area.replace("\\'", "'").strip()
    zips_by_city[city].setdefault(zipc, area)
    zip_sets[city][norm(area)].add(zipc)
print("skipped:", dict(skipped))

# ---- PSGC barangays (PSA Q1 2026)
cities = json.load(open(f"{psgc_dir}/cities.json", encoding="utf-8"))
brgys = json.load(open(f"{psgc_dir}/barangays.json", encoding="utf-8"))
ncr = {c["psgc_code"]: c for c in cities if c["region_code"] == "1300000000"}


def app_city(c):
    return "Manila" if c["geographic_level"] == "SubMun" else app_city_from_text(c["name"])


def unique_zip(city, name):
    found = zip_sets[city].get(norm(name))
    return next(iter(found)) if found and len(found) == 1 else None


out = {c: {"zips": [], "barangays": []} for c in APP_CITIES}
stats = Counter()
for b in sorted(brgys, key=lambda b: b["psgc_code"]):
    c = ncr.get(b["city_code"])
    if not c:
        continue
    city = app_city(c)
    district = c["name"] if c["geographic_level"] == "SubMun" else None
    zipc = unique_zip(city, b["name"])
    # No district fallback for Manila: a PSGC district can span several ZIP
    # areas (Santa Ana includes San Andres Bukid, 1017 vs 1009).
    if not zipc and len(zips_by_city[city]) == 1:
        zipc = next(iter(zips_by_city[city]))  # the city has a single ZIP
    stats[(city, bool(zipc))] += 1
    entry = {"name": b["name"], "psgc": b["psgc_code"]}
    if district:
        entry["district"] = district
    if zipc:
        entry["zip"] = zipc
    out[city]["barangays"].append(entry)

for city in APP_CITIES:
    out[city]["zips"] = [{"zip": z, "area": a} for z, a in sorted(zips_by_city[city].items())]
    ok = stats[(city, True)]
    total = len(out[city]["barangays"])
    print(f"{city:<12} zips={len(out[city]['zips']):>3}  barangays auto-ZIP {ok:>4}/{total}")

doc = {
    "_sources": {
        "barangays": "PSA Philippine Standard Geographic Code (PSGC) Q1 2026, via the MIT-licensed psgc package 2026.4.13.0 (github.com/fish-and-bear/psgc)",
        "zip_codes": "github.com/simonpangan/Philippines-Zip-Codes (MIT; data from grit.ph, extracted 2024-01-04) — NOT PHLPost. Replace with PHLPost's official list when available.",
        "rule": "A barangay's zip is set only when the source gives exactly one ZIP for that exact barangay name (or for its whole city). Otherwise absent: the form offers the city's ZIP list instead.",
    },
    "cities": out,
}
json.dump(doc, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("TOTAL auto-ZIP", sum(v for (c, k), v in stats.items() if k), "/", sum(stats.values()))
