"""FastAPI application. Only the backend calls this service."""
from __future__ import annotations

from fastapi import FastAPI

from . import SERVICE_NAME, SERVICE_VERSION
from .advisor.llm import GeminiClient, LlmClient
from .advisor.routes import advisor_router
from .config import Config, load_config

_FROM_CONFIG = object()


def llm_from_config(config: Config) -> LlmClient | None:
    """Gemini when GEMINI_API_KEY is set; otherwise None (the backend's advisor answers by its rules)."""
    if not config.llm_enabled:
        return None
    return GeminiClient(config.gemini_api_key or "", config.gemini_model, config.gemini_timeout_s)


def create_app(config: Config | None = None, llm: LlmClient | None | object = _FROM_CONFIG) -> FastAPI:
    app = FastAPI(
        title="Udyam Digital AI service",
        version=SERVICE_VERSION,
        description="Advisor language (Gemini), document OCR and propensity scoring (added step by step).",
    )
    if llm is _FROM_CONFIG:
        llm = llm_from_config(config or load_config())
    app.state.llm = llm

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": SERVICE_NAME, "version": SERVICE_VERSION}

    app.include_router(advisor_router())
    return app


app = create_app()
