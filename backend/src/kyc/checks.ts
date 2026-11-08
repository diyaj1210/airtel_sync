/**
 * Smart KYC checks (solution_outline_chat/kyc-validation.md). Pure: the registries, the documents
 * as read by OCR and "today" are all passed in.
 *
 * Result:
 * - fix_needed     the owner can put it right (re-upload, a recent bill, the missing certificate ...)
 * - manual_review  a person must look (cancelled GSTIN, details that differ from the registry,
 *                  a signatory who is not the owner ...)
 * - pass           nothing blocking; soft warnings (e.g. Udyam registration date) may remain
 * Fixes come first: a reviewer only looks at a case once the owner has done their part. All
 * problems are listed either way.
 */
import { addDays } from "../clock.js";
import { DOC_TYPES, type DocType, type DocumentReading } from "./documents.js";
import { checkGstin, checkUdyam, fixOcrGstin, fixOcrUdyam } from "./identifiers.js";
import { addressesMatch, anyNameMatches, namesMatch, proprietorOf, simplifyAddress, simplifyName } from "./match.js";
import type { GstRecord, Registries, UdyamRecord } from "./registry.js";

export const ADDRESS_PROOF_MAX_DAYS = 90;

export interface BusinessDetails {
  /** The person applying (named on the consent and, normally, on the signatory ID). */
  applicantName: string;
  /** A valid GSTIN (format + checksum checked on entry), or null: the business has none. */
  gstin: string | null;
  hasUdyam: boolean;
  /** A Udyam number typed for lookup (format checked on entry), or null. */
  udyamNumber: string | null;
}

export type Severity = "fix" | "review" | "warning";
export type IssueCode =
  | "GSTIN_INACTIVE"
  | "GSTIN_NOT_FOUND"
  | "GSTIN_NOT_IN_REGISTRY"
  | "DOC_MISSING"
  | "DOC_UNREADABLE"
  | "DOC_WRONG_TYPE"
  | "DOC_NOT_NEEDED"
  | "CERT_GSTIN_MISMATCH"
  | "CERT_DETAILS_MISMATCH"
  | "UDYAM_NUMBER_BLANK"
  | "UDYAM_CERT_REJECTED"
  | "UDYAM_FORMAT"
  | "UDYAM_NUMBER_MISMATCH"
  | "UDYAM_NOT_FOUND"
  | "UDYAM_NAME_MISMATCH"
  | "UDYAM_STATE_MISMATCH"
  | "UDYAM_DATE_DIFFERS"
  | "UDYAM_ACTIVITY_DIFFERS"
  | "SIGNATORY_NOT_VERIFIED"
  | "ID_EXPIRED"
  | "ADDRESS_PROOF_TOO_OLD"
  | "BILL_DATE_IN_FUTURE"
  | "ADDRESS_MISMATCH"
  | "BILL_NAME_MISMATCH"
  // One-Sitting Completion (add-on): never blocking, shown so nothing is hidden.
  | "UDYAM_NOT_PROVIDED"
  | "CERT_GSTIN_CORRECTED"
  | "SIGNATORY_AUTHORISED";

/** Params never hold an identifier (GSTIN, Udyam, ID numbers): they are shown to the owner. */
export interface KycIssue {
  code: IssueCode;
  severity: Severity;
  doc?: DocType;
  params: Record<string, string | number | boolean>;
}

export type DocNeed = "required" | "optional" | "not_needed";
export type DocState = "not_uploaded" | "ok" | "problem" | "rejected";
export type GstinState = "active" | "cancelled" | "suspended" | "not_found" | "none";
export type KycStatus = "not_started" | "in_progress" | "pass" | "fix_needed" | "manual_review";

export interface KycEvaluation {
  status: KycStatus;
  /** Problems that change the result (severity fix or review). */
  issues: KycIssue[];
  /** Soft warnings shown to the reviewer; they never block. */
  warnings: KycIssue[];
  documents: Record<DocType, { need: DocNeed; state: DocState }>;
  gstin: GstinState;
  /** Products with requires_gstin = Y can be sold only with a valid, Active GSTIN. */
  gstinProductsAllowed: boolean;
  registry: { gst: GstRecord | null; udyam: UdyamRecord | null };
}

