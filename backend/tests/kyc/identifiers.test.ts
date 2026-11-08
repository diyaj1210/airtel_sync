import { describe, expect, it } from "vitest";
import {
  checkGstin,
  checkUdyam,
  cleanGstin,
  fixOcrGstin,
  fixOcrUdyam,
  gstinCheckChar,
  maskGstin,
  maskNumber,
  maskUdyam,
} from "../../src/kyc/identifiers.js";
import { loadRegistries } from "../../src/kyc/registry.js";

const registries = loadRegistries();

describe("GSTIN validator (checks 1-2)", () => {
  it("accepts every GSTIN in the mock registry: valid format, 4th PAN character X, mod-36 checksum", () => {
    expect(registries.gst.size).toBe(3534);
    for (const gstin of registries.gst.keys()) {
      expect(checkGstin(gstin), gstin).toEqual({ ok: true, value: gstin });
      expect(gstin[5]).toBe("X");
    }
  });

  it("computes the standard checksum", () => {
    // Known real-format example: 27AAPFU0939F1Z? -> V (published GSTN sample).
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
    expect(gstinCheckChar("27XUIXG0767D1Z")).toBe("P");
    expect(() => gstinCheckChar("short")).toThrow();
  });

  it.each([
    ["27XUIXG0767D1ZQ", "checksum"],
    ["08YKZXS8189L1ZO", "checksum"], // K06's certificate: one digit changed
    ["27XUIXG0767D1Z", "format"],
    ["27XUIXG0767D1YP", "format"], // 14th character must be Z
    ["27XUIX10767D1ZP", "format"],
    ["00XUIXG0767D1ZP", "state_code"],
    ["39XUIXG0767D1ZP", "state_code"],
    ["27XUIQG0767D1ZP", "pan_type"], // Q is not a PAN holder type
    ["", "format"],
  ])("rejects %s (%s)", (gstin, problem) => {
    expect(checkGstin(gstin)).toEqual({ ok: false, problem });
  });

  it("accepts real PAN holder types as well as X, and cleans what people type", () => {
    expect(checkGstin("27AAPFU0939F1ZV").ok).toBe(true); // F = firm
    expect(cleanGstin(" 27xuix g0767-d1zp ")).toBe("27XUIXG0767D1ZP");
    expect(checkGstin(" 27xuixg0767d1zp ")).toEqual({ ok: true, value: "27XUIXG0767D1ZP" });
  });

  it("fixes OCR O/0 and I/1 by position only, never globally", () => {
    expect(fixOcrGstin("19E0GXH4115Y1ZL")).toBe("19EOGXH4115Y1ZL"); // K02: letter O printed like 0
    expect(fixOcrGstin("24X0RXG9365M1Z3")).toBe("24XORXG9365M1Z3"); // K08
    expect(fixOcrGstin("27PZSXS1936O1ZH")).toBe("27PZSXS1936O1ZH"); // K04 registry: the O is a PAN letter
    expect(fixOcrGstin("2OXUIXGO767D1ZP")).toBe("20XUIXG0767D1ZP"); // digits read as O
    expect(fixOcrGstin("08YKZXS8189L1Z0")).toBe("08YKZXS8189L1Z0"); // K06 stays wrong: 8 is a real digit
    expect(checkGstin(fixOcrGstin("19E0GXH4115Y1ZL")).ok).toBe(true);
    expect(fixOcrGstin("too short")).toBe("TOOSHORT");
  });
});

describe("Udyam number (check 9)", () => {
  it("accepts every number in the mock registry, district 00 included", () => {
    expect(registries.udyam.size).toBe(2723);
    for (const n of registries.udyam.keys()) {
      expect(checkUdyam(n).ok, n).toBe(true);
      expect(n.slice(9, 11)).toBe("00");
    }
  });

  it.each(["UDYAM-MH-00-951669", "UDYAM-MH-0-9516696", "UDYAM-M1-00-9516696", "UDYAMMH009516696", ""])("rejects %s", (n) => {
    expect(checkUdyam(n)).toEqual({ ok: false, problem: "format" });
  });

  it("cleans typing and fixes OCR letters in the digit groups", () => {
    expect(checkUdyam(" udyam-mh-00-9516696 ")).toEqual({ ok: true, value: "UDYAM-MH-00-9516696" });
    expect(fixOcrUdyam("UDYAM-MH-OO-95I6696")).toBe("UDYAM-MH-00-9516696");
  });
});

describe("masks", () => {
  it("hides the middle of identifiers, keeping the length", () => {
    expect(maskGstin("27XUIXG0767D1ZP")).toBe("27XU********1ZP");
    expect(maskUdyam("UDYAM-MH-00-9516696")).toBe("UDYAM-**-**-***6696");
    expect(maskNumber("SYN-ID-447889")).toBe("SYN-ID-**7889");
    expect(maskNumber("12")).toBe("**");
    expect(maskGstin("odd")).toBe("***");
  });
});
