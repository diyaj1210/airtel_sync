"""Turn OCR text lines (text + box + confidence) into named fields, by page layout.

Pure functions, no OCR engine here, so they are tested with hand-made lines.

Two layouts are used by the KYC documents:
- "columns": a label on the left, its value to the right on the same row; a value may wrap onto
  the next rows (addresses), and a label may wrap too ("Address of principal" / "place of business").
- "stacked": a small label with its value on the line below it (the signatory ID card).

The backend does all checking. This module only reports what is printed, and how sure it is.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from statistics import median
from typing import Literal

DocType = Literal["gst_certificate", "udyam_certificate", "signatory_id", "address_proof"]
DOC_TYPES: tuple[DocType, ...] = ("gst_certificate", "udyam_certificate", "signatory_id", "address_proof")


@dataclass(frozen=True)
class OcrLine:
    text: str
    confidence: float
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def height(self) -> float:
        return self.y1 - self.y0


@dataclass(frozen=True)
class DocSpec:
    titles: tuple[str, ...]
    layout: Literal["columns", "stacked"]
    # field name -> printed label variants (several labels may belong to one field when a label wraps)
    labels: dict[str, tuple[str, ...]]
    # fields the document is useless without (used for the readability decision)
    key_fields: tuple[str, ...]


SPECS: dict[DocType, DocSpec] = {
    "gst_certificate": DocSpec(
        titles=("gst registration certificate",),
        layout="columns",
        labels={
            "gstin": ("gstin",),
            "legalName": ("legal name",),
            "tradeName": ("trade name",),
            "constitution": ("constitution",),
            "address": ("address of principal", "place of business", "address of principal place of business"),
            "liabilityDate": ("date of liability",),
            "registrationType": ("type of registration",),
        },
        key_fields=("gstin", "legalName", "address"),
    ),
    "udyam_certificate": DocSpec(
        titles=("udyam registration certificate",),
        layout="columns",
        labels={
            "udyamNumber": ("udyam reg number", "udyam registration number"),
            "enterpriseName": ("enterprise name",),
            "majorActivity": ("major activity",),
            "city": ("city",),
            "state": ("state",),
            "registrationDate": ("date of registration",),
        },
        # The number may be blank on purpose (K01); the name is what proves the page was read.
        key_fields=("enterpriseName", "state"),
    ),
    "signatory_id": DocSpec(
        titles=("authorised signatory id", "authorized signatory id"),
        layout="stacked",
        labels={
            "name": ("name",),
            "designation": ("designation",),
            "business": ("for business",),
            "idNumber": ("id no",),
            "validTill": ("valid till",),
        },
        key_fields=("name", "validTill"),
    ),
    "address_proof": DocSpec(
        titles=("electricity bill", "address proof"),
        layout="columns",
        labels={
            "consumerNumber": ("consumer no",),
            "billedTo": ("billed to",),
            "address": ("supply address",),
            "billDate": ("bill date",),
            "unitsConsumed": ("units consumed",),
            "amountDue": ("amount due inr", "amount due"),
        },
        key_fields=("billedTo", "address", "billDate"),
    ),
}

LABEL_MATCH = 0.86  # how close an OCR'd line must be to a printed label
TITLE_MATCH = 0.80
MIN_FIELD_CONFIDENCE = 0.80  # below this a value is treated as unreadable
READABLE_MEAN_CONFIDENCE = 0.85
READABLE_LABEL_SHARE = 0.6


def simplify(text: str) -> str:
    """Lower case, letters/digits/spaces only, single spaces."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", text.lower())).strip()


def _ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def detect_type(lines: list[OcrLine]) -> DocType | None:
    """Which document this is, from its printed title (tolerates OCR slips like 'Rogistration')."""
    best: tuple[float, DocType | None] = (0.0, None)
    for line in lines:
        text = simplify(line.text)
        text = text.removeprefix("specimen ").strip()
        for doc_type, spec in SPECS.items():
            for title in spec.titles:
                score = 1.0 if title in text else _ratio(text, title)
                if score > best[0]:
                    best = (score, doc_type)
    return best[1] if best[0] >= TITLE_MATCH else None


def _label_of(line: OcrLine, spec: DocSpec) -> str | None:
    text = simplify(line.text)
    if not text:
        return None
    best: tuple[float, str | None] = (0.0, None)
    for field, variants in spec.labels.items():
        for variant in variants:
            score = _ratio(text, variant)
            if score > best[0]:
                best = (score, field)
    return best[1] if best[0] >= LABEL_MATCH else None


