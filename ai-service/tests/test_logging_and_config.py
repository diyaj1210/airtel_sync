import io
import json
import logging

import pytest
from fastapi.testclient import TestClient

from app.config import load_config, load_root_env
from app.logging_setup import setup_logging
from app.main import create_app


@pytest.fixture
def log_stream():
    stream = io.StringIO()
    handler = setup_logging("info", stream)
    yield stream
    logging.getLogger().removeHandler(handler)


def lines(stream: io.StringIO) -> list[dict]:
    return [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]


def test_log_line_is_json_with_masked_message_and_fields(log_stream):
    logging.getLogger("app").info(
        "lookup 27XUIXG0767D1ZP",
        extra={"fields": {"udyam": "UDYAM-MH-00-9516696", "document": "RAW-BYTES", "msg": "fake"}},
    )
    raw = log_stream.getvalue()
    assert "27XUIXG0767D1ZP" not in raw
    assert "9516696" not in raw
    assert "RAW-BYTES" not in raw
    (entry,) = lines(log_stream)
    assert entry["level"] == "info"
    assert entry["service"] == "ai-service"
    assert entry["msg"] == "lookup 27XUIX******1ZP"  # a field cannot overwrite msg
    assert entry["udyam"] == "UDYAM-MH-00-****696"
    assert entry["document"] == "[REDACTED]"


def test_exception_text_is_masked_and_traceback_not_logged(log_stream):
    try:
        raise ValueError("bad GSTIN 27XUIXG0767D1ZP")
    except ValueError:
        logging.getLogger("app").exception("failed")
    raw = log_stream.getvalue()
    assert "27XUIXG0767D1ZP" not in raw
    assert "Traceback" not in raw
    (entry,) = lines(log_stream)
    assert entry["error"] == {"name": "ValueError", "message": "bad GSTIN 27XUIX******1ZP"}


def test_level_filtering(log_stream):
    logging.getLogger().setLevel(logging.WARNING)
    logging.getLogger("app").info("hidden")
    logging.getLogger("app").warning("shown")
    assert [e["msg"] for e in lines(log_stream)] == ["shown"]


def test_uvicorn_access_log_lines_are_masked(log_stream):
    # Same format uvicorn uses for access logs.
    logging.getLogger("uvicorn.access").info(
        '%s - "%s %s HTTP/%s" %d', "127.0.0.1:5000", "GET", "/lookup/27XUIXG0767D1ZP", "1.1", 404
    )
    (entry,) = lines(log_stream)
    assert entry["msg"] == '127.0.0.1:5000 - "GET /lookup/27XUIX******1ZP HTTP/1.1" 404'


def test_health_endpoint_still_works_with_logging_configured(log_stream):
    assert TestClient(create_app()).get("/health").status_code == 200


def test_config_defaults():
    config = load_config({})
    assert (config.host, config.port, config.log_level) == ("127.0.0.1", 8000, "info")


def test_config_reads_env():
    config = load_config({"AI_SERVICE_PORT": "8100", "LOG_LEVEL": "DEBUG"})
    assert (config.port, config.log_level) == (8100, "debug")


@pytest.mark.parametrize("port", ["0", "70000", "abc", "40.5"])
def test_config_rejects_bad_port(port):
    with pytest.raises(ValueError, match="AI_SERVICE_PORT"):
        load_config({"AI_SERVICE_PORT": port})


def test_config_rejects_bad_log_level():
    with pytest.raises(ValueError, match="LOG_LEVEL"):
        load_config({"LOG_LEVEL": "loud"})


def test_load_root_env(tmp_path, monkeypatch):
    monkeypatch.delenv("UDYAM_TEST_ONLY_VAR", raising=False)
    assert load_root_env(tmp_path / "missing.env") is False
    env_file = tmp_path / ".env"
    env_file.write_text("UDYAM_TEST_ONLY_VAR=from-file\n", encoding="utf-8")
    assert load_root_env(env_file) is True
    import os

    assert os.environ["UDYAM_TEST_ONLY_VAR"] == "from-file"
    monkeypatch.delenv("UDYAM_TEST_ONLY_VAR")
