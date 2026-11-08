"""KYC document reading: layout rules (hand-made lines), the endpoint (fake engine) and the real
OCR on the 47 sample documents (one test per applicant K01-K12)."""
from __future__ import annotations

import io
import json
import logging

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.kyc.fixture import FIXTURE_PATH, sample_files
from app.kyc.layout import OcrLine, assess, detect_type, extract_fields, join_wrapped, simplify
from app.kyc.reader import DocumentReader, ImageError, Scan, decode, remove_watermark, rotate, text_angle
from app.kyc.routes import reading_json
from app.logging_setup import setup_logging
from app.main import create_app


def L(text: str, x0: float, y0: float, x1: float | None = None, conf: float = 0.99, h: float = 24) -> OcrLine:
    return OcrLine(text=text, confidence=conf, x0=x0, y0=y0, x1=x1 if x1 is not None else x0 + 12 * len(text), y1=y0 + h)


GST_LINES = [
    L("Specimen: GST Registration Certificate", 80, 70),
    L("GSTIN", 90, 250, 160),
    L("19E0GXH4115Y1ZL", 520, 250),
    L("Legal name", 90, 320, 230),
    L("Joseph Shah (Prop. Harmony Dental Care)", 520, 320),
    L("Trade name", 90, 390, 230),
    L("Harmony Dental Care", 520, 390),
    L("Constitution", 90, 460, 250),
    L("Proprietorship", 520, 460),
    L("Address of principal", 90, 530, 340),
    L("Shop/Unit 199, Station Road, Kolkata, West Be", 520, 530),
    L("place of business", 90, 600, 300),
    L("ngal - 347550", 520, 600),
    L("Date of liability", 90, 670, 300),
    L("2022-04-17", 520, 670),
    L("Type of registration", 90, 740, 350),
    L("Regular", 520, 740),
    L("Accel YTL Hackathon - Track A test data.", 80, 1660),
]


class TestLayout:
    def test_simplify_and_join(self) -> None:
        assert simplify("  Udyam reg. number: ") == "udyam reg number"
        assert join_wrapped(["Shop/Unit 199, Kolkata, West Be", "ngal - 347550"]) == "Shop/Unit 199, Kolkata, West Bengal - 347550"
        assert join_wrapped(["Kochi, Kerala - 75", "2083"]) == "Kochi, Kerala - 752083"
        assert join_wrapped(["Delhi, Delhi -", "334596"]) == "Delhi, Delhi - 334596"
        assert join_wrapped(["Delhi,", "", "Delhi"]) == "Delhi, Delhi"

    def test_detects_the_document_from_its_title_even_with_ocr_slips(self) -> None:
        assert detect_type([L("Specimen: GST Rogistration Cortinicate", 0, 0)]) == "gst_certificate"
        assert detect_type([L("Specimen: Udyam Registration Certificate", 0, 0)]) == "udyam_certificate"
        assert detect_type([L("Specimen: Authorised Signatory ID", 0, 0)]) == "signatory_id"
        assert detect_type([L("Specimen: Electricity Bill", 0, 0)]) == "address_proof"
        assert detect_type([L("Hello world", 0, 0)]) is None

    def test_columns_layout_with_a_wrapped_label_and_value(self) -> None:
        fields = extract_fields(GST_LINES, "gst_certificate")
        assert fields["gstin"].value == "19E0GXH4115Y1ZL"
        assert fields["legalName"].value == "Joseph Shah (Prop. Harmony Dental Care)"
        assert fields["address"].value == "Shop/Unit 199, Station Road, Kolkata, West Bengal - 347550"
        assert fields["registrationType"].value == "Regular"  # the footer is not part of it
        reading = assess(GST_LINES, "gst_certificate")
        assert reading.readable and reading.detected_type == "gst_certificate" and reading.labels_found == 7

    def test_value_on_its_own_row_belongs_to_the_label_above(self) -> None:
        lines = [
            L("Billed to", 90, 320, 200), L("Trinity Bake House Pvt Ltd", 520, 320),
            L("Supply address", 90, 390, 300), L("Shop/Unit 188, Industrial Area Phase 2, Ludhi", 520, 390),
            L("ana, Punjab - 541498", 520, 460),
            L("Bill date", 90, 530, 200), L("2025-10-31", 520, 530),
        ]
        fields = extract_fields(lines, "address_proof")
        assert fields["address"].value == "Shop/Unit 188, Industrial Area Phase 2, Ludhiana, Punjab - 541498"
        assert fields["billDate"].value == "2025-10-31"

    def test_a_blank_field_is_reported_as_blank_not_unreadable(self) -> None:
        lines = [
            L("Specimen: Udyam Registration Certificate", 80, 70),
            L("Udyam reg. number", 90, 250, 360),
            L("Enterprise name", 90, 320, 320), L("Vindhya Tours & Travels", 520, 320),
            L("Major activity", 90, 390, 280), L("Services", 520, 390),
            L("City", 90, 460, 150), L("Visakhapatnam", 520, 460),
            L("State", 90, 530, 160), L("Andhra Pradesh", 520, 530),
            L("Date of registration", 90, 600, 360), L("2024-03-24", 520, 600),
        ]
        reading = assess(lines, "udyam_certificate")
        assert reading.readable
        number = reading.fields["udyamNumber"]
        assert number.label_found and number.value is None and number.confidence is None

    def test_stacked_layout_ignores_the_photo(self) -> None:
        lines = [
            L("Specimen: Authorised Signatory ID", 40, 40),
            L("Name", 340, 130, 400, h=18), L("O", 160, 205, 180, conf=0.51), L("Anita Shah", 340, 155, h=26),
            L("Designation", 340, 200, h=18), L("Owner", 340, 225, h=26),
            L("For business", 340, 270, h=18), L("Balaji Realty LLP", 340, 295, h=26),
            L("ID no.", 340, 340, h=18), L("SYN-ID-587234", 340, 365, h=26),
            L("Valid till", 340, 410, h=18), L("2029-09-11", 340, 435, h=26),
            L("SYNTHETIC SPECIMEN - NOT A VALID DOCUMENT", 40, 525),
        ]
        fields = extract_fields(lines, "signatory_id")
        assert fields["name"].value == "Anita Shah"
        assert fields["validTill"].value == "2029-09-11"
        assert fields["idNumber"].value == "SYN-ID-587234"

    def test_a_page_with_no_labels_or_low_confidence_is_unreadable(self) -> None:
        blurred = [L("Specimen: GST Rogistration Cortinicate", 80, 70, conf=0.93), L("中", 500, 300, conf=0.62)]
        reading = assess(blurred, "gst_certificate")
        assert not reading.readable and reading.labels_found == 0
        assert reading.detected_type == "gst_certificate"
        shaky = [line if line.x0 < 500 else OcrLine(line.text, 0.6, line.x0, line.y0, line.x1, line.y1) for line in GST_LINES]
        assert not assess(shaky, "gst_certificate").readable