def join_wrapped(parts: list[str]) -> str:
    """Join a value that wrapped onto several lines.

    Values wrap mid-word on these documents ("West Be" / "ngal"), so lines are joined without a
    space, except after a separator such as ',' or '-' where a space was printed.
    """
    out = ""
    for part in (p.strip() for p in parts):
        if not part:
            continue
        if out and out[-1] in ",-:;/":
            out += " "
        out += part
    return out


@dataclass(frozen=True)
class Field:
    value: str | None  # None: the label is printed but nothing is next to it (blank field)
    confidence: float | None
    label_found: bool


def _columns(lines: list[OcrLine], spec: DocSpec) -> dict[str, list[OcrLine]]:
    labelled = [(line, _label_of(line, spec)) for line in lines]
    labels = [(line, field) for line, field in labelled if field]
    if not labels:
        return {}
    # Values sit right of the label column.
    label_right = max(line.x1 for line, _ in labels)
    first_label_top = min(line.y0 for line, _ in labels)
    tolerance = median(line.height for line, _ in labels) * 0.6
    found: dict[str, list[OcrLine]] = {field: [] for _, field in labels}
    for line, field in labelled:
        if field or line.x0 < label_right - 5 or line.y1 < first_label_top:
            continue
        # The value belongs to the closest label at or above it (a wrapped value continues below).
        above = [(lab, f) for lab, f in labels if lab.cy <= line.cy + tolerance]
        if not above:
            continue
        _, owner = max(above, key=lambda lf: lf[0].cy)
        found[owner].append(line)
    return found


def _stacked(lines: list[OcrLine], spec: DocSpec) -> dict[str, list[OcrLine]]:
    labelled = [(line, _label_of(line, spec)) for line in lines]
    labels = sorted(((line, field) for line, field in labelled if field), key=lambda lf: lf[0].cy)
    if not labels:
        return {}
    left = min(line.x0 for line, _ in labels)
    tolerance = median(line.height for line, _ in labels)
    found: dict[str, list[OcrLine]] = {field: [] for _, field in labels}
    for i, (label, field) in enumerate(labels):
        bottom = labels[i + 1][0].cy if i + 1 < len(labels) else float("inf")
        for line, other in labelled:
            # Below its label, above the next label, and in the same column (the photo is left of it).
            if other or not (label.cy < line.cy < bottom) or line.x0 < left - tolerance:
                continue
            found[field].append(line)
    return found


def extract_fields(lines: list[OcrLine], doc_type: DocType) -> dict[str, Field]:
    spec = SPECS[doc_type]
    groups = _columns(lines, spec) if spec.layout == "columns" else _stacked(lines, spec)
    fields: dict[str, Field] = {}
    for name in spec.labels:
        if name not in groups:
            fields[name] = Field(value=None, confidence=None, label_found=False)
            continue
        parts = sorted(groups[name], key=lambda line: (round(line.cy), line.x0))
        if not parts:
            fields[name] = Field(value=None, confidence=None, label_found=True)
            continue
        fields[name] = Field(
            value=join_wrapped([p.text for p in parts]),
            confidence=round(min(p.confidence for p in parts), 3),
            label_found=True,
        )
    return fields


@dataclass(frozen=True)
class Reading:
    detected_type: DocType | None
    fields: dict[str, Field]
    labels_found: int
    labels_expected: int
    mean_confidence: float
    readable: bool


def assess(lines: list[OcrLine], doc_type: DocType) -> Reading:
    """Fields plus a readability verdict: enough labels found, confident text, key fields present."""
    spec = SPECS[doc_type]
    fields = extract_fields(lines, doc_type)
    labels_found = sum(1 for f in fields.values() if f.label_found)
    used = [f.confidence for f in fields.values() if f.confidence is not None]
    mean_conf = round(sum(used) / len(used), 3) if used else 0.0
    key_ok = all(
        fields[k].value is not None and (fields[k].confidence or 0) >= MIN_FIELD_CONFIDENCE for k in spec.key_fields
    )
    readable = (
        labels_found >= READABLE_LABEL_SHARE * len(spec.labels) and mean_conf >= READABLE_MEAN_CONFIDENCE and key_ok
    )
    return Reading(
        detected_type=detect_type(lines),
        fields=fields,
        labels_found=labels_found,
        labels_expected=len(spec.labels),
        mean_confidence=mean_conf,
        readable=readable,
    )
