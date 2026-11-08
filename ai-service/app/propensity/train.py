"""Train the lead propensity model on data/raw/smb_leads.csv (read-only).

    .venv\\Scripts\\python -m app.propensity.train

- Target: outcome == Activated (368 of 5,000 leads).
- Inputs: features.FEATURES only; leakage columns are never read into the model.
- Stratified 80/20 train/test split (fixed seed); 5-fold cross-validation AUC on the training part.
- Logistic regression (served: explainable) and gradient boosting (for comparison only).
- Writes ai-service/models/propensity.json (coefficients, no pickle) and docs/propensity-report.md.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split

from ..config import REPO_ROOT
from .features import CATEGORICAL, FEATURES, LEAKAGE, LEADS_CSV, NUMERIC, load_leads, transform_numeric
from .model import MODEL_PATH

SEED = 42
TEST_SIZE = 0.2
C = 0.1  # L2 regularisation strength, chosen by 5-fold CV on the training part only (0.05-1.0 tried; all within noise)
REPORT_PATH = REPO_ROOT / "docs" / "propensity-report.md"
BANDS = {"high": 80, "medium": 40}  # top 20% = call within 24 h; next 40% = WhatsApp nudge; rest = nurture


class Encoder:
    """One-hot for categories (levels seen in training), log1p + standardise for numbers."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.levels = {f: sorted({r[f] for r in rows}) for f in CATEGORICAL}
        logs = {f: np.array([transform_numeric(r[f]) for r in rows]) for f in NUMERIC}
        self.center = {f: float(v.mean()) for f, v in logs.items()}
        self.scale = {f: float(v.std()) or 1.0 for f, v in logs.items()}
        self.columns = [(f, lv) for f in CATEGORICAL for lv in self.levels[f]] + [(f, None) for f in NUMERIC]

    def encode(self, rows: list[dict[str, Any]]) -> np.ndarray:
        x = np.zeros((len(rows), len(self.columns)))
        for i, r in enumerate(rows):
            for j, (f, lv) in enumerate(self.columns):
                if lv is not None:
                    x[i, j] = 1.0 if r[f] == lv else 0.0
                else:
                    x[i, j] = (transform_numeric(r[f]) - self.center[f]) / self.scale[f]
        return x


def top_capture(y: np.ndarray, p: np.ndarray, share: float = 0.2) -> dict[str, float]:
    """If only the top `share` of leads by score were called: what share of activations they hold."""
    k = max(1, int(round(len(p) * share)))
    top = np.argsort(-p, kind="stable")[:k]
    return {
        "share": share,
        "activationsCaptured": round(float(y[top].sum() / y.sum()), 3),
        "activationRateTop": round(float(y[top].mean()), 3),
        "activationRateAll": round(float(y.mean()), 3),
    }


def train(csv_path: Path = LEADS_CSV) -> tuple[dict[str, Any], dict[str, Any]]:
    """Returns (model spec for the JSON file, metrics). Deterministic for a given CSV."""
    ids, rows, labels = load_leads(csv_path)
    y = np.array(labels)
    idx = np.arange(len(rows))
    train_idx, test_idx = train_test_split(idx, test_size=TEST_SIZE, stratify=y, random_state=SEED)
    tr_rows = [rows[i] for i in train_idx]
    enc = Encoder(tr_rows)
    x_train, x_test, x_all = enc.encode(tr_rows), enc.encode([rows[i] for i in test_idx]), enc.encode(rows)
    y_train, y_test = y[train_idx], y[test_idx]

    lr = LogisticRegression(C=C, max_iter=5000)
    cv = cross_val_score(LogisticRegression(C=C, max_iter=5000), x_train, y_train, cv=StratifiedKFold(5, shuffle=True, random_state=SEED), scoring="roc_auc")
    lr.fit(x_train, y_train)
    p_test = lr.predict_proba(x_test)[:, 1]
    gb = GradientBoostingClassifier(random_state=SEED, n_estimators=200, max_depth=2, learning_rate=0.05, subsample=0.8)
    gb.fit(x_train, y_train)
    gb_test = gb.predict_proba(x_test)[:, 1]

    coef = lr.coef_[0]
    means = x_train.mean(axis=0)
    categorical: dict[str, dict[str, dict[str, float]]] = {f: {} for f in CATEGORICAL}
    numeric: dict[str, dict[str, float]] = {}
    for j, (f, lv) in enumerate(enc.columns):
        if lv is not None:
            categorical[f][lv] = {"coef": round(float(coef[j]), 6), "mean": round(float(means[j]), 6)}
        else:
            numeric[f] = {"coef": round(float(coef[j]), 6), "center": round(enc.center[f], 6), "scale": round(enc.scale[f], 6), "mean": round(float(means[j]), 6)}
    intercept = float(lr.intercept_[0])
    # Rounded coefficients are what the server uses: compute everything below from them.
    coef_r = np.array([categorical[f][lv]["coef"] if lv is not None else numeric[f]["coef"] for f, lv in enc.columns])
    means_r = np.array([categorical[f][lv]["mean"] if lv is not None else numeric[f]["mean"] for f, lv in enc.columns])
    base_logit = intercept + float(coef_r @ means_r)
    p_all = 1 / (1 + np.exp(-(intercept + x_all @ coef_r)))
    cuts = [round(float(q), 8) for q in np.quantile(p_all, [k / 100 for k in range(1, 101)])]

    metrics = {
        "rows": len(rows),
        "positives": int(y.sum()),
        "trainRows": int(len(train_idx)),
        "testRows": int(len(test_idx)),
        "testPositives": int(y_test.sum()),
        "logisticRegression": {
            "testAuc": round(float(roc_auc_score(y_test, p_test)), 4),
            "cvAucMean": round(float(cv.mean()), 4),
            "cvAucStd": round(float(cv.std()), 4),
            "testTop20": top_capture(y_test, p_test),
        },
        "gradientBoosting": {
            "testAuc": round(float(roc_auc_score(y_test, gb_test)), 4),
            "testTop20": top_capture(y_test, gb_test),
        },
        # Why acquisition cost is excluded: on its own it nearly gives the outcome away.
        "leakageCheck": {"acquisitionCostAloneAuc": round(float(roc_auc_score(y, _column(csv_path, "acquisition_cost_inr"))), 4)},
    }
    spec = {
        "version": 1,
        "model": "logistic_regression",
        "trainedOn": "data/raw/smb_leads.csv",
        "target": "outcome == Activated",
        "seed": SEED,
        "regularisationC": C,
        "features": list(FEATURES),
        "excludedLeakage": list(LEAKAGE),
        "intercept": round(intercept, 6),
        "baseLogit": round(base_logit, 6),
        "categorical": categorical,
        "numeric": numeric,
        "scoreCuts": cuts,
        "bands": BANDS,
        "metrics": metrics,
    }
    return spec, metrics


