"""Advisor endpoints. Only the backend calls them; it validates every value again.

GET  /advisor/status       is an LLM configured? (provider + model, never the key)
POST /advisor/understand   one owner message -> facts, intent, short acknowledgement
POST /advisor/explain      facts from the rules engine -> plain-language explanation

Errors (the backend then answers by its rules):
  503 {"error": "llm_disabled"}                       no GEMINI_API_KEY, or the key was rejected
  503 {"error": "llm_quota", "retryAfterSeconds": n}  free-plan / rate limit reached
  504 {"error": "llm_timeout"}
  502 {"error": "llm_upstream"} / {"error": "llm_bad_output"}
"""
from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .llm import LlmClient, LlmError
from .prompts import build_explain, build_understand

MAX_FACTS_CHARS = 20_000

Lang = Literal["en", "hi"]
Slot = Literal["businessKind", "employees", "sites", "city", "gstin", "internet", "tools"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Turn(_Strict):
    role: Literal["owner", "advisor"]
    text: str = Field(max_length=500)


class ProductBrief(_Strict):
    id: str = Field(pattern=r"^P\d{2}$")
    name: str = Field(max_length=80)
    description: str = Field(max_length=200)


class UnderstandRequest(_Strict):
    lang: Lang
    expecting: Slot | None = None
    known: dict[str, Any] = Field(default_factory=dict)
    cities: list[str] = Field(default_factory=list, max_length=60)
    products: list[ProductBrief] = Field(default_factory=list, max_length=40)
    recentTurns: list[Turn] = Field(default_factory=list, max_length=10)
    message: str = Field(min_length=1, max_length=500)

    @field_validator("cities")
    @classmethod
    def _short_names(cls, v: list[str]) -> list[str]:
        if any(len(c) > 40 for c in v):
            raise ValueError("city names must be at most 40 characters")
        return v


class ExplainRequest(_Strict):
    lang: Lang
    task: Literal["recommendation", "answer"]
    question: str | None = Field(default=None, max_length=500)
    facts: dict[str, Any]

    @field_validator("facts")
    @classmethod
    def _small(cls, v: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(v, ensure_ascii=False)) > MAX_FACTS_CHARS:
            raise ValueError(f"facts must be at most {MAX_FACTS_CHARS} characters of JSON")
        return v


class UnderstandOut(BaseModel):
    """Shape check of the model's JSON (values are validated again by the backend)."""

    businessKind: str | None = None
    businessType: str | None = Field(default=None, max_length=80)
    employees: int | None = None
    sites: int | None = None
    city: str | None = Field(default=None, max_length=80)
    gstin: str | None = None
    internet: str | None = None
    tools: list[str] | None = None
    intent: str
    productIds: list[str] = Field(default_factory=list, max_length=10)
    ack: str | None = Field(default=None, max_length=600)


class RecommendationLine(BaseModel):
    productId: str = Field(max_length=10)
    why: str = Field(max_length=400)


class RecommendationOut(BaseModel):
    summary: str = Field(min_length=1, max_length=1500)
    lines: list[RecommendationLine] = Field(default_factory=list, max_length=20)


class AnswerOut(BaseModel):
    answer: str = Field(min_length=1, max_length=1500)


def _error(e: LlmError) -> JSONResponse:
    if e.kind == "disabled":
        return JSONResponse(status_code=503, content={"error": "llm_disabled"})
    if e.kind == "quota":
        body: dict[str, Any] = {"error": "llm_quota"}
        if e.retry_after_s is not None:
            body["retryAfterSeconds"] = round(e.retry_after_s)
        return JSONResponse(status_code=503, content=body)
    if e.kind == "timeout":
        return JSONResponse(status_code=504, content={"error": "llm_timeout"})
    if e.kind == "bad_output":
        return JSONResponse(status_code=502, content={"error": "llm_bad_output"})
    return JSONResponse(status_code=502, content={"error": "llm_upstream"})


def _llm(request: Request) -> LlmClient:
    llm = request.app.state.llm
    if llm is None:
        raise LlmError("disabled")
    return llm


def advisor_router() -> APIRouter:
    router = APIRouter(prefix="/advisor")

    @router.get("/status")
    def status(request: Request) -> dict[str, Any]:
        llm = request.app.state.llm
        if llm is None:
            return {"enabled": False, "reason": "GEMINI_API_KEY is not set"}
        return {"enabled": True, "provider": llm.provider, "model": llm.model}

    @router.post("/understand", response_model=None)
    def understand(req: UnderstandRequest, request: Request) -> dict[str, Any] | JSONResponse:
        try:
            system, prompt, schema = build_understand(req)
            raw = _llm(request).generate_json(
                task="understand", system=system, prompt=prompt, schema=schema, max_output_tokens=600, temperature=0
            )
            try:
                out = UnderstandOut.model_validate(raw)
            except ValidationError:
                raise LlmError("bad_output", detail="answer does not match the schema") from None
            return out.model_dump()
        except LlmError as e:
            return _error(e)

    @router.post("/explain", response_model=None)
    def explain(req: ExplainRequest, request: Request) -> dict[str, Any] | JSONResponse:
        try:
            system, prompt, schema = build_explain(req)
            raw = _llm(request).generate_json(
                task=f"explain:{req.task}", system=system, prompt=prompt, schema=schema,
                max_output_tokens=900, temperature=0.3,
            )
            try:
                if req.task == "recommendation":
                    rec = RecommendationOut.model_validate(raw)
                    return {"text": rec.summary, "lines": [line.model_dump() for line in rec.lines]}
                ans = AnswerOut.model_validate(raw)
                return {"text": ans.answer, "lines": []}
            except ValidationError:
                raise LlmError("bad_output", detail="answer does not match the schema") from None
        except LlmError as e:
            return _error(e)

    return router

