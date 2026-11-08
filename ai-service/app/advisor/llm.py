"""LLM client for the advisor. Gemini via Google's official `google-genai` SDK.

The model only reads the owner's message and rewords facts it is given; the backend's rules
engine decides every product and price and checks every sentence before it is shown.
Privacy: prompts are never logged; only model, task, outcome, latency and token counts are.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Literal, Protocol

log = logging.getLogger("app.advisor.llm")

ErrorKind = Literal["disabled", "quota", "timeout", "upstream", "bad_output"]


class LlmError(Exception):
    """A failed LLM call. The backend answers by its rules instead."""

    def __init__(self, kind: ErrorKind, retry_after_s: float | None = None, detail: str = "") -> None:
        super().__init__(f"LLM {kind}{': ' + detail if detail else ''}")
        self.kind: ErrorKind = kind
        self.detail = detail
        self.retry_after_s = retry_after_s


class LlmClient(Protocol):
    provider: str
    model: str

    def generate_json(
        self, *, task: str, system: str, prompt: str, schema: dict[str, Any], max_output_tokens: int, temperature: float
    ) -> dict[str, Any]: ...


_RETRY_RE = re.compile(r"retry(?:Delay| in)[\"':\s]*([0-9]+(?:\.[0-9]+)?)\s*s", re.IGNORECASE)


def retry_after_seconds(text: str) -> float | None:
    """Google's 429 says how long to wait, e.g. "retryDelay": "37s" or "Please retry in 36.2s"."""
    m = _RETRY_RE.search(text)
    return float(m.group(1)) if m else None


def classify_api_error(code: int | None, message: str, details: str, status: str | None = None) -> LlmError:
    """Map a Gemini API error to one of our kinds. Only the code and status word are kept as detail
    (Google's message text can echo parts of the prompt, which must not reach the logs)."""
    text = f"{message} {details}"
    if code == 429:
        return LlmError("quota", retry_after_seconds(text), "free-plan or rate limit reached")
    if code in (401, 403) or (code == 400 and "api key" in text.lower()):
        return LlmError("disabled", detail="the API key was rejected")
    if code in (408, 504):
        return LlmError("timeout", detail=f"HTTP {code}")
    word = status if status and re.fullmatch(r"[A-Z_]{3,40}", status) else ""
    return LlmError("upstream", detail=f"HTTP {code}{' ' + word if word else ''}")


class GeminiClient:
    provider = "gemini"

    def __init__(self, api_key: str, model: str, timeout_s: float, client: Any | None = None) -> None:
        self.model = model
        if client is None:
            from google import genai
            from google.genai import types

            # No automatic retries: a slow or failed call falls back to the rules at once.
            client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=int(timeout_s * 1000)))
        self._client = client

    def generate_json(
        self, *, task: str, system: str, prompt: str, schema: dict[str, Any], max_output_tokens: int, temperature: float
    ) -> dict[str, Any]:
        import httpx
        from google.genai import errors, types

        started = time.perf_counter()
        outcome = "ok"
        detail = ""
        usage: dict[str, Any] = {}
        try:
            try:
                response = self._client.models.generate_content(
                    model=self.model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system,
                        response_mime_type="application/json",
                        response_json_schema=schema,
                        temperature=temperature,
                        max_output_tokens=max_output_tokens,
                    ),
                )
            except errors.APIError as e:
                raise classify_api_error(e.code, str(e.message or ""), str(e.details or ""), getattr(e, "status", None)) from None
            except httpx.TimeoutException:
                raise LlmError("timeout", detail="no answer in time") from None
            except httpx.HTTPError as e:
                raise LlmError("upstream", detail=type(e).__name__) from None

            meta = getattr(response, "usage_metadata", None)
            if meta is not None:
                usage = {"promptTokens": meta.prompt_token_count, "outputTokens": meta.candidates_token_count}
            text = getattr(response, "text", None)
            if not text:
                raise LlmError("bad_output", detail="empty answer (blocked or cut off)")
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                raise LlmError("bad_output", detail="answer is not JSON") from None
            if not isinstance(data, dict):
                raise LlmError("bad_output", detail="answer is not a JSON object")
            return data
        except LlmError as e:
            outcome, detail = e.kind, e.detail
            raise
        finally:
            log.info(
                "llm call",
                extra={"fields": {
                    "provider": self.provider,
                    "model": self.model,
                    "task": task,
                    "outcome": outcome,
                    "ms": round((time.perf_counter() - started) * 1000),
                    **({"detail": detail} if detail else {}),
                    **usage,
                }},
            )
