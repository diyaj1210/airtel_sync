"""KYC document reading. Only the backend calls it; the backend runs every check on the fields.

POST /kyc/read?docType=<gst_certificate|udyam_certificate|signatory_id|address_proof>
     body: the image bytes (Content-Type image/png, image/jpeg or image/webp, at most 8 MB)
  -> 200 {docType, detectedType, readable, quality, deskewDegrees, preprocessing, fields}
     400 {"error": "invalid_doc_type"}   413 {"error": "too_large"}
     415 {"error": "unsupported_type"}   422 {"error": "not_an_image" | "image_too_small"}
     503 {"error": "ocr_unavailable"}    the OCR engine could not start

Privacy: the image and the text read from it are never stored or logged. The log line has the
document type, whether it was readable, the number of labels found and the time taken.
"""
from __future__ import annotations

import logging
import time
from typing import Any, get_args

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .layout import DocType
from .reader import DocumentReader, DocumentReading, ImageError

MAX_BYTES = 8 * 1024 * 1024
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}

log = logging.getLogger("app.kyc")


def reading_json(doc_type: str, result: DocumentReading) -> dict[str, Any]:
    r = result.reading
    return {
        "docType": doc_type,
        "detectedType": r.detected_type,
        "readable": r.readable,
        "quality": {
            "labelsFound": r.labels_found,
            "labelsExpected": r.labels_expected,
            "meanConfidence": r.mean_confidence,
        },
        "deskewDegrees": result.deskew_degrees,
        "preprocessing": result.preprocessing,
        "fields": {
            name: {"value": f.value, "confidence": f.confidence, "labelFound": f.label_found}
            for name, f in r.fields.items()
        },
    }


def kyc_router() -> APIRouter:
    router = APIRouter(prefix="/kyc")

    @router.post("/read", response_model=None)
    async def read(request: Request, docType: str = "") -> dict[str, Any] | JSONResponse:  # noqa: N803 (API name)
        if docType not in get_args(DocType):
            return JSONResponse(status_code=400, content={"error": "invalid_doc_type"})
        content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
        if content_type not in IMAGE_TYPES:
            return JSONResponse(status_code=415, content={"error": "unsupported_type"})
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > MAX_BYTES:
            return JSONResponse(status_code=413, content={"error": "too_large"})
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > MAX_BYTES:
                return JSONResponse(status_code=413, content={"error": "too_large"})

        reader: DocumentReader = request.app.state.document_reader
        started = time.perf_counter()
        try:
            # OCR takes 1-5 s of CPU: run it off the event loop so other requests are not held up.
            result = await run_in_threadpool(reader.read, bytes(data), docType)
        except ImageError as e:
            return JSONResponse(status_code=422, content={"error": str(e)})
        except (ImportError, OSError, RuntimeError) as e:
            log.error("OCR engine unavailable", extra={"fields": {"error": type(e).__name__}})
            return JSONResponse(status_code=503, content={"error": "ocr_unavailable"})
        finally:
            data.clear()  # drop the image bytes as soon as they are read
        log.info(
            "document read",
            extra={"fields": {
                "docType": docType,
                "readable": result.reading.readable,
                "detectedType": result.reading.detected_type,
                "labels": f"{result.reading.labels_found}/{result.reading.labels_expected}",
                "deskewDegrees": result.deskew_degrees,
                "ms": round((time.perf_counter() - started) * 1000),
            }},
        )
        return reading_json(docType, result)

    return router