class TestImage:
    def test_text_angle_from_box_top_edges(self) -> None:
        def box(angle: float, x: float, y: float) -> list[tuple[float, float]]:
            t = np.radians(angle)
            w, h = 300, 20
            p0 = (x, y)
            p1 = (x + w * np.cos(t), y + w * np.sin(t))
            return [p0, p1, (p1[0] - h * np.sin(t), p1[1] + h * np.cos(t)), (x - h * np.sin(t), y + h * np.cos(t))]

        assert text_angle([box(7, 0, i * 50) for i in range(5)]) == pytest.approx(7, abs=0.01)
        assert text_angle([box(7, 0, 0)]) is None  # too few lines to judge

    def test_decode_rejects_non_images_and_tiny_images_and_shrinks_huge_ones(self) -> None:
        with pytest.raises(ImageError, match="not_an_image"):
            decode(b"not an image at all")
        ok, tiny = cv2.imencode(".png", np.full((50, 50, 3), 255, np.uint8))
        with pytest.raises(ImageError, match="image_too_small"):
            decode(tiny.tobytes())
        ok, big = cv2.imencode(".png", np.full((3000, 4800, 3), 255, np.uint8))
        assert max(decode(big.tobytes()).shape[:2]) == 2400

    def test_watermark_removal_whitens_pink_and_keeps_black(self) -> None:
        image = np.zeros((10, 20, 3), np.uint8)
        image[:, :10] = (190, 190, 235)  # BGR pink watermark
        cleaned = remove_watermark(image)
        assert (cleaned[:, :10] == 255).all() and (cleaned[:, 10:] == 0).all()

    def test_rotate_grows_the_canvas(self) -> None:
        out = rotate(np.full((100, 200, 3), 255, np.uint8), 90)
        assert out.shape[:2] == (200, 100)


class FakeEngine:
    """Returns fixed lines; `angle` makes the reader straighten the page and scan again."""

    def __init__(self, lines: list[OcrLine], angle: float | None = None) -> None:
        self._lines, self._angle, self.calls = lines, angle, 0

    def scan(self, image: np.ndarray) -> Scan:
        self.calls += 1
        return Scan(lines=self._lines, angle=self._angle if self.calls == 1 else 0.0)


