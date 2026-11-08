"""Score a lead with the trained model, from its JSON file (no pickle, no scikit-learn needed).

Logistic regression: logit = intercept + sum(coef * input). Each input's share of the score is
measured against an average lead: contribution = coef * (input - average input). The largest
contributions are the reasons. Missing inputs count as average (they move the score neither way).
"""
from __future__ import annotations

import json
import math
from bisect import bisect_right
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from .features import CATEGORICAL, NUMERIC, transform_numeric

MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "propensity.json"
Band = Literal["high", "medium", "low"]


class InputError(ValueError):
    """A lead field has a value the model does not know."""

    def __init__(self, problems: list[dict[str, str]]) -> None:
        super().__init__("invalid lead")
        self.problems = problems


@dataclass(frozen=True)
class Reason:
    feature: str
    value: str
    effect: Literal["up", "down"]
    weight: float  # change in log-odds against an average lead


@dataclass(frozen=True)
class Score:
    probability: float
    score: int  # percentile among all leads in the data, 0-100
    band: Band
    reasons: list[Reason]


def display(value: Any) -> str:
    """6.0 -> "6", 1350.5 -> "1350.5", "Referral" -> "Referral"."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x)) if x >= 0 else math.exp(x) / (1 + math.exp(x))


class PropensityModel:
    def __init__(self, spec: dict[str, Any]) -> None:
        self.spec = spec
        self.intercept: float = spec["intercept"]
        self.categorical: dict[str, dict[str, dict[str, float]]] = spec["categorical"]
        self.numeric: dict[str, dict[str, float]] = spec["numeric"]
        self.cuts: list[float] = spec["scoreCuts"]
        self.bands: dict[str, int] = spec["bands"]
        if set(self.categorical) != set(CATEGORICAL) or set(self.numeric) != set(NUMERIC):
            raise ValueError("model file does not match the feature list")

    @classmethod
    def load(cls, path: Path = MODEL_PATH) -> "PropensityModel":
        return cls(json.loads(path.read_text(encoding="utf-8")))

    def levels(self, feature: str) -> list[str]:
        return sorted(self.categorical[feature])

    def validate(self, lead: dict[str, Any]) -> None:
        problems = []
        for f in CATEGORICAL:
            v = lead.get(f)
            if v is not None and (not isinstance(v, str) or v not in self.categorical[f]):
                problems.append({"field": f, "problem": "unknown_value"})
        for f in NUMERIC:
            v = lead.get(f)
            if v is None:
                continue
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0:
                problems.append({"field": f, "problem": "not_a_number"})
        for f in lead:
            if f not in CATEGORICAL and f not in NUMERIC:
                problems.append({"field": f, "problem": "unknown_field"})
        if problems:
            raise InputError(problems)

    def contributions(self, lead: dict[str, Any]) -> dict[str, float]:
        """Each input's effect on the log-odds, compared with an average lead."""
        out: dict[str, float] = {}
        for f in CATEGORICAL:
            v = lead.get(f)
            if v is None:
                out[f] = 0.0
                continue
            # one-hot: this level's column is 1, all others 0
            out[f] = sum(lv["coef"] * ((1.0 if level == v else 0.0) - lv["mean"]) for level, lv in self.categorical[f].items())
        for f in NUMERIC:
            v = lead.get(f)
            n = self.numeric[f]
            out[f] = 0.0 if v is None else n["coef"] * ((transform_numeric(float(v)) - n["center"]) / n["scale"] - n["mean"])
        return out

    def logit(self, lead: dict[str, Any]) -> float:
        return self.spec["baseLogit"] + sum(self.contributions(lead).values())

    def percentile(self, probability: float) -> int:
        """Share of the leads in the data scored lower (0-100)."""
        return bisect_right(self.cuts, probability)

    def band(self, score: int) -> Band:
        return "high" if score >= self.bands["high"] else "medium" if score >= self.bands["medium"] else "low"

    def score(self, lead: dict[str, Any], top: int = 3) -> Score:
        self.validate(lead)
        contrib = self.contributions(lead)
        probability = sigmoid(self.spec["baseLogit"] + sum(contrib.values()))
        ranked = sorted((c for c in contrib.items() if abs(c[1]) > 1e-9), key=lambda c: -abs(c[1]))[:top]
        reasons = [
            Reason(feature=f, value=display(lead[f]), effect="up" if w > 0 else "down", weight=round(w, 3))
            for f, w in ranked
        ]
        s = self.percentile(probability)
        return Score(probability=round(probability, 4), score=s, band=self.band(s), reasons=reasons)
