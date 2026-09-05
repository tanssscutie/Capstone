import hashlib
import json

# The hash of "nothing came before this" — the chain's starting point.
GENESIS_HASH = "0" * 64


def canonicalize(payload: dict) -> str:
    """Deterministic JSON encoding so the same payload always hashes the
    same way, regardless of dict insertion order or datetime formatting."""
    return json.dumps(payload, sort_keys=True, default=str)


def compute_hash(prev_hash: str, payload: dict) -> str:
    material = (prev_hash or GENESIS_HASH) + canonicalize(payload)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()