def png(h: int = 400, w: int = 300) -> bytes:
    return cv2.imencode(".png", np.full((h, w, 3), 255, np.uint8))[1].tobytes()


class TestReaderAndEndpoint:
    def test_reader_straightens_a_tilted_page_and_scans_again(self) -> None:
        engine = FakeEngine(GST_LINES, angle=7.0)
        result = DocumentReader(engine).read(png(), "gst_certificate")
        assert result.deskew_degrees == 7.0 and engine.calls == 2 and result.reading.readable

    def test_reader_tries_grayscale_when_the_cleaned_page_is_unreadable(self) -> None:
        engine = FakeEngine([L("nothing useful", 10, 10)])
        result = DocumentReader(engine).read(png(), "gst_certificate")
        assert engine.calls == 2 and not result.reading.readable

    def _client(self, lines: list[OcrLine] = GST_LINES) -> TestClient:
        return TestClient(create_app(llm=None, document_reader=DocumentReader(FakeEngine(lines))))

    def test_read_returns_fields_and_quality(self) -> None:
        res = self._client().post("/kyc/read?docType=gst_certificate", content=png(), headers={"content-type": "image/png"})
        assert res.status_code == 200
        body = res.json()
        assert body["readable"] is True and body["detectedType"] == "gst_certificate"
        assert body["fields"]["gstin"] == {"value": "19E0GXH4115Y1ZL", "confidence": 0.99, "labelFound": True}
        assert body["quality"] == {"labelsFound": 7, "labelsExpected": 7, "meanConfidence": 0.99}

    @pytest.mark.parametrize(
        ("query", "ctype", "data", "status", "error"),
        [
            ("docType=passport", "image/png", None, 400, "invalid_doc_type"),
            ("", "image/png", None, 400, "invalid_doc_type"),
            ("docType=address_proof", "application/pdf", None, 415, "unsupported_type"),
            ("docType=address_proof", "image/png", b"hello", 422, "not_an_image"),
            ("docType=address_proof", "image/png", "8MB+1", 413, "too_large"),
        ],
        ids=["unknown-type", "no-type", "pdf", "not-an-image", "too-large"],
    )
    def test_bad_requests(self, query: str, ctype: str, data: bytes | str | None, status: int, error: str) -> None:
        if data == "8MB+1":
            data = b"x" * (8 * 1024 * 1024 + 1)
        res = self._client().post(f"/kyc/read?{query}", content=data if data is not None else png(), headers={"content-type": ctype})
        assert res.status_code == status and res.json() == {"error": error}

    def test_engine_failure_is_503(self) -> None:
        class Broken:
            def scan(self, image: np.ndarray) -> Scan:
                raise RuntimeError("model file missing")

        client = TestClient(create_app(llm=None, document_reader=DocumentReader(Broken())))
        res = client.post("/kyc/read?docType=signatory_id", content=png(), headers={"content-type": "image/png"})
        assert res.status_code == 503 and res.json() == {"error": "ocr_unavailable"}

    def test_log_has_no_document_content(self) -> None:
        stream = io.StringIO()
        setup_logging("info", stream=stream)
        try:
            res = self._client().post("/kyc/read?docType=gst_certificate", content=png(), headers={"content-type": "image/png"})
            assert res.status_code == 200
        finally:
            setup_logging("silent")
        log = stream.getvalue()
        assert "document read" in log and '"docType": "gst_certificate"' in log
        for secret in ("19E0GXH4115Y1ZL", "Joseph Shah", "Station Road", "Harmony"):
            assert secret not in log


# ---- Real OCR on the sample documents (RapidOCR, ~1-2 s per page) ----

FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
SAMPLES = sample_files()


@pytest.fixture(scope="module")
def reader() -> DocumentReader:
    logging.getLogger("RapidOCR").setLevel(logging.ERROR)
    return DocumentReader()


def read_applicant(reader: DocumentReader, applicant: str) -> dict[str, dict]:
    return {d: reading_json(d, reader.read(p.read_bytes(), d)) for d, p in SAMPLES[applicant].items()}  # type: ignore[arg-type]


def value(readings: dict[str, dict], doc: str, field: str) -> str | None:
    return readings[doc]["fields"][field]["value"]


