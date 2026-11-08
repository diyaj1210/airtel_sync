"""Propensity endpoints. Only the backend calls them.

GET  /propensity/model   model card: inputs, excluded leakage columns, test AUC and other metrics, bands
GET  /propensity/leads/{leadId}   score of a lead in data/raw/smb_leads.csv (its arrival details only)
POST /propensity/score   {"leads": [{"id"?: str, "lead": {feature: value, ...}}, ...]} (1-500 leads)
  -> 200 {"scores": [{"id", "probability", "score", "band", "reasons": [{"feature", "value", "effect", "weight"}]}]}
     422 {"error": "invalid_lead", "index": i, "problems": [{"field", "problem"}]}
     503 {"error": "model_unavailable"}   models/propensity.json missing (run python -m app.propensity.train)

A missing input counts as average: it moves the score neither way. Lead details are never logged.
"""
from __future__ import annotations

import logging
import re
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .features import load_leads
from .model import InputError, PropensityModel, Score

log = logging.getLogger("app.propensity")


class LeadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str | None = Field(default=None, max_length=40)
    lead: dict[str, Any]


class ScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    leads: list[LeadIn] = Field(min_length=1, max_length=500)


LEAD_ID_RE = re.compile(r"^L\d{5}$")


@lru_cache(maxsize=1)
def data_leads() -> dict[str, dict[str, Any]]:
    """Arrival details of every lead in smb_leads.csv, by lead id (read once)."""
    ids, rows, _ = load_leads()
    return dict(zip(ids, rows))


def score_json(lead_id: str | None, s: Score) -> dict[str, Any]:
    return {
        "id": lead_id,
        "probability": s.probability,
        "score": s.score,
        "band": s.band,
        "reasons": [{"feature": r.feature, "value": r.value, "effect": r.effect, "weight": r.weight} for r in s.reasons],
    }


def model_card(model: PropensityModel) -> dict[str, Any]:
    spec = model.spec
    return {
        "model": spec["model"],
        "version": spec["version"],
        "trainedOn": spec["trainedOn"],
        "target": spec["target"],
        "features": spec["features"],
        "excludedLeakage": spec["excludedLeakage"],
        "levels": {f: model.levels(f) for f in spec["categorical"]},
        "bands": spec["bands"],
        "metrics": spec["metrics"],
    }


def propensity_router() -> APIRouter:
    router = APIRouter(prefix="/propensity")

    def _model(request: Request) -> PropensityModel | None:
        return request.app.state.propensity

    @router.get("/model", response_model=None)
    def card(request: Request) -> dict[str, Any] | JSONResponse:
        model = _model(request)
        if model is None:
            return JSONResponse(status_code=503, content={"error": "model_unavailable"})
        return model_card(model)

    @router.post("/score", response_model=None)
    def score(req: ScoreRequest, request: Request) -> dict[str, Any] | JSONResponse:
        model = _model(request)
        if model is None:
            return JSONResponse(status_code=503, content={"error": "model_unavailable"})
        out = []
        for i, item in enumerate(req.leads):
            try:
                s = model.score(item.lead)
            except InputError as e:
                return JSONResponse(status_code=422, content={"error": "invalid_lead", "index": i, "problems": e.problems})
            out.append(score_json(item.id, s))
        log.info("leads scored", extra={"fields": {"count": len(out)}})
        return {"scores": out}

    @router.get("/leads/{lead_id}", response_model=None)
    def data_lead(lead_id: str, request: Request) -> dict[str, Any] | JSONResponse:
        model = _model(request)
        if model is None:
            return JSONResponse(status_code=503, content={"error": "model_unavailable"})
        lead = data_leads().get(lead_id) if LEAD_ID_RE.match(lead_id) else None
        if lead is None:
            return JSONResponse(status_code=404, content={"error": "lead_not_found"})
        return {**score_json(lead_id, model.score(lead)), "lead": lead}

    return router