export interface KycInput {
  business: BusinessDetails | null;
  documents: Partial<Record<DocType, DocumentReading>>;
  /** The owner pressed "Check my documents": from then on a missing document is a problem. */
  submitted: boolean;
  /**
   * The owner confirmed (one tap, "Did you mean ...?") that the GSTIN printed on the certificate is
   * a misprint of their registered GSTIN: the certificate is then compared as if it showed that GSTIN.
   */
  certGstinConfirmed?: { printed: string; gstin: string } | null;
  /** The registered owner e-signed an authorisation for the person signing (MOCK link, K10). */
  signatoryAuthorised?: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: string | null): string | null {
  const v = (value ?? "").trim();
  if (!ISO_DATE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const sameText = (a: string | null, b: string | null) => !!a && !!b && simplifyName(a) === simplifyName(b);

export function evaluateKyc(input: KycInput, registries: Registries, today: string): KycEvaluation {
  const { business, documents } = input;
  const issues: KycIssue[] = [];
  const warnings: KycIssue[] = [];
  const need: Record<DocType, DocNeed> = {
    gst_certificate: "optional",
    udyam_certificate: "optional",
    signatory_id: "required",
    address_proof: "required",
  };
  const state = Object.fromEntries(DOC_TYPES.map((d) => [d, documents[d] ? "ok" : "not_uploaded"])) as Record<DocType, DocState>;
  const add = (code: IssueCode, severity: Severity, doc?: DocType, params: KycIssue["params"] = {}) => {
    (severity === "warning" ? warnings : issues).push({ code, severity, ...(doc ? { doc } : {}), params });
    if (doc && severity !== "warning") state[doc] = "problem";
  };
  const reject = (code: IssueCode, doc: DocType, params: KycIssue["params"] = {}) => {
    warnings.push({ code, severity: "warning", doc, params });
    state[doc] = "rejected";
  };

  if (!business) {
    return {
      status: "not_started",
      issues,
      warnings,
      documents: Object.fromEntries(DOC_TYPES.map((d) => [d, { need: need[d], state: state[d] }])) as KycEvaluation["documents"],
      gstin: "none",
      gstinProductsAllowed: false,
      registry: { gst: null, udyam: null },
    };
  }

  // ---- 1-3. GSTIN: valid on entry; registry lookup and status ----
  let gst: GstRecord | null = null;
  let gstinState: GstinState = "none";
  if (business.gstin) {
    gst = registries.gst.get(business.gstin) ?? null;
    gstinState = gst ? (gst.status.toLowerCase() as GstinState) : "not_found";
    // Not a KYC failure by itself: it blocks only products that need an Active GSTIN (checked
    // at checkout and by the readiness check, which offers the bundle without them).
    if (gst && gst.status !== "Active") add("GSTIN_INACTIVE", "warning", undefined, { status: gst.status });
  }
  // Lookup first, upload only what is missing: the certificate is needed only if the lookup failed.
  need.gst_certificate = business.gstin === null ? "not_needed" : gst ? "optional" : "required";
  // No catalogue product requires Udyam: it is optional, used only as extra verification.
  need.udyam_certificate = !business.hasUdyam ? "not_needed" : "optional";

  // ---- 10-11. Every uploaded document: the right kind, and readable ----
  const usable: Partial<Record<DocType, DocumentReading>> = {};
  for (const doc of DOC_TYPES) {
    const reading = documents[doc];
    if (!reading) continue;
    if (doc === "gst_certificate" && need.gst_certificate === "not_needed") {
      reject("DOC_NOT_NEEDED", doc);
    } else if (reading.detectedType && reading.detectedType !== doc) {
      add("DOC_WRONG_TYPE", "fix", doc, { detected: reading.detectedType });
    } else if (!reading.readable) {
      add("DOC_UNREADABLE", "fix", doc);
    } else {
      usable[doc] = reading;
    }
  }
  const field = (doc: DocType, name: string): string | null => usable[doc]?.fields[name]?.value?.trim() || null;

  // ---- GST certificate against the entered GSTIN and the registry (tampering) ----
  let certAgrees = false;
  if (usable.gst_certificate && business.gstin) {
    const certGstin = fixOcrGstin(field("gst_certificate", "gstin") ?? "");
    const confirmed = input.certGstinConfirmed;
    const corrected = certGstin !== business.gstin && !!confirmed && confirmed.printed === certGstin && confirmed.gstin === business.gstin;
    if (corrected) add("CERT_GSTIN_CORRECTED", "warning", "gst_certificate");
    if (certGstin !== business.gstin && !corrected) {
      add("CERT_GSTIN_MISMATCH", "fix", "gst_certificate", { checksumValid: checkGstin(certGstin).ok });
    } else {
      certAgrees = true;
      if (gst) {
        const compare: [string, string, (a: string | null, b: string | null) => boolean][] = [
          ["legalName", gst.legalName, namesMatch],
          ["tradeName", gst.tradeName, namesMatch],
          ["constitution", gst.constitution, sameText],
          ["address", gst.address, addressesMatch],
        ];
        for (const [name, registryValue, matches] of compare) {
          const printed = field("gst_certificate", name);
          if (printed && !matches(printed, registryValue)) add("CERT_DETAILS_MISMATCH", "review", "gst_certificate", { field: name });
        }
      }
    }
  }
  if (business.gstin && !gst) {
    if (certAgrees) add("GSTIN_NOT_IN_REGISTRY", "review", "gst_certificate");
    else if (!documents.gst_certificate) add("GSTIN_NOT_FOUND", "fix");
  }

  // What we know about the business: the registry first, the matching certificate otherwise.
  const fromCert = (name: string) => (certAgrees ? field("gst_certificate", name) : null);
  const legalName = gst?.legalName ?? fromCert("legalName");
  const tradeName = gst?.tradeName ?? fromCert("tradeName");
  const constitution = gst?.constitution ?? fromCert("constitution");
  const gstAddress = gst?.address ?? fromCert("address");

  // ---- 9. Udyam ----
  let udyamNumber = business.udyamNumber;
  let udyamFromCert = false;
  if (usable.udyam_certificate) {
    const printed = field("udyam_certificate", "udyamNumber");
    if (!printed) {
      // A certificate without a registration number proves nothing (K01).
      if (business.hasUdyam && !business.udyamNumber) add("UDYAM_NUMBER_BLANK", "warning", "udyam_certificate");
      else reject("UDYAM_CERT_REJECTED", "udyam_certificate", { reason: "blank_number" });
    } else {
      const fixed = fixOcrUdyam(printed);
      // Udyam is optional: its problems are shown, never blocking.
      if (!checkUdyam(fixed).ok) add("UDYAM_FORMAT", "warning", "udyam_certificate");
      else if (business.udyamNumber && fixed !== business.udyamNumber) add("UDYAM_NUMBER_MISMATCH", "warning", "udyam_certificate");
      else if (!business.udyamNumber) {
        udyamNumber = fixed;
        udyamFromCert = true;
      }
    }
  }
  let udyam: UdyamRecord | null = null;
  if (udyamNumber) {
    udyam = registries.udyam.get(udyamNumber) ?? null;
    if (!udyam) {
      add("UDYAM_NOT_FOUND", "warning", udyamFromCert ? "udyam_certificate" : undefined, { source: udyamFromCert ? "certificate" : "entered" });
    } else {
      if ((legalName || tradeName) && !anyNameMatches(udyam.enterpriseName, [tradeName, legalName])) {
        add("UDYAM_NAME_MISMATCH", "warning");
      }
      if (gst && simplifyName(udyam.state) !== simplifyName(gst.state)) add("UDYAM_STATE_MISMATCH", "warning");
      const certNumber = fixOcrUdyam(field("udyam_certificate", "udyamNumber") ?? "");
      if (usable.udyam_certificate && certNumber === udyamNumber) {
        const printedName = field("udyam_certificate", "enterpriseName");
        if (printedName && !namesMatch(printedName, udyam.enterpriseName)) {
          add("CERT_DETAILS_MISMATCH", "warning", "udyam_certificate", { field: "enterpriseName" });
        }
        for (const [name, registryValue] of [["state", udyam.state], ["city", udyam.city]] as const) {
          const printed = field("udyam_certificate", name);
          if (printed && !sameText(printed, registryValue)) add("CERT_DETAILS_MISMATCH", "warning", "udyam_certificate", { field: name });
        }
        // Soft only: the registration date differs on every certificate in this data, clean ones too.
        const printedDate = field("udyam_certificate", "registrationDate");
        if (printedDate && printedDate !== udyam.registrationDate) {
          add("UDYAM_DATE_DIFFERS", "warning", "udyam_certificate", { certificate: printedDate, registry: udyam.registrationDate });
        }
        const activity = field("udyam_certificate", "majorActivity");
        if (activity && !sameText(activity, udyam.majorActivity)) {
          add("UDYAM_ACTIVITY_DIFFERS", "warning", "udyam_certificate", { certificate: activity, registry: udyam.majorActivity });
        }
      }
    }
  }

  // ---- 7-8. Signatory ID: valid, and the right person ----
  const proprietor = constitution && simplifyName(constitution) === "proprietorship" ? proprietorOf(legalName) : null;
  if (usable.signatory_id) {
    const validTill = isoDate(field("signatory_id", "validTill"));
    if (!validTill) add("DOC_UNREADABLE", "fix", "signatory_id", { field: "validTill" });
    else if (validTill <= today) add("ID_EXPIRED", "fix", "signatory_id", { validTill });
    const name = field("signatory_id", "name");
    if (!anyNameMatches(name, [business.applicantName, proprietor])) {
      // For an LLP / company the legal name has no person: the applicant's name decides (K10).
      if (input.signatoryAuthorised) add("SIGNATORY_AUTHORISED", "warning", "signatory_id");
      else add("SIGNATORY_NOT_VERIFIED", "review", "signatory_id", { constitution: constitution ?? "unknown", hasProprietor: proprietor !== null });
    }
  }

  // ---- 4-6. Address proof: recent, same address, same business ----
  if (usable.address_proof) {
    const billDate = isoDate(field("address_proof", "billDate"));
    const oldest = addDays(today, -ADDRESS_PROOF_MAX_DAYS);
    if (!billDate) add("DOC_UNREADABLE", "fix", "address_proof", { field: "billDate" });
    else if (billDate > today) add("BILL_DATE_IN_FUTURE", "review", "address_proof", { billDate });
    else if (billDate < oldest) {
      add("ADDRESS_PROOF_TOO_OLD", "fix", "address_proof", { billDate, ageDays: daysBetween(billDate, today), maxDays: ADDRESS_PROOF_MAX_DAYS });
    }
    const address = field("address_proof", "address");
    if (gstAddress) {
      if (!addressesMatch(address, gstAddress)) add("ADDRESS_MISMATCH", "fix", "address_proof", { against: "gst" });
    } else if (udyam && !simplifyAddress(address ?? "").includes(simplifyAddress(udyam.city))) {
      add("ADDRESS_MISMATCH", "fix", "address_proof", { against: "udyam" });
    }
    const billedTo = field("address_proof", "billedTo");
    if (!anyNameMatches(billedTo, [tradeName, legalName, proprietor, business.applicantName, udyam?.enterpriseName])) {
      add("BILL_NAME_MISMATCH", "review", "address_proof");
    }
  }

  // ---- 10. Completeness ----
  let waiting = false;
  for (const doc of DOC_TYPES) {
    if (need[doc] !== "required" || documents[doc]) continue;
    if (doc === "gst_certificate") continue; // reported as GSTIN_NOT_FOUND above
    if (input.submitted) add("DOC_MISSING", "fix", doc);
    else waiting = true;
  }
  // Udyam said "yes" but neither a number nor a certificate: optional, so only a suggestion (K05).
  if (business.hasUdyam && !business.udyamNumber && !documents.udyam_certificate) add("UDYAM_NOT_PROVIDED", "warning");
  if (!input.submitted && business.gstin && !gst && !documents.gst_certificate) waiting = true;

  const status: KycStatus = waiting
    ? "in_progress"
    : issues.some((i) => i.severity === "fix")
      ? "fix_needed"
      : issues.some((i) => i.severity === "review")
        ? "manual_review"
        : "pass";

  return {
    status,
    issues,
    warnings,
    documents: Object.fromEntries(DOC_TYPES.map((d) => [d, { need: need[d], state: state[d] }])) as KycEvaluation["documents"],
    gstin: gstinState,
    gstinProductsAllowed: gstinState === "active",
    registry: { gst, udyam },
  };
}
