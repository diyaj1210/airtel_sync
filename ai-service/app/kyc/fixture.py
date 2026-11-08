"""Write what the OCR reads from the sample documents (data/raw/kyc_documents) to a JSON file.

    .venv\\Scripts\\python -m app.kyc.fixture

The backend's K01-K12 tests use this file instead of running OCR, so they run without the
ai-service; tests/test_kyc.py re-reads every image and checks the file still matches the OCR.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from ..config import REPO_ROOT
from .layout import DOC_TYPES
from .reader import DocumentReader
from .routes import reading_json

DOCUMENTS_DIR = REPO_ROOT / "data" / "raw" / "kyc_documents"
FIXTURE_PATH = REPO_ROOT / "ai-service" / "tests" / "fixtures" / "kyc_readings.json"
_NAME = re.compile(r"^(K\d{2})_(" + "|".join(DOC_TYPES) + r")\.png$")


def sample_files() -> dict[str, dict[str, Path]]:
    """{applicant: {docType: path}} for every sample image."""
    out: dict[str, dict[str, Path]] = {}
    for path in sorted(DOCUMENTS_DIR.glob("*.png")):
        m = _NAME.match(path.name)
        if m:
            out.setdefault(m.group(1), {})[m.group(2)] = path
    return out


def read_samples(reader: DocumentReader) -> dict[str, dict[str, dict]]:
    return {
        applicant: {doc_type: reading_json(doc_type, reader.read(path.read_bytes(), doc_type)) for doc_type, path in docs.items()}
        for applicant, docs in sample_files().items()
    }


def main() -> None:
    readings = read_samples(DocumentReader())
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(json.dumps(readings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    count = sum(len(d) for d in readings.values())
    print(f"wrote {count} document readings for {len(readings)} applicants to {FIXTURE_PATH}")


if __name__ == "__main__":
    main()
