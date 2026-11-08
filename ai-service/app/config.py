"""Configuration from environment variables (shared root .env)."""
from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# ai-service/app/config.py -> repo root is two levels above ai-service/app
REPO_ROOT = Path(__file__).resolve().parents[2]

LOG_LEVELS = ("debug", "info", "warn", "error", "silent")


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    log_level: str


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


def load_config(env: Mapping[str, str] | None = None) -> Config:
    """Build the config from environment variables. Pure: pass `env` in tests."""
    env = os.environ if env is None else env
    return Config(
        # Only the backend calls this service, so it listens on loopback only.
        host="127.0.0.1",
        port=_parse_port("AI_SERVICE_PORT", env.get("AI_SERVICE_PORT"), 8000),
        log_level=_parse_log_level(env.get("LOG_LEVEL")),
    )
