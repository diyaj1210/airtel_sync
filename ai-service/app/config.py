"""Configuration from environment variables (shared root .env)."""
from __future__ import annotations

import os
from collections.abc import Mapping
import re
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# ai-service/app/config.py -> repo root is two levels above ai-service/app
REPO_ROOT = Path(__file__).resolve().parents[2]

LOG_LEVELS = ("debug", "info", "warn", "error", "silent")


DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
DEFAULT_GEMINI_TIMEOUT_S = 10.0
_MODEL_RE = re.compile(r"^[a-z0-9][a-z0-9.\-]{2,63}$")
# Values that mean "no key yet" (copied from .env.example or the README).
_PLACEHOLDER_KEYS = {"", "your-key-here", "paste-your-key-here", "changeme", "none"}


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    log_level: str
    # The key is a secret: never printed (repr=False) and never logged.
    gemini_api_key: str | None = field(default=None, repr=False)
    gemini_model: str = DEFAULT_GEMINI_MODEL
    gemini_timeout_s: float = DEFAULT_GEMINI_TIMEOUT_S

    @property
    def llm_enabled(self) -> bool:
        return self.gemini_api_key is not None


def load_root_env(env_path: Path | None = None) -> bool:
    """Load the shared root .env if it exists. Variables already set in the environment win."""
    path = env_path or REPO_ROOT / ".env"
    if not path.is_file():
        return False
    load_dotenv(path, override=False)
    return True


def _parse_port(name: str, raw: str | None, fallback: int) -> int:
    if raw is None or raw.strip() == "":
        return fallback
    try:
        value = int(raw.strip())
    except ValueError:
        raise ValueError(f'{name} must be an integer between 1 and 65535, got "{raw}"') from None
    if not 1 <= value <= 65535:
        raise ValueError(f'{name} must be an integer between 1 and 65535, got "{raw}"')
    return value


def _parse_log_level(raw: str | None) -> str:
    value = (raw or "info").strip().lower()
    if value not in LOG_LEVELS:
        raise ValueError(f'LOG_LEVEL must be one of {", ".join(LOG_LEVELS)}, got "{raw}"')
    return value


def _parse_api_key(raw: str | None) -> str | None:
    value = (raw or "").strip().strip('"').strip("'")
    return None if value.lower() in _PLACEHOLDER_KEYS else value


def _parse_model(raw: str | None) -> str:
    value = (raw or "").strip()
    if value == "":
        return DEFAULT_GEMINI_MODEL
    if not _MODEL_RE.match(value):
        raise ValueError(f'GEMINI_MODEL must be a model name like "{DEFAULT_GEMINI_MODEL}", got "{value}"')
    return value


def _parse_timeout(raw: str | None) -> float:
    if raw is None or raw.strip() == "":
        return DEFAULT_GEMINI_TIMEOUT_S
    try:
        value = float(raw.strip())
    except ValueError:
        raise ValueError(f'GEMINI_TIMEOUT_SECONDS must be a number from 1 to 60, got "{raw}"') from None
    if not 1 <= value <= 60:
        raise ValueError(f'GEMINI_TIMEOUT_SECONDS must be a number from 1 to 60, got "{raw}"')
    return value


def load_config(env: Mapping[str, str] | None = None) -> Config:
    """Build the config from environment variables. Pure: pass `env` in tests."""
    env = os.environ if env is None else env
    return Config(
        # Only the backend calls this service, so it listens on loopback only.
        host="127.0.0.1",
        port=_parse_port("AI_SERVICE_PORT", env.get("AI_SERVICE_PORT"), 8000),
        log_level=_parse_log_level(env.get("LOG_LEVEL")),
        gemini_api_key=_parse_api_key(env.get("GEMINI_API_KEY")),
        gemini_model=_parse_model(env.get("GEMINI_MODEL")),
        gemini_timeout_s=_parse_timeout(env.get("GEMINI_TIMEOUT_SECONDS")),
    )
