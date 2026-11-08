"""Read a KYC document image: clean it, straighten it, OCR it (RapidOCR, offline), extract fields.

Privacy: the image and the text read from it stay in memory for this call only. Nothing here
writes them to disk or to the log; the caller logs only the document type, outcome and timing.
"""
from __future__ import annotations

import math
import threading
from dataclasses import dataclass
from statistics import median
from typing import Protocol

import cv2
import numpy as np

from .layout import DocType, OcrLine, Reading, assess

MAX_SIDE = 2400  # larger photos are scaled down first (phone cameras); the specimens are ~1750 px
MIN_SIDE = 200  # anything smaller cannot hold readable text
DESKEW_MIN_DEGREES = 0.5
DESKEW_MAX_DEGREES = 30.0


class ImageError(ValueError):
    """The bytes are not an image we can read."""


@dataclass(frozen=True)
class Scan:
    lines: list[OcrLine]
    angle: float | None  # slope of the text in degrees, None when it cannot be measured


class OcrEngine(Protocol):
    def scan(self, image: np.ndarray) -> Scan: ...


class RapidOcrEngine:
    """RapidOCR (ONNX models shipped inside the pip package, so it runs offline).

    Loaded on first use and shared; calls are serialised because the engine object is not
    documented as thread-safe.
    """

    def __init__(self) -> None:
        self._engine = None
        self._lock = threading.Lock()

    def _get(self):
        if self._engine is None:
            from rapidocr import RapidOCR  # imported lazily: loading the models takes ~1 s

            self._engine = RapidOCR(params={"Global.log_level": "error"})
        return self._engine

    def scan(self, image: np.ndarray) -> Scan:
        with self._lock:
            result = self._get()(image)
        boxes = [[(float(p[0]), float(p[1])) for p in box] for box in (result.boxes if result.boxes is not None else [])]
        lines = []
        for box, text, score in zip(boxes, result.txts or (), result.scores or ()):
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            lines.append(OcrLine(text=str(text), confidence=float(score), x0=min(xs), y0=min(ys), x1=max(xs), y1=max(ys)))
        return Scan(lines=lines, angle=text_angle(boxes))


def text_angle(boxes: list[list[tuple[float, float]]]) -> float | None:
    """Slope of the text, from the top edge of each long box (top-left -> top-right corner)."""
    angles = []
    for box in boxes:
        (x0, y0), (x1, y1) = box[0], box[1]
        width = math.hypot(x1 - x0, y1 - y0)
        height = math.hypot(box[3][0] - x0, box[3][1] - y0)
        if width > 3 * max(height, 1):
            angles.append(math.degrees(math.atan2(y1 - y0, x1 - x0)))
    return median(angles) if len(angles) >= 3 else None


def decode(data: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ImageError("not_an_image")
    h, w = image.shape[:2]
    if min(h, w) < MIN_SIDE:
        raise ImageError("image_too_small")
    scale = MAX_SIDE / max(h, w)
    if scale < 1:
        image = cv2.resize(image, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    return image


def remove_watermark(image: np.ndarray) -> np.ndarray:
    """Keep the red channel: a pink/red stamp or watermark turns almost white, dark ink stays dark."""
    red = image[:, :, 2]
    red = np.where(red > 170, 255, red).astype(np.uint8)
    return cv2.cvtColor(red, cv2.COLOR_GRAY2BGR)


def grayscale(image: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)


def rotate(image: np.ndarray, degrees: float) -> np.ndarray:
    """Rotate counter-clockwise by `degrees` (image y axis points down), growing the canvas, white fill."""
    h, w = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), degrees, 1.0)
    cos, sin = abs(matrix[0, 0]), abs(matrix[0, 1])
    new_w, new_h = int(h * sin + w * cos), int(h * cos + w * sin)
    matrix[0, 2] += new_w / 2 - w / 2
    matrix[1, 2] += new_h / 2 - h / 2
    return cv2.warpAffine(image, matrix, (new_w, new_h), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255))


@dataclass(frozen=True)
class DocumentReading:
    reading: Reading
    deskew_degrees: float
    preprocessing: str


class DocumentReader:
    def __init__(self, engine: OcrEngine | None = None) -> None:
        self.engine: OcrEngine = engine or RapidOcrEngine()

    def _scan_straight(self, image: np.ndarray) -> tuple[Scan, float]:
        """OCR; if the text is tilted (a skewed photo or scan), straighten the image and OCR again."""
        scan = self.engine.scan(image)
        angle = scan.angle
        if angle is None or abs(angle) < DESKEW_MIN_DEGREES or abs(angle) > DESKEW_MAX_DEGREES:
            return scan, 0.0
        return self.engine.scan(rotate(image, angle)), round(angle, 2)

    def read(self, data: bytes, doc_type: DocType) -> DocumentReading:
        original = decode(data)
        attempts: list[DocumentReading] = []
        for name, prepare in (("watermark_removed", remove_watermark), ("grayscale", grayscale)):
            scan, degrees = self._scan_straight(prepare(original))
            reading = assess(scan.lines, doc_type)
            attempts.append(DocumentReading(reading=reading, deskew_degrees=degrees, preprocessing=name))
            if reading.readable:
                break
        # Prefer a readable attempt; otherwise the one that found the most labels.
        return max(attempts, key=lambda a: (a.reading.readable, a.reading.labels_found, a.reading.mean_confidence))
