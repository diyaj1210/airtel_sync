"""FastAPI application. Only the backend calls this service."""
from __future__ import annotations

from fastapi import FastAPI

from . import SERVICE_NAME, SERVICE_VERSION


def create_app() -> FastAPI:
    app = FastAPI(
        title="Udyam Digital AI service",
        version=SERVICE_VERSION,
        description="Advisor language, document OCR and propensity scoring (added step by step).",
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": SERVICE_NAME, "version": SERVICE_VERSION}

    return app


app = create_app()