def matches_fixture(applicant: str, readings: dict[str, dict]) -> None:
    """The backend's K01-K12 tests use the fixture file; it must be exactly what the OCR reads."""
    expected = FIXTURE[applicant]
    assert sorted(readings) == sorted(expected)
    for doc, got in readings.items():
        want = expected[doc]
        assert got["readable"] == want["readable"], doc
        assert got["detectedType"] == want["detectedType"], doc
        for name, field in got["fields"].items():
            assert field["value"] == want["fields"][name]["value"], f"{doc}.{name}"
            if field["confidence"] is not None:
                assert field["confidence"] == pytest.approx(want["fields"][name]["confidence"], abs=0.03), f"{doc}.{name}"


EXPECTED_READS: dict[str, dict[tuple[str, str], str | None]] = {
    # Cancelled GSTIN is a registry fact; the documents read cleanly. Udyam number printed blank.
    "K01": {("gst_certificate", "gstin"): "37IHKXV5167L1ZS", ("udyam_certificate", "udyamNumber"): None,
            ("udyam_certificate", "enterpriseName"): "Vindhya Tours & Travels"},
    # Rotated certificate: read after straightening (O printed as 0 is fixed by position in the backend).
    "K02": {("gst_certificate", "gstin"): "19E0GXH4115Y1ZL",
            ("gst_certificate", "address"): "Shop/Unit 199, Station Road, Kolkata, West Bengal - 347550"},
    "K03": {("gst_certificate", "gstin"): "27XUIXG0767D1ZP", ("udyam_certificate", "udyamNumber"): "UDYAM-MH-00-9516696"},
    "K04": {("signatory_id", "name"): "Fatima Pillai"},  # the GST certificate is blurred (checked below)
    "K05": {("signatory_id", "name"): "Anita Shah", ("address_proof", "billedTo"): "Balaji Realty LLP"},
    "K06": {("gst_certificate", "gstin"): "08YKZXS8189L1Z0"},  # one digit differs from the registry
    "K07": {("gst_certificate", "legalName"): "Neha Banerjee (Prop. Shri Physio Clinic)",
            ("gst_certificate", "tradeName"): "Neelgiri Physio Clinic"},
    "K08": {("gst_certificate", "gstin"): "24X0RXG9365M1Z3"},
    "K09": {("gst_certificate", "gstin"): "37LDYXK0296F1ZB", ("address_proof", "billDate"): "2026-07-10"},
    "K10": {("signatory_id", "name"): "Nisha Arora", ("signatory_id", "designation"): "Owner"},
    "K11": {("address_proof", "billDate"): "2025-10-31",
            ("address_proof", "address"): "Shop/Unit 188, Industrial Area Phase 2, Ludhiana, Punjab - 541498"},
    "K12": {("udyam_certificate", "majorActivity"): "Services", ("signatory_id", "validTill"): "2029-03-03"},
}


@pytest.mark.parametrize("applicant", sorted(EXPECTED_READS))
def test_sample_applicant_is_read_correctly(reader: DocumentReader, applicant: str) -> None:
    readings = read_applicant(reader, applicant)
    for (doc, field), want in EXPECTED_READS[applicant].items():
        assert value(readings, doc, field) == want, f"{applicant} {doc}.{field}"
    if applicant == "K04":
        assert readings["gst_certificate"]["readable"] is False
        assert all(r["readable"] for d, r in readings.items() if d != "gst_certificate")
    else:
        assert all(r["readable"] for r in readings.values()), applicant
    if applicant == "K02":
        assert readings["gst_certificate"]["deskewDegrees"] > 3
    if applicant == "K05":
        assert "udyam_certificate" not in readings  # not submitted
    for doc, r in readings.items():
        assert r["detectedType"] == doc
    matches_fixture(applicant, readings)


def test_a_tilted_photo_and_a_blurred_one(reader: DocumentReader) -> None:
    """Robustness beyond the samples: K03's certificate tilted 5 degrees still reads; heavily blurred does not."""
    image = cv2.imread(str(SAMPLES["K03"]["gst_certificate"]))
    tilted = cv2.imencode(".png", rotate(image, -5))[1].tobytes()  # 5 degrees clockwise
    result = reader.read(tilted, "gst_certificate")
    assert result.reading.readable and result.reading.fields["gstin"].value == "27XUIXG0767D1ZP"
    assert result.deskew_degrees == pytest.approx(5, abs=1)  # measured slope; turned back by the same amount
    blurred = cv2.imencode(".png", cv2.GaussianBlur(image, (0, 0), 6))[1].tobytes()
    assert not reader.read(blurred, "gst_certificate").reading.readable
