"""Semantic matching (Specific Objective #4): a business's declared
capabilities and service areas are embedded into a vector space, and open
requirements are ranked against that embedding using Qdrant — not a plain
category/keyword filter, which the study's own preliminary survey found
matches poorly ("those that do describe themselves use inconsistent
terms"). Feed ordering is by match and closing time only, never popularity
or recency (see requirement_service.list_open).

Two local, no-external-API pieces, chosen so this never depends on an AI
provider's quota (see document_extraction_service's docstring for the
Gemini free-tier limit that motivated avoiding that dependency here):

- fastembed (ONNX Runtime, no PyTorch) with BAAI/bge-small-en-v1.5 — a
  small (~130MB) general-purpose embedding model that turns text into a
  384-dim vector.
- qdrant-client in local/embedded mode (on-disk at QDRANT_PATH, no separate
  server process) — the actual vector database that indexes every open
  requirement's embedding and ranks a viewer's embedding against it.

Each embedding is also stored JSON-encoded in its own row (User.
capability_embedding, Requirement.embedding) as the durable copy — Qdrant's
on-disk store is a derived index built from that, rebuildable if it's ever
cleared, not the source of truth.

Both pieces are lazy, module-level singletons: the first call in the
process pays the load cost (a few seconds), every call after that reuses
them.
"""
import json
import logging
import os

logger = logging.getLogger("trustlink.matching")

EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
EMBEDDING_SIZE = 384
QDRANT_PATH = os.path.join("qdrant_data", "requirements")
QDRANT_COLLECTION = "requirements"

_model = None
_qdrant = None
# Set once _get_qdrant() has failed — e.g. another process already holds the
# local store's lock (Qdrant's own lock is non-blocking and fails fast with
# a clear RuntimeError, never hangs). Without this, every single request
# would retry — and re-fail — the same doomed client creation. Cleared only
# by a process restart, same as _model/_qdrant themselves.
_qdrant_unavailable = False


def _get_model():
    global _model
    if _model is None:
        from fastembed import TextEmbedding
        _model = TextEmbedding(model_name=EMBEDDING_MODEL)
    return _model


def _get_qdrant():
    global _qdrant, _qdrant_unavailable
    if _qdrant_unavailable:
        raise RuntimeError("Qdrant previously failed to initialize in this process")
    if _qdrant is None:
        try:
            from qdrant_client import QdrantClient
            from qdrant_client.models import Distance, VectorParams
            client = QdrantClient(path=QDRANT_PATH)
            if not client.collection_exists(QDRANT_COLLECTION):
                client.create_collection(
                    collection_name=QDRANT_COLLECTION,
                    vectors_config=VectorParams(size=EMBEDDING_SIZE, distance=Distance.COSINE),
                )
            _qdrant = client
        except Exception:
            _qdrant_unavailable = True
            raise
    return _qdrant


def embed(text: str) -> list[float]:
    text = (text or "").strip()
    if not text:
        return []
    try:
        vector = next(iter(_get_model().embed([text])))
        return vector.tolist()
    except Exception:
        logger.exception("Embedding failed")
        return []


def embed_to_json(text: str) -> str:
    """Embeds text and returns it JSON-encoded, ready to store in a TEXT
    column — empty string (not an error) for blank input or a model
    failure, same silent-fallback contract as the platform's other assistive
    AI features: matching just falls back to closing-time-only ordering."""
    vector = embed(text)
    return json.dumps(vector) if vector else ""


def upsert_requirement_vector(requirement_id: int, vector_json: str) -> None:
    """Indexes one requirement's embedding into the vector database — call
    this once, right after the requirement (and its MySQL-stored embedding)
    is created. A failure here never blocks posting the requirement: it
    just won't be boosted by semantic match until re-indexed, same as an
    empty embedding does today."""
    if not vector_json:
        return
    try:
        from qdrant_client.models import PointStruct
        vector = json.loads(vector_json)
        _get_qdrant().upsert(QDRANT_COLLECTION, points=[PointStruct(id=requirement_id, vector=vector)])
    except Exception:
        logger.exception("Qdrant upsert failed for requirement %s", requirement_id)


def rank_requirement_ids(viewer_vector_json: str, candidate_ids: list[int]) -> dict[int, float]:
    """Scores exactly `candidate_ids` (the open requirements MySQL already
    returned — Qdrant is never asked to decide what's open, only to rank)
    against the viewer's embedding. Returns {requirement_id: similarity},
    missing an id if it was never indexed (e.g. posted before this feature,
    or indexing failed) — callers should treat a missing id as "no boost"."""
    if not viewer_vector_json or not candidate_ids:
        return {}
    try:
        from qdrant_client.models import Filter, HasIdCondition
        viewer_vector = json.loads(viewer_vector_json)
        results = _get_qdrant().query_points(
            collection_name=QDRANT_COLLECTION,
            query=viewer_vector,
            query_filter=Filter(must=[HasIdCondition(has_id=candidate_ids)]),
            limit=len(candidate_ids),
            with_payload=False,
        )
        return {point.id: point.score for point in results.points}
    except Exception:
        logger.exception("Qdrant ranking query failed")
        return {}


def business_matching_text(category: str, capabilities: list[str], service_areas: list[str]) -> str:
    parts = [category or ""]
    if capabilities:
        parts.append("Capabilities: " + ", ".join(capabilities) + ".")
    if service_areas:
        parts.append("Service areas: " + ", ".join(service_areas) + ".")
    return " ".join(p for p in parts if p).strip()


def requirement_matching_text(category: str, title: str, scope: str) -> str:
    return " ".join(p for p in [category or "", title or "", scope or ""] if p).strip()
