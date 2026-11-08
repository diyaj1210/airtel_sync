"""Same cases as backend/tests/masking.test.ts, so both services mask identically."""
import pytest

from app.masking import MAX_LOGGED_STRING, mask_identifiers, mask_value


@pytest.mark.parametrize(
    "text, expected",
    [
        ("27XUIXG0767D1ZP", "27XUIX******1ZP"),
        ("19EOGXH4115Y1ZL", "19EOGX******1ZL"),  # letter O inside a real registry GSTIN
        ("27PZSXS1936O1ZH", "27PZSX******1ZH"),
        ("GSTIN on doc: 08YKZXS8189L1ZO", "GSTIN on doc: 08YKZX******1ZO"),  # K06, bad checksum
        ("/api/gstin/32TZAXB5481U1Z1?x=1", "/api/gstin/32TZAX******1Z1?x=1"),
        ("UDYAM-KL-00-5521886", "UDYAM-KL-00-****886"),
        ("ID SYN-ID-346190", "ID SYN-ID-***190"),
        ("1234 5678 9012", "**********9012"),
        ("123456789012", "********9012"),
        ("call 9876543210", "call ******3210"),
        ("call +91 9876543210", "call **********3210"),
        ("PAN ABCDE1234F", "PAN AB*******F"),
        ("owner neha.kaur@example.com", "owner n***@example.com"),
        ("27XUIXG0767D1ZP / UDYAM-MH-00-9516696", "27XUIX******1ZP / UDYAM-MH-00-****696"),
    ],
)
def test_mask_identifiers(text, expected):
    assert mask_identifiers(text) == expected


def test_leaves_ordinary_text_dates_prices_and_pincodes_alone():
    text = "Bill date 2026-07-15, amount 27,071, Kerala - 752083, 3 sites, 15 employees"
    assert mask_identifiers(text) == text


def test_hindi_text_and_devanagari_digits_are_untouched():
    text = "नमस्ते, आपके व्यवसाय में १२३४५६७८९०१२ कर्मचारी"
    assert mask_identifiers(text) == text


def test_mask_value_redacts_sensitive_keys_case_insensitively():
    masked = mask_value({
        "Document": "....",
        "image": "data:image/png;base64,AAAA",
        "fileData": "x",
        "apiKey": "sk-123",
        "Authorization": "Bearer abc",
        "name": "Vindhya Tours",
    })
    assert masked == {
        "Document": "[REDACTED]",
        "image": "[REDACTED]",
        "fileData": "[REDACTED]",
        "apiKey": "[REDACTED]",
        "Authorization": "[REDACTED]",
        "name": "Vindhya Tours",
    }


def test_mask_value_nested_and_arrays():
    masked = mask_value({"applicant": {"gstins": ["27XUIXG0767D1ZP"], "udyam": "UDYAM-MH-00-9516696"}})
    assert masked == {"applicant": {"gstins": ["27XUIX******1ZP"], "udyam": "UDYAM-MH-00-****696"}}


def test_mask_value_omits_long_strings_and_bytes():
    assert mask_value("a" * (MAX_LOGGED_STRING + 1)) == f"[OMITTED {MAX_LOGGED_STRING + 1} chars]"
    assert mask_value(b"\x00" * 10) == "[OMITTED 10 bytes]"


def test_mask_value_errors_and_scalars():
    assert mask_value({"e": ValueError("bad 27XUIXG0767D1ZP"), "n": 3, "b": True, "z": None}) == {
        "e": {"name": "ValueError", "message": "bad 27XUIX******1ZP"},
        "n": 3,
        "b": True,
        "z": None,
    }


def test_mask_value_does_not_modify_the_original():
    original = {"gstin": "27XUIXG0767D1ZP"}
    mask_value(original)
    assert original == {"gstin": "27XUIXG0767D1ZP"}
