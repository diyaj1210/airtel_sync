"""Lead propensity model: no leakage, reproducible from the data, served exactly as trained,
explainable, and the /propensity endpoints."""
from __future__ import annotations

import csv
import io
import json
import math
import random
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split

from app.logging_setup import setup_logging
from app.main import create_app
from app.propensity import train as T
from app.propensity.features import CATEGORICAL, FEATURES, LEADS_CSV, LEAKAGE, NUMERIC, lead_features, load_leads
from app.propensity.model import MODEL_PATH, InputError, PropensityModel, sigmoid

MODEL = PropensityModel.load()
SPEC = MODEL.spec
IDS, ROWS, LABELS = load_leads()


@pytest.fixture(scope="module")
def retrained() -> dict:
    spec, _ = T.train()
    return spec


class TestNoLeakage:
    def test_inputs_are_only_the_listed_features(self) -> None:
        assert SPEC["features"] == list(FEATURES)
        assert not set(FEATURES) & set(LEAKAGE)
        assert set(SPEC["categorical"]) | set(SPEC["numeric"]) == set(FEATURES)
        header = next(csv.reader(LEADS_CSV.open(encoding="utf-8")))
        assert set(LEAKAGE) <= set(header)  # every excluded column really exists in the data
        assert set(lead_features(next(csv.DictReader(LEADS_CSV.open(encoding="utf-8"))))) == set(FEATURES)

    def test_scrambling_every_leakage_column_changes_nothing(self, tmp_path: Path, retrained: dict) -> None:
        """Train on a copy of the data with all leakage columns (except the target) shuffled."""
        rows = list(csv.DictReader(LEADS_CSV.open(encoding="utf-8", newline="")))
        rng = random.Random(7)
        for col in LEAKAGE:
            if col == "outcome":
                continue
            values = [r[col] for r in rows]
            rng.shuffle(values)
            for r, v in zip(rows, values):
                r[col] = v
        copy = tmp_path / "leads.csv"
        with copy.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
        scrambled, _ = T.train(copy)
        for key in ("intercept", "categorical", "numeric", "scoreCuts"):
            assert scrambled[key] == retrained[key], key
        assert scrambled["metrics"]["logisticRegression"] == retrained["metrics"]["logisticRegression"]


class TestTrainedModel:
    def test_committed_model_is_exactly_what_training_produces(self, retrained: dict) -> None:
        committed = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
        assert committed == json.loads(json.dumps(retrained))

    def test_test_auc_is_reported_and_better_than_chance(self) -> None:
        m = SPEC["metrics"]
        assert (m["rows"], m["positives"], m["testRows"], m["testPositives"]) == (5000, 368, 1000, 74)
        lr = m["logisticRegression"]
        assert 0.6 < lr["testAuc"] < 0.8 and 0.6 < lr["cvAucMean"] < 0.85
        assert lr["testTop20"]["activationsCaptured"] > 0.2  # better than calling a random 20%
        assert m["leakageCheck"]["acquisitionCostAloneAuc"] > 0.85  # why that column is excluded
        report = (T.REPORT_PATH).read_text(encoding="utf-8")
        assert f"**{lr['testAuc']:.3f}**" in report and "acquisition_cost_inr" in report

    def test_served_probabilities_equal_scikit_learn(self) -> None:
        """Scoring from the JSON reproduces the trained logistic regression on the held-out leads."""
        y = np.array(LABELS)
        tr, te = train_test_split(np.arange(len(ROWS)), test_size=T.TEST_SIZE, stratify=y, random_state=T.SEED)
        enc = T.Encoder([ROWS[i] for i in tr])
        lr = LogisticRegression(C=T.C, max_iter=5000).fit(enc.encode([ROWS[i] for i in tr]), y[tr])
        expected = lr.predict_proba(enc.encode([ROWS[i] for i in te]))[:, 1]
        served = np.array([sigmoid(MODEL.logit(ROWS[i])) for i in te])
        assert np.max(np.abs(served - expected)) < 1e-4


