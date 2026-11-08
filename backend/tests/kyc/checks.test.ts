import { describe, expect, it } from "vitest";
import { TODAY } from "../../src/clock.js";
import { evaluateKyc, type BusinessDetails, type IssueCode } from "../../src/kyc/checks.js";
import type { DocType, DocumentReading } from "../../src/kyc/documents.js";
import { registries, sampleDocuments, samples } from "./helpers.js";

/** Edge cases beyond K01-K12: start from a clean sample (K03 or K10) and change one fact. */

type Docs = Partial<Record<DocType, DocumentReading>>;

function clean(id = "K03"): { business: BusinessDetails; docs: Docs } {
  const s = samples.get(id)!;
  return {
    business: { applicantName: s.applicantName, gstin: s.gstin, hasUdyam: s.hasUdyam, udyamNumber: null },
    docs: structuredClone(sampleDocuments(id)),
  };
}

function set(docs: Docs, doc: DocType, field: string, value: string | null) {
  docs[doc]!.fields[field] = { value, confidence: value === null ? null : 0.99, labelFound: true };
}

function check(business: BusinessDetails | null, docs: Docs, submitted = true, today = TODAY) {
  return evaluateKyc({ business, documents: docs, submitted }, registries, today);
}

const codes = (r: { issues: { code: IssueCode }[] }) => r.issues.map((i) => i.code);

describe("KYC checks: flow states", () => {
  it("not started until the business details are given", () => {
    const r = check(null, {});
    expect(r.status).toBe("not_started");
    expect(r.documents.signatory_id).toEqual({ need: "required", state: "not_uploaded" });
  });

  it("in progress while required documents are still coming; after submit they are missing", () => {
    const { business } = clean();
    expect(check(business, {}, false).status).toBe("in_progress");
    const r = check(business, {}, true);
    expect(r.status).toBe("fix_needed");
    // Udyam is optional (no product needs it): only a suggestion, never a missing document.
    expect(r.issues.map((i) => `${i.code}:${i.doc}`)).toEqual(["DOC_MISSING:signatory_id", "DOC_MISSING:address_proof"]);
    expect(r.warnings.map((w) => w.code)).toEqual(["UDYAM_NOT_PROVIDED"]);
  });

  it("lookup first: with a found GSTIN the GST certificate is optional, and a typed Udyam number replaces its certificate", () => {
    const { business, docs } = clean();
    delete docs.gst_certificate;
    delete docs.udyam_certificate;
    const r = check({ ...business, udyamNumber: "UDYAM-MH-00-9516696" }, docs);
    expect(r.status).toBe("pass");
    expect(r.documents.gst_certificate.need).toBe("optional");
    expect(r.documents.udyam_certificate.need).toBe("optional");
    expect(r.registry.udyam?.enterpriseName).toBe("Ganesh Woodcraft");
  });
});

