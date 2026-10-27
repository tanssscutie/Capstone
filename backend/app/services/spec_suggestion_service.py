"""Phase 4 — custom spec generalization. When a buyer types their own spec
row label, this suggests the dictionary attribute it probably means
("kapal ng papel" → Paper weight), so the post-requirement form can ask
"Ito ba ay Paper weight?". Advisory only: nothing is changed unless the buyer
accepts, and a missing or failed suggestion never blocks publishing.

Two steps, cheapest first:
1. Exact match — the label, lowercased with punctuation and a trailing
   "(unit)" stripped, equals an attribute's label or one of its synonyms
   (ATTRIBUTES in app/core/categories.py, Filipino/Taglish included). Score 1.0.
2. Semantic match — the label is embedded with the same local fastembed
   model the feed uses (matching_service, BAAI/bge-small-en-v1.5) and compared
   by cosine similarity against every attribute label + synonym. The best
   phrase wins if it clears SUGGESTION_THRESHOLD.

SUGGESTION_THRESHOLD = 0.82. Calibrated 2026-10-21 with the real model on 28
hand-labelled row labels: the 16 real paraphrases scored 0.84–1.00 ("paper
finish" 0.84, "box flute" 0.85, "paper thickness gsm" 0.93); the 12 unrelated
labels scored 0.63–0.81 ("payment terms" 0.63, "rounded corners" 0.77, and
"ink type" → Paper at 0.813 — the reason the cutoff isn't 0.80). Re-run the
calibration if the dictionary's synonyms change much. The model is
English-only, which is why Taglish phrasings are covered by synonyms (step 1)
rather than left to the embedding.
"""
import math
import re
from typing import Optional

from app.core.categories import ATTRIBUTES, QUANTITY_ATTRIBUTE_IDS, get_item_specs
from app.services import matching_service

SUGGESTION_THRESHOLD = 0.82

# Quantity and unit are the requirement's own Quantity field, never a spec row.
_CANDIDATES = [a for a in ATTRIBUTES.values() if a["id"] not in QUANTITY_ATTRIBUTE_IDS]

# (attribute id, phrase, vector) for every label + synonym — built on first use.
_phrase_vectors: Optional[list[tuple[str, list[float]]]] = None


def _norm(label: str) -> str:
    text = re.sub(r"\([^)]*\)\s*$", "", label.lower())
    text = re.sub(r"[^\w\s/-]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _exact_index() -> dict[str, str]:
    index = {}
    for attr in _CANDIDATES:
        for phrase in [attr["label"], *attr["synonyms"]]:
            index.setdefault(_norm(phrase), attr["id"])
    return index


_EXACT = _exact_index()


def _vectors() -> list[tuple[str, list[float]]]:
    global _phrase_vectors
    if _phrase_vectors is None:
        pairs = [(a["id"], p) for a in _CANDIDATES for p in [a["label"], *a["synonyms"]]]
        vectors = matching_service.embed_many([p for _, p in pairs])
        if len(vectors) != len(pairs):
            return []  # model unavailable — don't cache, try again next time
        _phrase_vectors = [(attr_id, v) for (attr_id, _), v in zip(pairs, vectors)]
    return _phrase_vectors


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0


def best_match(label: str) -> tuple[Optional[str], float]:
    """(attribute id, score) for the closest attribute, before the threshold."""
    key = _norm(label)
    if not key:
        return None, 0.0
    if key in _EXACT:
        return _EXACT[key], 1.0
    phrases = _vectors()
    query = matching_service.embed(key)
    if not phrases or not query:
        return None, 0.0
    attr_id, score = max(((a, _cosine(query, v)) for a, v in phrases), key=lambda t: t[1])
    return attr_id, score


def suggest(label: str, category: Optional[str] = None, item_code: Optional[str] = None) -> Optional[dict]:
    """{attribute_id, label, unit, score} or None. label/unit are the item's
    own wording when the item uses that attribute ("Garment color")."""
    attr_id, score = best_match(label)
    if not attr_id or score < SUGGESTION_THRESHOLD:
        return None
    spec = next((s for s in get_item_specs(category, item_code) if s["id"] == attr_id), None) if category and item_code else None
    attr = ATTRIBUTES[attr_id]
    return {
        "attribute_id": attr_id,
        "label": spec["label"] if spec else attr["label"],
        "unit": spec["unit"] if spec else attr["unit"],
        "score": round(score, 3),
    }
