"""Run the ai-service:  .venv\\Scripts\\python -m app   (from the ai-service folder)."""
from __future__ import annotations

import logging
import sys

import uvicorn

from . import SERVICE_VERSION
from .config import load_config, load_root_env
from .logging_setup import setup_logging


def main() -> None:
    env_loaded = load_root_env()
    try:
        config = load_config()
    except ValueError as err:
        print(f"Configuration error: {err}", file=sys.stderr)
        raise SystemExit(1) from None
    setup_logging(config.log_level)
    logging.getLogger("app").info(
        "ai-service starting",
        extra={"fields": {
            "url": f"http://{config.host}:{config.port}",
            "version": SERVICE_VERSION,
            "envFile": ".env loaded" if env_loaded else "no .env (using defaults)",
        }},
    )
    # log_config=None keeps our masking JSON handler for uvicorn's access and error logs.
    uvicorn.run("app.main:app", host=config.host, port=config.port, log_config=None)


if __name__ == "__main__":
    main()