describe("KYC checks: GSTIN", () => {
  it("a suspended GSTIN blocks GSTIN-only products (a warning, not a KYC failure on its own)", () => {
    const suspended = [...registries.gst.values()].find((g) => g.status === "Suspended")!;
    const r = check({ applicantName: "Test Person", gstin: suspended.gstin, hasUdyam: false, udyamNumber: null }, {}, false);
    expect(r.gstin).toBe("suspended");
    expect(r.gstinProductsAllowed).toBe(false);
    expect(r.issues).toEqual([]);
    expect(r.warnings).toContainEqual({ code: "GSTIN_INACTIVE", severity: "warning", params: { status: "Suspended" } });
  });

  it("a valid GSTIN missing from the registry: fix (check it or upload the certificate); with a matching certificate: review", () => {
    const { business, docs } = clean();
    const unknown = "27AAPFU0939F1ZV"; // valid checksum, not in the mock registry
    delete docs.gst_certificate;
    const r = check({ ...business, gstin: unknown }, docs);
    expect(r.gstin).toBe("not_found");
    expect(r.documents.gst_certificate.need).toBe("required");
    expect(codes(r)).toContain("GSTIN_NOT_FOUND");
    expect(check({ ...business, gstin: unknown }, docs, false).status).toBe("in_progress");

    const withCert = structuredClone(sampleDocuments("K03"));
    set(withCert, "gst_certificate", "gstin", unknown);
    const r2 = check({ ...business, gstin: unknown }, withCert);
    expect(codes(r2)).toContain("GSTIN_NOT_IN_REGISTRY");
    expect(codes(r2)).not.toContain("GSTIN_NOT_FOUND");
  });

  it("no GSTIN: the certificate is not needed, GSTIN products are blocked, an uploaded one is set aside", () => {
    const { business, docs } = clean();
    const r = check({ ...business, gstin: null }, docs);
    expect(r.gstin).toBe("none");
    expect(r.gstinProductsAllowed).toBe(false);
    expect(r.documents.gst_certificate).toEqual({ need: "not_needed", state: "rejected" });
    expect(r.warnings.map((w) => w.code)).toContain("DOC_NOT_NEEDED");
    expect(r.status).toBe("pass");
  });

  it("a certificate that agrees on the GSTIN but differs on the trade name, constitution or address -> review", () => {
    for (const [field, value] of [
      ["tradeName", "Ganesh Furniture Mart"],
      ["constitution", "Private Limited Company"],
      ["address", "Shop/Unit 99, MG Road, Pune, Maharashtra - 411001"],
    ] as const) {
      const { business, docs } = clean();
      set(docs, "gst_certificate", field, value);
      const r = check(business, docs);
      expect(r.status, field).toBe("manual_review");
      expect(r.issues, field).toEqual([{ code: "CERT_DETAILS_MISMATCH", severity: "review", doc: "gst_certificate", params: { field } }]);
    }
  });
});

describe("KYC checks: documents", () => {
  it("the wrong document in a slot -> fix", () => {
    const { business, docs } = clean();
    docs.address_proof = { ...docs.signatory_id!, docType: "address_proof" };
    const r = check(business, docs);
    expect(r.issues).toContainEqual({ code: "DOC_WRONG_TYPE", severity: "fix", doc: "address_proof", params: { detected: "signatory_id" } });
    expect(r.documents.address_proof.state).toBe("problem");
  });

  it("ID valid till must be after today (2026-07-15)", () => {
    for (const [validTill, expired] of [["2026-07-15", true], ["2026-07-16", false], ["2025-01-01", true]] as const) {
      const { business, docs } = clean();
      set(docs, "signatory_id", "validTill", validTill);
      const r = check(business, docs);
      expect(codes(r).includes("ID_EXPIRED"), validTill).toBe(expired);
    }
    const { business, docs } = clean();
    set(docs, "signatory_id", "validTill", "31/12/2029");
    expect(check(business, docs).issues).toContainEqual({ code: "DOC_UNREADABLE", severity: "fix", doc: "signatory_id", params: { field: "validTill" } });
  });

  it("address proof at most 90 days old: 2026-04-16 is fine, 2026-04-15 is too old, a future date goes to review", () => {
    const at = (billDate: string) => {
      const { business, docs } = clean();
      set(docs, "address_proof", "billDate", billDate);
      return check(business, docs);
    };
    expect(at("2026-04-16").status).toBe("pass");
    expect(at("2026-04-15").issues).toEqual([
      { code: "ADDRESS_PROOF_TOO_OLD", severity: "fix", doc: "address_proof", params: { billDate: "2026-04-15", ageDays: 91, maxDays: 90 } },
    ]);
    expect(at("2026-07-15").status).toBe("pass");
    expect(codes(at("2026-07-16"))).toEqual(["BILL_DATE_IN_FUTURE"]);
    expect(codes(at("2026-02-30"))).toEqual(["DOC_UNREADABLE"]);
    // "Today" is a parameter, never the system clock.
    const { business, docs } = clean();
    expect(check(business, docs, true, "2026-12-31").issues.map((i) => i.code)).toEqual(["ADDRESS_PROOF_TOO_OLD"]);
  });

  it("bill for another address -> fix; billed to another business -> review", () => {
    let { business, docs } = clean();
    set(docs, "address_proof", "address", "Shop/Unit 12, Civil Lines, Nagpur, Maharashtra - 400001");
    expect(check(business, docs).issues).toEqual([{ code: "ADDRESS_MISMATCH", severity: "fix", doc: "address_proof", params: { against: "gst" } }]);
    ({ business, docs } = clean());
    set(docs, "address_proof", "billedTo", "Sunrise Textiles");
    expect(codes(check(business, docs))).toEqual(["BILL_NAME_MISMATCH"]);
    // The proprietor's own name on the bill is fine.
    ({ business, docs } = clean());
    set(docs, "address_proof", "billedTo", "Joseph Singh");
    expect(check(business, docs).status).toBe("pass");
  });

  it("signatory: the proprietor or the applicant may sign; anyone else goes to review", () => {
    let { business, docs } = clean(); // K03: proprietorship of Joseph Singh
    expect(check({ ...business, applicantName: "Someone Else" }, docs).status).toBe("pass"); // ID = proprietor
    ({ business, docs } = clean());
    set(docs, "signatory_id", "name", "Ravi Kumar");
    expect(check(business, docs).issues).toEqual([
      { code: "SIGNATORY_NOT_VERIFIED", severity: "review", doc: "signatory_id", params: { constitution: "Proprietorship", hasProprietor: true } },
    ]);
    // K10 (LLP): fine when the ID's person is the applicant.
    const k10 = clean("K10");
    expect(check({ ...k10.business, applicantName: "Nisha Arora" }, k10.docs).status).toBe("pass");
  });
});