def _column(csv_path: Path, name: str) -> np.ndarray:
    import csv

    with csv_path.open(encoding="utf-8", newline="") as f:
        return np.array([float(r[name] or 0) for r in csv.DictReader(f)])


def report(spec: dict[str, Any]) -> str:
    m = spec["metrics"]
    lr, gb = m["logisticRegression"], m["gradientBoosting"]
    drivers = sorted(
        [(f, lv, v["coef"]) for f, levels in spec["categorical"].items() for lv, v in levels.items()]
        + [(f, "(more)", v["coef"]) for f, v in spec["numeric"].items()],
        key=lambda t: -t[2],
    )
    up = "\n".join(f"| {f} | {lv} | +{c:.2f} |" for f, lv, c in drivers[:8])
    down = "\n".join(f"| {f} | {lv} | {c:.2f} |" for f, lv, c in drivers[-8:][::-1])
    return f"""# Lead propensity model: report

Written by `python -m app.propensity.train` (ai-service). Data: `data/raw/smb_leads.csv`,
{m['rows']:,} leads, {m['positives']} activated ({m['positives'] / m['rows']:.1%}).
Target: `outcome == Activated`. Model served: **logistic regression** (explainable: every score
comes with its top 3 reasons); gradient boosting trained on the same inputs for comparison.

## Results (held-out test set: {m['testRows']:,} leads, {m['testPositives']} activated; stratified, seed {spec['seed']})

| Model | Test AUC | 5-fold CV AUC (train) | Top 20% of leads by score hold |
|---|---|---|---|
| Logistic regression (served) | **{lr['testAuc']:.3f}** | {lr['cvAucMean']:.3f} ± {lr['cvAucStd']:.3f} | {lr['testTop20']['activationsCaptured']:.0%} of activations ({lr['testTop20']['activationRateTop']:.1%} activate vs {lr['testTop20']['activationRateAll']:.1%} overall) |
| Gradient boosting (comparison) | {gb['testAuc']:.3f} | – | {gb['testTop20']['activationsCaptured']:.0%} of activations |

## Inputs (known when the lead arrives)

{", ".join(f"`{f}`" for f in spec['features'])}
(`products_of_interest_count` = number of products asked about; counts and money as log(1 + x)).

**Left out (leakage)**: {", ".join(f"`{f}`" for f in spec['excludedLeakage'])}. They are filled in, or
grow, as the lead moves through the funnel. Example: `acquisition_cost_inr` alone scores an AUC of
{m['leakageCheck']['acquisitionCostAloneAuc']:.3f}, because money is spent on leads that go further.

## Strongest drivers (log-odds per input)

| Input | Value | Effect |
|---|---|---|
{up}

| Input | Value | Effect |
|---|---|---|
{down}

## Score and routing

Score = the lead's percentile among all {m['rows']:,} leads (0-100). Bands (solution outline 04):
**high** = score ≥ {spec['bands']['high']} (top 20%): call within 24 h · **medium** = {spec['bands']['medium']}-{spec['bands']['high'] - 1}:
WhatsApp nudge to the self-serve journey · **low** = below {spec['bands']['medium']}: automated nurture.
"""


def main() -> None:
    spec, metrics = train()
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    MODEL_PATH.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8")
    REPORT_PATH.write_text(report(spec), encoding="utf-8")
    lr, gb = metrics["logisticRegression"], metrics["gradientBoosting"]
    print(f"logistic regression: test AUC {lr['testAuc']}, CV AUC {lr['cvAucMean']} ± {lr['cvAucStd']}, top 20% hold {lr['testTop20']['activationsCaptured']:.0%} of activations")
    print(f"gradient boosting:   test AUC {gb['testAuc']}")
    print(f"wrote {MODEL_PATH} and {REPORT_PATH}")


if __name__ == "__main__":
    sys.exit(main())
