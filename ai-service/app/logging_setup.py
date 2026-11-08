"""JSON-lines logging with identifier masking for the ai-service and uvicorn's own loggers."""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any, TextIO

from . import SERVICE_NAME
from .masking import mask_identifiers, mask_value

_LEVEL_NAMES = {
    logging.DEBUG: "debug",
    logging.INFO: "info",
    logging.WARNING: "warn",
    logging.ERROR: "error",
    logging.CRITICAL: "error",
}
_LEVELS = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warn": logging.WARNING,
    "error": logging.ERROR,
    "silent": logging.CRITICAL + 10,
}


class MaskingJsonFormatter(logging.Formatter):
    """Format a record as one JSON line. The message and any `fields` passed via
    `extra={"fields": {...}}` are masked; exception tracebacks are reduced to type + masked
    message so documents or identifiers inside exception text never reach the log."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, tz=timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "level": _LEVEL_NAMES.get(record.levelno, "info"),
            "service": SERVICE_NAME,
            "logger": record.name,
            "msg": mask_identifiers(record.getMessage()),
        }
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            for key, value in mask_value(fields).items():
                entry.setdefault(key, value)  # fields never overwrite the logger's own keys
        if record.exc_info and record.exc_info[1] is not None:
            entry.setdefault("error", mask_value(record.exc_info[1]))
        return json.dumps(entry, ensure_ascii=False)


def setup_logging(level: str = "info", stream: TextIO | None = None) -> logging.Handler:
    """Send all logs (ours and uvicorn's) through the masking JSON formatter."""
    handler = logging.StreamHandler(stream or sys.stdout)
    handler.setFormatter(MaskingJsonFormatter())
    root = logging.getLogger()
    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(_LEVELS[level])
    # uvicorn loggers: drop their own handlers and propagate to our root handler.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.propagate = True
        lg.setLevel(_LEVELS[level])
    # Third-party request logs add noise only (they never carry the key: it is sent in a header).
    for name in ("httpx", "google_genai", "RapidOCR"):
        logging.getLogger(name).setLevel(max(_LEVELS[level], logging.WARNING))
    return handler