describe("KYC checks: Udyam", () => {
  it("a certificate with a blank number when the business says it has Udyam -> caught, but optional (warning)", () => {
    const { business, docs } = clean();
    set(docs, "udyam_certificate", "udyamNumber", null);
    const r = check(business, docs);
    expect(r.status).toBe("pass");
    expect(r.warnings).toContainEqual({ code: "UDYAM_NUMBER_BLANK", severity: "warning", doc: "udyam_certificate", params: {} });
  });

  const warned = (r: { warnings: { code: IssueCode }[] }) => r.warnings.map((w) => w.code);

  it("typed number and certificate disagree, number not in the registry, unreadable number -> caught as warnings (Udyam is optional)", () => {
    let { business, docs } = clean();
    let r = check({ ...business, udyamNumber: "UDYAM-MH-00-1234567" }, docs);
    expect(warned(r)).toContain("UDYAM_NUMBER_MISMATCH");
    expect(r.status).toBe("pass");
    ({ business, docs } = clean());
    set(docs, "udyam_certificate", "udyamNumber", "UDYAM-MH-00-1234567");
    r = check(business, docs);
    expect(r.issues).toEqual([]);
    expect(r.warnings).toContainEqual({ code: "UDYAM_NOT_FOUND", severity: "warning", doc: "udyam_certificate", params: { source: "certificate" } });
    ({ business, docs } = clean());
    set(docs, "udyam_certificate", "udyamNumber", "UDYAM-MH-0-95");
    expect(warned(check(business, docs))).toContain("UDYAM_FORMAT");
  });

  it("a Udyam number of another business, or a tampered certificate name -> caught and shown to the reviewer, not blocking", () => {
    let { business, docs } = clean();
    delete docs.udyam_certificate;
    const other = [...registries.udyam.values()].find((u) => u.state === "Maharashtra" && u.enterpriseName !== "Ganesh Woodcraft")!;
    expect(warned(check({ ...business, udyamNumber: other.udyamNumber }, docs))).toContain("UDYAM_NAME_MISMATCH");
    const elsewhere = [...registries.udyam.values()].find((u) => u.state !== "Maharashtra")!;
    expect(warned(check({ ...business, udyamNumber: elsewhere.udyamNumber }, docs))).toContain("UDYAM_STATE_MISMATCH");
    ({ business, docs } = clean());
    set(docs, "udyam_certificate", "enterpriseName", "Ganesh Steel Works");
    const r = check(business, docs);
    expect(r.issues).toEqual([]);
    expect(r.warnings).toContainEqual({ code: "CERT_DETAILS_MISMATCH", severity: "warning", doc: "udyam_certificate", params: { field: "enterpriseName" } });
  });

  it("an OCR slip in the Udyam number (O for 0) is fixed by position", () => {
    const { business, docs } = clean();
    set(docs, "udyam_certificate", "udyamNumber", "UDYAM-MH-OO-95I6696");
    expect(check(business, docs).status).toBe("pass");
  });
});
