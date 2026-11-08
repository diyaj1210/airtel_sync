"""Model inputs: only what is known about a lead when it arrives.

Every column that is filled in, or changes, because of what happened to the lead later is left out
(leakage): stage reached, outcome, drop reason, stage dates, days to activation, follow-up calls,
what was bought and its value, churn, NPS, and acquisition cost (it grows as a lead moves down the
funnel, so it gives the answer away).
"""
from __future__ import annotations

import csv
import math
from pathlib import Path
from typing import Any

from ..config import REPO_ROOT

LEADS_CSV = REPO_ROOT / "data" / "raw" / "smb_leads.csv"
TARGET = "outcome"
POSITIVE = "Activated"

CATEGORICAL = (
    "segment",
    "business_type",
    "lead_source",
    "city_tier",
    "has_gstin",
    "has_udyam",
    "annual_turnover_band",
    "current_internet",
    "current_provider",
    "preferred_language",
)
# Numeric inputs; counts and money are skewed, so the model sees log(1 + x).
NUMERIC = ("employee_count", "num_sites", "monthly_telecom_spend_inr", "products_of_interest_count")
FEATURES = CATEGORICAL + NUMERIC

LEAKAGE = (
    "stage_reached",
    "outcome",
    "drop_reason",
    "contacted_date",
    "needs_assessed_date",
    "quote_accepted_date",
    "kyc_complete_date",
    "activated_date",
    "days_lead_to_activation",
    "customer_follow_up_calls",
    "bundle_products",
    "monthly_bundle_value_inr",
    "one_time_setup_inr",
    "contract_months",
    "churned_within_6_months",
    "nps_score",
    "acquisition_cost_inr",
)
# Identifiers and free text that say nothing general about a business.
NOT_USED = ("lead_id", "created_date", "business_name", "city", "state", "gstin", "udyam_number", "contact_name", "contact_role", "products_of_interest")


def lead_features(row: dict[str, str]) -> dict[str, Any]:
    """The model inputs of one smb_leads.csv row (raw values, before encoding)."""
    out: dict[str, Any] = {c: row[c].strip() for c in CATEGORICAL}
    out["employee_count"] = float(row["employee_count"])
    out["num_sites"] = float(row["num_sites"])
    out["monthly_telecom_spend_inr"] = float(row["monthly_telecom_spend_inr"])
    poi = row.get("products_of_interest", "").strip()
    out["products_of_interest_count"] = float(len([p for p in poi.split(";") if p.strip()])) if poi else 0.0
    return out


def transform_numeric(value: float) -> float:
    if value < 0 or not math.isfinite(value):
        raise ValueError("numeric inputs must be finite and not negative")
    return math.log1p(value)


def load_leads(path: Path = LEADS_CSV) -> tuple[list[str], list[dict[str, Any]], list[int]]:
    """(lead ids, features, 1 = activated) for every lead. Reads the CSV only (never modifies it)."""
    ids, features, labels = [], [], []
    with path.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            ids.append(row["lead_id"])
            features.append(lead_features(row))
            labels.append(1 if row[TARGET] == POSITIVE else 0)
    return ids, features, labels