class TestScoring:
    lead = dict(ROWS[0])

    def test_reasons_add_up_to_the_score(self) -> None:
        contrib = MODEL.contributions(self.lead)
        assert math.isclose(SPEC["baseLogit"] + sum(contrib.values()), MODEL.logit(self.lead), abs_tol=1e-12)
        s = MODEL.score(self.lead)
        assert len(s.reasons) == 3
        weights = [abs(r.weight) for r in s.reasons]
        assert weights == sorted(weights, reverse=True)
        assert max(abs(v) for v in contrib.values()) == pytest.approx(weights[0], abs=1e-3)
        assert all((r.effect == "up") == (r.weight > 0) for r in s.reasons)
        assert 0 <= s.score <= 100 and s.band in ("high", "medium", "low")

    def test_missing_inputs_count_as_average(self) -> None:
        empty = MODEL.score({})
        assert empty.reasons == []
        assert empty.probability == pytest.approx(sigmoid(SPEC["baseLogit"]), abs=1e-4)
        partial = MODEL.score({"has_gstin": "N"})
        assert [r.feature for r in partial.reasons] == ["has_gstin"] and partial.reasons[0].effect == "down"

    def test_scores_are_percentiles_and_bands_split_20_40_40(self) -> None:
        scores = [MODEL.score(r).score for r in ROWS]
        bands = [MODEL.band(s) for s in scores]
        assert bands.count("high") / len(bands) == pytest.approx(0.20, abs=0.01)
        assert bands.count("medium") / len(bands) == pytest.approx(0.40, abs=0.01)
        # Higher bands activate more often in the data.
        rate = {b: np.mean([y for y, bb in zip(LABELS, bands) if bb == b]) for b in ("high", "medium", "low")}
        assert rate["high"] > rate["medium"] > rate["low"]

    def test_direction_makes_sense(self) -> None:
        base = dict(self.lead)
        good = MODEL.score({**base, "lead_source": "Referral", "has_gstin": "Y"}).probability
        poor = MODEL.score({**base, "lead_source": "WhatsApp campaign", "has_gstin": "N"}).probability
        assert good > poor

    def test_whole_numbers_show_without_decimals(self) -> None:
        s = MODEL.score({"employee_count": 150.0, "has_gstin": "Y"})
        assert {r.feature: r.value for r in s.reasons}["employee_count"] == "150"

    @pytest.mark.parametrize(
        ("lead", "problem"),
        [
            ({"segment": "Space agency"}, {"field": "segment", "problem": "unknown_value"}),
            ({"employee_count": -1}, {"field": "employee_count", "problem": "not_a_number"}),
            ({"employee_count": True}, {"field": "employee_count", "problem": "not_a_number"}),
            ({"num_sites": "3"}, {"field": "num_sites", "problem": "not_a_number"}),
            ({"outcome": "Activated"}, {"field": "outcome", "problem": "unknown_field"}),
            ({"acquisition_cost_inr": 9000}, {"field": "acquisition_cost_inr", "problem": "unknown_field"}),
        ],
    )
    def test_rejects_unknown_or_leaking_inputs(self, lead: dict, problem: dict) -> None:
        with pytest.raises(InputError) as e:
            MODEL.score(lead)
        assert e.value.problems == [problem]


class TestEndpoints:
    client = TestClient(create_app(llm=None))

    def test_model_card(self) -> None:
        body = self.client.get("/propensity/model").json()
        assert body["model"] == "logistic_regression"
        assert body["metrics"]["logisticRegression"]["testAuc"] == SPEC["metrics"]["logisticRegression"]["testAuc"]
        assert "acquisition_cost_inr" in body["excludedLeakage"]
        assert "Referral" in body["levels"]["lead_source"]

    def test_score_many_leads_with_reasons(self) -> None:
        leads = [{"id": IDS[i], "lead": ROWS[i]} for i in range(3)] + [{"lead": {"has_gstin": "Y"}}]
        res = self.client.post("/propensity/score", json={"leads": leads})
        assert res.status_code == 200
        scores = res.json()["scores"]
        assert [s["id"] for s in scores] == [IDS[0], IDS[1], IDS[2], None]
        assert scores[0]["score"] == MODEL.score(ROWS[0]).score
        assert set(scores[0]["reasons"][0]) == {"feature", "value", "effect", "weight"}

    def test_score_a_lead_from_the_data_by_id(self) -> None:
        body = self.client.get("/propensity/leads/L00001").json()
        assert body["id"] == "L00001" and body["score"] == MODEL.score(ROWS[0]).score
        assert set(body["lead"]) == set(FEATURES)  # arrival details only: no outcome, no leakage
        assert self.client.get("/propensity/leads/L99999").status_code == 404
        assert self.client.get("/propensity/leads/nope").status_code == 404

    def test_errors(self) -> None:
        bad = self.client.post("/propensity/score", json={"leads": [{"lead": {}}, {"lead": {"segment": "x"}}]})
        assert bad.status_code == 422
        assert bad.json() == {"error": "invalid_lead", "index": 1, "problems": [{"field": "segment", "problem": "unknown_value"}]}
        assert self.client.post("/propensity/score", json={"leads": []}).status_code == 422
        assert self.client.post("/propensity/score", json={"leads": [{"lead": {}}] * 501}).status_code == 422
        none = TestClient(create_app(llm=None, propensity=None))
        assert none.get("/propensity/model").json() == {"error": "model_unavailable"}
        assert none.post("/propensity/score", json={"leads": [{"lead": {}}]}).status_code == 503

    def test_log_has_no_lead_details(self) -> None:
        stream = io.StringIO()
        setup_logging("info", stream=stream)
        try:
            self.client.post("/propensity/score", json={"leads": [{"id": "L00001", "lead": ROWS[0]}]})
        finally:
            setup_logging("silent")
        log = stream.getvalue()
        assert '"count": 1' in log
        for text in (ROWS[0]["business_type"], ROWS[0]["lead_source"], "L00001"):
            assert text not in log
