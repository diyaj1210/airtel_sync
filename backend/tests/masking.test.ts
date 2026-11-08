import { describe, expect, it } from "vitest";
import { MAX_LOGGED_STRING, maskIdentifiers, maskValue } from "../src/masking.js";

describe("maskIdentifiers", () => {
  it("masks a registry GSTIN, keeping state + 4 PAN chars and the last 3", () => {
    expect(maskIdentifiers("27XUIXG0767D1ZP")).toBe("27XUIX******1ZP");
  });

  it("masks GSTINs that contain the letter O (real registry values)", () => {
    expect(maskIdentifiers("19EOGXH4115Y1ZL")).toBe("19EOGX******1ZL");
    expect(maskIdentifiers("27PZSXS1936O1ZH")).toBe("27PZSX******1ZH");
  });

  it("masks an invalid GSTIN read from a document too (K06, failed checksum)", () => {
    expect(maskIdentifiers("GSTIN on doc: 08YKZXS8189L1ZO")).toBe("GSTIN on doc: 08YKZX******1ZO");
  });

  it("masks GSTINs inside a URL path", () => {
    expect(maskIdentifiers("/api/gstin/32TZAXB5481U1Z1?x=1")).toBe("/api/gstin/32TZAX******1Z1?x=1");
  });

  it("masks Udyam numbers (district code 00)", () => {
    expect(maskIdentifiers("UDYAM-KL-00-5521886")).toBe("UDYAM-KL-00-****886");
  });

  it("masks signatory ID numbers", () => {
    expect(maskIdentifiers("ID SYN-ID-346190")).toBe("ID SYN-ID-***190");
  });

  it("masks Aadhaar-like 12-digit numbers with or without spaces", () => {
    expect(maskIdentifiers("1234 5678 9012")).toBe("**********9012");
    expect(maskIdentifiers("123456789012")).toBe("********9012");
  });

  it("masks Indian mobile numbers, with or without +91", () => {
    expect(maskIdentifiers("call 9876543210")).toBe("call ******3210");
    expect(maskIdentifiers("call +91 9876543210")).toBe("call **********3210");
  });

  it("masks PAN numbers", () => {
    expect(maskIdentifiers("PAN ABCDE1234F")).toBe("PAN AB*******F");
  });

  it("masks email addresses", () => {
    expect(maskIdentifiers("owner neha.kaur@example.com")).toBe("owner n***@example.com");
  });

  it("leaves ordinary text, dates, prices and pincodes alone", () => {
    const text = "Bill date 2026-07-15, amount 27,071, Kerala - 752083, 3 sites, 15 employees";
    expect(maskIdentifiers(text)).toBe(text);
  });

  it("masks several identifiers in one string", () => {
    expect(maskIdentifiers("27XUIXG0767D1ZP / UDYAM-MH-00-9516696")).toBe(
      "27XUIX******1ZP / UDYAM-MH-00-****696",
    );
  });
});

describe("maskValue", () => {
  it("redacts document, image, file and secret keys (case-insensitive)", () => {
    const masked = maskValue({
      Document: "....",
      image: "data:image/png;base64,AAAA",
      fileData: "x",
      apiKey: "sk-123",
      Authorization: "Bearer abc",
      name: "Vindhya Tours",
    });
    expect(masked).toEqual({
      Document: "[REDACTED]",
      image: "[REDACTED]",
      fileData: "[REDACTED]",
      apiKey: "[REDACTED]",
      Authorization: "[REDACTED]",
      name: "Vindhya Tours",
    });
  });

  it("masks identifiers in nested objects and arrays", () => {
    const masked = maskValue({ applicant: { gstins: ["27XUIXG0767D1ZP"], udyam: "UDYAM-MH-00-9516696" } });
    expect(masked).toEqual({ applicant: { gstins: ["27XUIX******1ZP"], udyam: "UDYAM-MH-00-****696" } });
  });

  it("omits very long strings (raw documents / base64) and binary data", () => {
    expect(maskValue("a".repeat(MAX_LOGGED_STRING + 1))).toBe(`[OMITTED ${MAX_LOGGED_STRING + 1} chars]`);
    expect(maskValue(new Uint8Array(10))).toBe("[OMITTED 10 bytes]");
  });

  it("masks error messages and keeps numbers, booleans and null", () => {
    expect(maskValue({ e: new Error("bad 27XUIXG0767D1ZP"), n: 3, b: true, z: null })).toEqual({
      e: { name: "Error", message: "bad 27XUIX******1ZP" },
      n: 3,
      b: true,
      z: null,
    });
  });

  it("does not modify the original object", () => {
    const original = { gstin: "27XUIXG0767D1ZP" };
    maskValue(original);
    expect(original.gstin).toBe("27XUIXG0767D1ZP");
  });
});
