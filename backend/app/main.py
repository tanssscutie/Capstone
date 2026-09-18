import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import logging

from app.core.database import create_db_and_tables
from app.api.api import api_router
from app.services.release_scheduler import start_scheduler, stop_scheduler
from app.services import matching_service

logger = logging.getLogger("trustlink.startup")

app = FastAPI(title="TrustLink Backend")

_origins_env = os.getenv("CORS_ORIGINS", "")
if _origins_env:
    origins = [o.strip() for o in _origins_env.split(",") if o.strip()]
else:
    origins = [
        "http://127.0.0.1:5500",   # Live Server
        "http://localhost:5500",
        "http://127.0.0.1:3000",   # python http.server
        "http://localhost:3000",
        "http://127.0.0.1:8081",   # Expo dev server (web)
        "http://localhost:8081",
        "http://127.0.0.1:19006",  # Expo Go / dev menu
        "http://localhost:19006",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    create_db_and_tables()
    # This is what makes release "triggered by the system clock rather
    # than by any person" — nothing in the API can flip a requirement from
    # open to closed; only this background job can, once closes_at passes.
    start_scheduler(interval_seconds=15)

    # Pay the embedding model's one-time load cost (a few seconds — longer
    # on the very first run ever, which also downloads it) here at boot,
    # not on whichever request happens to hit semantic matching first. A
    # failure here is never fatal — matching_service's own functions all
    # degrade to "no semantic boost" on their own, same contract as every
    # other AI feature in this codebase — this is purely so a real user's
    # first Home feed load isn't the one paying that cost.
    try:
        matching_service._get_model()
        matching_service._get_qdrant()
        logger.info("Semantic matching model + vector store preloaded.")
    except Exception:
        logger.exception("Semantic matching preload failed — matching will fall back to closing-time-only ordering.")


@app.on_event("shutdown")
def on_shutdown():
    stop_scheduler()


@app.get("/")
def root():
    return {"message": "Hello, TrustLink!"}


app.include_router(api_router)