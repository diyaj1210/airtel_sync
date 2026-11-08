import { describe, expect, it } from "vitest";
import { TODAY } from "../../src/clock.js";
import { evaluateKyc, type IssueCode, type KycStatus } from "../../src/kyc/checks.js";
import type { SampleApplicant } from "../../src/kyc/samples.js";
import { registries, sampleDocuments, samples } from "./helpers.js";

/**
 * K01-K12: the expected results in solution_outline_chat/kyc-validation.md, one test each.
 * The documents are what the OCR really reads from data/raw/kyc_documents (see helpers.ts).
 */

function run(id: string, overrides: Partial<{ udyamNumber: string | null; applicantName: string }> = {}) {
  const s: SampleApplicant = samples.get(id)!;
  return evaluateKyc(
    {
      business: {
        applicantName: overrides.applicantName ?? s.applicantName,
        gstin: s.gstin,
        hasUdyam: s.hasUdyam,
        udyamNumber: overrides.udyamNumber ?? null,
      },
      documents: sampleDocuments(id),
      submitted: true,
    },
    registries,
    TODAY,
  );
}

const codes = (list: { code: IssueCode }[]) => list.map((i) => i.code);
const CLEAN_WARNINGS = ["UDYAM_DATE_DIFFERS"];

function expectResult(id: string, status: KycStatus, issues: IssueCode[]) {
  const r = run(id);
  expect(r.status, id).toBe(status);
  expect(codes(r.issues), id).toEqual(issues);
  return r;
}

describe("sample applicants K01-K12 (kyc-validation.md)", () => {
  it("has all 12 applicants with their leads and documents", () => {
    expect([...samples.keys()]).toEqual(["K01", "K02", "K03", "K04", "K05", "K06", "K07", "K08", "K09", "K10", "K11", "K12"]);
    expect(samples.get("K05")!.documents).toEqual(["gst_certificate", "signatory_id", "address_proof"]);
    for (const s of samples.values()) if (s.id !== "K05") expect(s.documents).toHaveLength(4);
  });

  it("K01 Vindhya Tours & Travels: cancelled GSTIN -> blocked, manual review; blank Udyam certificate rejected", () => {
    const r = expectResult("K01", "manual_review", ["GSTIN_INACTIVE"]);
    expect(r.issues[0]!.params).toEqual({ status: "Cancelled" });
    expect(r.gstin).toBe("cancelled");
    expect(r.gstinProductsAllowed).toBe(false);
    expect(r.documents.udyam_certificate).toEqual({ need: "not_needed", state: "rejected" });
    expect(r.warnings).toContainEqual({ code: "UDYAM_CERT_REJECTED", severity: "warning", doc: "udyam_certificate", params: { reason: "blank_number" } });
  });

  it("K02 Harmony Dental Care: rotated GST certificate read after straightening -> pass", () => {
    const r = expectResult("K02", "pass", []);
    expect(codes(r.warnings)).toEqual(CLEAN_WARNINGS);
    expect(r.gstinProductsAllowed).toBe(true);
    // The certificate prints "E0" where the registry has the letter O: fixed by position.
    expect(sampleDocuments("K02").gst_certificate!.fields.gstin!.value).toBe("19E0GXH4115Y1ZL");
  });

  it("K03 Ganesh Woodcraft: nothing wrong -> pass", () => {
    const r = expectResult("K03", "pass", []);
    expect(codes(r.warnings)).toEqual(CLEAN_WARNINGS);
  });

  it("K04 Saffron Dental Care LLP: blurred GST certificate -> fix needed, re-upload", () => {
    const r = expectResult("K04", "fix_needed", ["DOC_UNREADABLE"]);
    expect(r.issues[0]).toEqual({ code: "DOC_UNREADABLE", severity: "fix", doc: "gst_certificate", params: {} });
    expect(r.gstin).toBe("active"); // the registry still knows the GSTIN
  });

  it("K05 Balaji Realty LLP: Udyam certificate missing -> fix needed (upload it or enter the number)", () => {
    const r = expectResult("K05", "fix_needed", ["DOC_MISSING"]);
    expect(r.issues[0]).toEqual({ code: "DOC_MISSING", severity: "fix", doc: "udyam_certificate", params: { orNumber: true } });
    // ... and entering the lead's Udyam number for lookup instead clears it.
    const fixed = run("K05", { udyamNumber: "UDYAM-KL-00-5521886" });
    expect(fixed.status).toBe("pass");
    expect(fixed.registry.udyam?.enterpriseName).toBe("Balaji Realty LLP");
  });

  it("K06 Saffron Unisex Salon: GSTIN on the certificate fails the checksum and differs -> fix needed", () => {
    const r = expectResult("K06", "fix_needed", ["CERT_GSTIN_MISMATCH"]);
    expect(r.issues[0]!.params).toEqual({ checksumValid: false });
    expect(codes(r.warnings)).toEqual(["UDYAM_DATE_DIFFERS", "UDYAM_ACTIVITY_DIFFERS"]);
  });

  it("K07 Neelgiri Physio Clinic: legal name on the certificate differs from the registry -> manual review", () => {
    const r = expectResult("K07", "manual_review", ["CERT_DETAILS_MISMATCH"]);
    expect(r.issues[0]).toEqual({ code: "CERT_DETAILS_MISMATCH", severity: "review", doc: "gst_certificate", params: { field: "legalName" } });
  });

  it("K08 Green Leaf Legal Associates: nothing wrong -> pass (registry GSTIN has the letter O)", () => {
    expectResult("K08", "pass", []);
  });

  it("K09 Kaveri Insurance Advisors: nothing wrong -> pass", () => {
    expectResult("K09", "pass", []);
  });

  it("K10 Kaveri Stays LLP: signatory is not the applicant, LLP has no person to match -> manual review", () => {
    const r = expectResult("K10", "manual_review", ["SIGNATORY_NOT_VERIFIED"]);
    expect(r.issues[0]!.params).toEqual({ constitution: "Limited Liability Partnership", hasProprietor: false });
    expect(codes(r.warnings)).toEqual(["UDYAM_DATE_DIFFERS", "UDYAM_ACTIVITY_DIFFERS"]);
  });

  it("K11 Trinity Bake House Pvt Ltd: electricity bill 257 days old -> fix needed, recent address proof", () => {
    const r = expectResult("K11", "fix_needed", ["ADDRESS_PROOF_TOO_OLD"]);
    expect(r.issues[0]!.params).toEqual({ billDate: "2025-10-31", ageDays: 257, maxDays: 90 });
  });

  it("K12 Star Electronics: only soft warnings -> pass", () => {
    const r = expectResult("K12", "pass", []);
    expect(codes(r.warnings)).toEqual(["UDYAM_DATE_DIFFERS", "UDYAM_ACTIVITY_DIFFERS"]);
  });

  it("Udyam registration date differs on all 10 certificates with a number, and stays a soft warning", () => {
    const withDateWarning = [...samples.keys()].filter((id) => run(id).warnings.some((w) => w.code === "UDYAM_DATE_DIFFERS"));
    expect(withDateWarning).toEqual(["K02", "K03", "K04", "K06", "K07", "K08", "K09", "K10", "K11", "K12"]);
    const activity = [...samples.keys()].filter((id) => run(id).warnings.some((w) => w.code === "UDYAM_ACTIVITY_DIFFERS"));
    expect(activity).toEqual(["K06", "K10", "K11", "K12"]);
  });
});
