"""Masking of personal identifiers for logs (and later the UI).

Privacy rule: never log a full GSTIN, Udyam number, ID number, Aadhaar, PAN, phone or email,
and never log raw documents. Same rules as backend/src/masking.ts (kept in sync by tests
with identical cases on both sides).
"""
from __future__ import annotations

import re
from collections.abc import Callable
from datetime import date, datetime
from typing import Any


def _stars(n: int) -> str:
    return "*" * max(n, 0)


def _mask_email(m: str) -> str:
    at = m.index("@")
    return m[0] + _stars(3) + m[at:]


# Order matters: longer / more specific identifiers first. Masked output contains '*',
# so it is never matched again by a later rule.
_RULES: list[tuple[re.Pattern[str], Callable[[str], str]]] = [
    # 15-char GSTIN, deliberately loose so invalid / OCR-garbled GSTINs are masked too.
    (re.compile(r"\b\d{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]\b", re.IGNORECASE | re.ASCII),
     lambda m: m[:4] + _stars(8) + m[12:]),
    (re.compile(r"\bUDYAM-[A-Z]{2}-\d{2}-\d{7}\b", re.IGNORECASE | re.ASCII),
     lambda m: "UDYAM-" + re.sub(r"[A-Za-z0-9]", "*", m[6:15]) + m[15:]),
    (re.compile(r"\bSYN-ID-\d{4,}\b", re.IGNORECASE | re.ASCII),
     lambda m: m[:7] + (_stars(len(m) - 7) if len(m) - 7 <= 4 else _stars(len(m) - 11) + m[-4:])),
    # Aadhaar-like 12 digits
    (re.compile(r"(?<![\d*])\d{4}[ -]?\d{4}[ -]?\d{4}(?![\d*])", re.ASCII),
     lambda m: _stars(len(m) - 4) + m[-4:]),
    # Indian mobile numbers
    (re.compile(r"(?<![\d*])(?:\+91[ -]?)?[6-9]\d{9}(?![\d*])", re.ASCII),
     lambda m: _stars(len(m) - 4) + m[-4:]),
    # PAN
    (re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b", re.ASCII),
     lambda m: m[:2] + _stars(7) + m[-1:]),
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b", re.ASCII),
     _mask_email),
]

REDACTED_KEYS = frozenset({
    "document", "documents", "image", "images", "file", "files", "filedata", "content",
    "base64", "raw", "rawtext", "ocrtext", "password", "secret", "token", "apikey",
    "api_key", "authorization",
})

MAX_LOGGED_STRING = 2000
_MAX_DEPTH = 6


def mask_identifiers(text: str) -> str:
    """Mask every identifier found in a piece of free text."""
    out = text
    for pattern, mask in _RULES:
        out = pattern.sub(lambda match, mask=mask: mask(match.group(0)), out)
    return out


def mask_value(value: Any, depth: int = 0) -> Any:
    """Copy a value for logging: mask strings, redact sensitive keys, omit documents/binary."""
    if isinstance(value, str):
        if len(value) > MAX_LOGGED_STRING:
            return f"[OMITTED {len(value)} chars]"
        return mask_identifiers(value)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if depth >= _MAX_DEPTH:
        return "[DEPTH LIMIT]"
    if isinstance(value, (bytes, bytearray, memoryview)):
        return f"[OMITTED {len(value)} bytes]"
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, BaseException):
        return {"name": type(value).__name__, "message": mask_identifiers(str(value))}
    if isinstance(value, dict):
        return {
            str(k): "[REDACTED]" if str(k).lower() in REDACTED_KEYS else mask_value(v, depth + 1)
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple, set, frozenset)):
        return [mask_value(v, depth + 1) for v in value]
    return mask_identifiers(str(value))
