/** Types and calls for the Smart KYC API (backend/src/kyc). Identifiers arrive masked. */
import type { Lang } from "../i18n/I18nProvider";
import { withReferral } from "../referral";

export const DOC_TYPES = ["gst_certificate", "udyam_certificate", "signatory_id", "address_proof"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Must match backend/src/kyc/store.ts CONSENT_VERSION (checked by a test). */
export const CONSENT_VERSION = "kyc-consent-v2";
/** Every purpose KYC needs, named separately (must match backend CONSENT_PURPOSES). */
export const CONSENT_PURPOSES = ["identity_verification", "product_eligibility", "order_activation", "electronic_signing", "manual_review"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export const ACCEPTED_IMAGES = "image/png,image/jpeg,image/webp";
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** "rejected": a reviewer did not approve a manual-review case (back-office). */
export type KycStatus = "not_started" | "in_progress" | "pass" | "fix_needed" | "manual_review" | "rejected";
export type Severity = "fix" | "review" | "warning";

export interface KycIssue {
  code: string;
  severity: Severity;
  doc?: DocType;
  params: Record<string, string | number | boolean>;
}

export interface DocumentView {
  need: "required" | "optional" | "not_needed";
  state: "not_uploaded" | "ok" | "problem" | "rejected";
  uploaded: boolean;
  /** Key details read from the document (identifiers masked), when it could be read. */
  read: Record<string, string | null> | null;
}

export interface KycCase {
  caseId: string;
  consent: { id?: string; version: string; acceptedOn: string; purposes?: ConsentPurpose[]; marketing?: boolean; channel?: string };
  quoteId: string | null;
  sampleId: string | null;
  business: { applicantName: string; gstin: string | null; hasUdyam: boolean; udyamNumber: string | null } | null;
  registry: {
    gst: { gstin: string; legalName: string; tradeName: string; constitution: string; address: string; state: string; status: string } | null;
    udyam: { udyamNumber: string; enterpriseName: string; majorActivity: string; city: string; state: string } | null;
  };
  documents: Record<DocType, DocumentView>;
  result: {
    status: KycStatus;
    issues: KycIssue[];
    warnings: KycIssue[];
    gstin: "active" | "cancelled" | "suspended" | "not_found" | "none";
    gstinProductsAllowed: boolean;
    blockedProducts: { productId: string; name: string }[];
    /** A reviewer's decision on a manual-review case, or null. */
    review: { decision: "approved" | "rejected"; on: string; note: string | null } | null;
  };
  submitted: boolean;
  esign: { started: boolean; signed: { reference: string; signedOn: string; documentHash: string } | null } | null;
  orderId?: string | null;
  /** One-Sitting Completion (null before the business details, and after withdrawal). */
  readiness?: Readiness | null;
  /** Problems already sorted out (by the owner or the system, or waived by staff). */
  blockerHistory?: Blocker[];
  withdrawn?: { on: string; cancelled: boolean } | null;
}

export type ReadinessState = "NOT_CURRENTLY_POSSIBLE" | "PARTNER_ASSISTANCE_RECOMMENDED" | "NEEDS_REVIEW" | "ALMOST_READY" | "READY";
export type RequirementGroup = "business" | "gstin" | "signatory" | "address" | "feasibility";
export interface Bilingual {
  en: string;
  hi: string;
}

export interface Blocker {
  id: string;
  category: string;
  customerMessage: Bilingual;
  requiredAction: Bilingual;
  actionType: "upload" | "confirm" | "choose_alternative" | "send_esign_link" | "wait_review" | "contact_partner";
  responsibleParty: "customer" | "accel_ops" | "partner" | "installer";
  status: "open" | "in_progress" | "resolved" | "waived";
  expectedResolution: Bilingual;
  alternative?: { kind: string; bundle: string; monthlyInr: number; setupInr: number; removed: string[]; added: string[] };
  doc?: DocType;
  suggestion?: { gstinMasked: string; legalName: string };
  question?: Bilingual;
  answer?: string | null;
  hard: boolean;
  openedOn: string;
  resolvedOn: string | null;
  resolvedBy: "auto" | "staff" | null;
}

export interface Readiness {
  state: ReadinessState;
  percent: number;
  verified: number;
  applicable: number;
  remaining: RequirementGroup[];
  optional: "udyam"[];
  found: { key: "businessName" | "gstin" | "location" | "businessType"; value: string }[];
  documentsToUpload: DocType[];
  expectedMinutes: number;
  after: { bundle: string; product: string; days: number; readyOn: string } | null;
  feasibility: { mock: true; known: boolean; city: string | null; fibre: boolean | null };
  partner: { code: string; name: string } | null;
  blockers: Blocker[];
  alternative: { kind: string; bundle: string; state: ReadinessState } | null;
  bundle: string | null;
  reviewWithinHours: number;
}

export interface Lookup {
  mock: true;
  registry: {
    gst: { gstin: string; legalName: string; tradeName: string; constitution: string; address: string; state: string; status: string } | null;
    udyam: { udyamNumber: string; enterpriseName: string; city: string; state: string } | null;
  };
  gstin: string;
  documents: Record<DocType, "required" | "optional" | "not_needed">;
  documentsNeeded: DocType[];
  documentsNotNeeded: number;
  readiness: Readiness | null;
}

export interface Retention {
  status: string;
  rawDocumentDaysAfterVerification: number;
  verificationResultYearsAfterContract: number;
  consentRecordYearsAfterContract: number;
  unfinishedApplicationDays: number;
}

export interface MyData {
  caseId: string;
  status: "active" | "withdrawn" | "cancelled";
  consent: { id: string; noticeVersion: string; acceptedOn: string; purposes: ConsentPurpose[]; marketing: boolean; channel: "app" | "whatsapp"; withdrawnOn: string | null };
  held: { applicantName: string; gstin: string | null; udyamNumber: string | null; hasUdyam: boolean; verificationResult: KycStatus | null } | null;
  documents: { doc: DocType; storedOn: string; encrypted: true; deleteDueOn: string | null; daysLeft: number | null; deletedOn: string | null; detailsKept: boolean }[];
  deletionLog: { what: DocType | "all_kyc_data"; deletedOn: string; reason: "retention" | "owner_request" | "withdrawal" | "replaced" }[];
  retention: Retention;
  orderId: string | null;
  openBlockers: number;
}

export interface BusinessInput {
  applicantName: string;
  gstin: string | null;
  hasUdyam: boolean;
  udyamNumber: string | null;
}

export interface Agreement {
  caseId: string;
  business: string;
  gstin: string | null;
  signatory: string;
  quote: { quoteId: string; bundle: string; monthlyInr: number; setupInr: number; contractMonths: number } | null;
  consentVersion: string;
  date: string;
}

export interface Sample {
  id: string;
  businessName: string;
  documents: DocType[];
}

/** A refused request: HTTP status + the server's error code (+ field problems for a form). */
export class KycError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: { field: string; problem: string }[] = [],
    readonly attemptsLeft?: number,
  ) {
    super(code);
  }
}

type FetchFn = typeof fetch;

async function send<T>(fetchFn: FetchFn, method: string, url: string, body?: unknown, image?: { bytes: Uint8Array<ArrayBuffer>; type: string }): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method,
      headers: image
        ? { "content-type": image.type, accept: "application/json" }
        : body === undefined
          ? { accept: "application/json" }
          : { "content-type": "application/json", accept: "application/json" },
      ...(image ? { body: image.bytes } : body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new KycError(0, "network");
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    if (res.ok) throw new KycError(res.status, "bad_response");
  }
  if (!res.ok) {
    throw new KycError(
      res.status,
      typeof data.error === "string" ? data.error : `http_${res.status}`,
      Array.isArray(data.details) ? (data.details as { field: string; problem: string }[]) : [],
      typeof data.attemptsLeft === "number" ? data.attemptsLeft : undefined,
    );
  }
  return data as T;
}

const caseUrl = (id: string) => `/api/kyc/cases/${encodeURIComponent(id)}`;

export const startKyc = (lang: Lang, quoteId: string | null, fetchFn: FetchFn = fetch, marketing = false) =>
  send<KycCase>(
    fetchFn,
    "POST",
    "/api/kyc/cases",
    withReferral({ consent: { accepted: true, version: CONSENT_VERSION, purposes: [...CONSENT_PURPOSES], marketing }, lang, ...(quoteId ? { quoteId } : {}) }),
  );

/** Lookup first: what the registries know and which documents are still needed (before consent; nothing is stored). */
export const lookupKyc = (
  body: { gstin: string | null; hasUdyam: boolean; udyamNumber: string | null; quoteId?: string | null } | { sampleId: string; quoteId?: string | null },
  fetchFn: FetchFn = fetch,
) => send<Lookup>(fetchFn, "POST", "/api/kyc/lookup", body);

export const retentionInfo = (fetchFn: FetchFn = fetch) =>
  send<{ retention: Retention; purposes: ConsentPurpose[]; noticeVersion: string }>(fetchFn, "GET", "/api/privacy/retention");

export const resumeKyc = (caseId: string, fetchFn: FetchFn = fetch) => send<KycCase>(fetchFn, "POST", `${caseUrl(caseId)}/resume`, {});
export const chooseAlternative = (caseId: string, kind: string, fetchFn: FetchFn = fetch) => send<KycCase>(fetchFn, "POST", `${caseUrl(caseId)}/alternative`, { kind });
export const confirmGstin = (caseId: string, fetchFn: FetchFn = fetch) => send<KycCase>(fetchFn, "POST", `${caseUrl(caseId)}/gstin-suggestion`, {});
export const sendOwnerLink = (caseId: string, fetchFn: FetchFn = fetch) =>
  send<{ mock: true; sentTo: string; otp: string; case: KycCase }>(fetchFn, "POST", `${caseUrl(caseId)}/authorisation`, {});
export const ownerSigns = (caseId: string, otp: string, fetchFn: FetchFn = fetch) => send<KycCase>(fetchFn, "POST", `${caseUrl(caseId)}/authorisation/sign`, { otp });
export const answerQuestion = (caseId: string, blockerId: string, answer: string, fetchFn: FetchFn = fetch) =>
  send<KycCase>(fetchFn, "POST", `${caseUrl(caseId)}/answers`, { blockerId, answer });
export const myData = (caseId: string, fetchFn: FetchFn = fetch) => send<MyData>(fetchFn, "GET", `${caseUrl(caseId)}/my-data`);
export const deleteMyDocuments = (caseId: string, fetchFn: FetchFn = fetch) => send<MyData>(fetchFn, "POST", `${caseUrl(caseId)}/documents/delete`, {});

export const saveBusiness = (caseId: string, body: BusinessInput | { sampleId: string }, fetchFn: FetchFn = fetch) =>
  send<KycCase>(fetchFn, "PUT", `${caseUrl(caseId)}/business`, body);

export const uploadDocument = (caseId: string, doc: DocType, image: { bytes: Uint8Array<ArrayBuffer>; type: string }, fetchFn: FetchFn = fetch) =>
  send<KycCase>(fetchFn, "PUT", `${caseUrl(caseId)}/documents/${doc}`, undefined, image);

export const removeDocument = (caseId: string, doc: DocType, fetchFn: FetchFn = fetch) =>
  send<KycCase>(fetchFn, "DELETE", `${caseUrl(caseId)}/documents/${doc}`);

export const submitKyc = (caseId: string, fetchFn: FetchFn = fetch) => send<KycCase>(fetchFn, "POST", `${caseUrl(caseId)}/submit`, {});

export const startEsign = (caseId: string, fetchFn: FetchFn = fetch) =>
  send<{ mock: true; otp: string; note: string; agreement: Agreement }>(fetchFn, "POST", `${caseUrl(caseId)}/esign/start`, {});

export const verifyEsign = (caseId: string, otp: string, fetchFn: FetchFn = fetch) =>
  send<KycCase>(fetchFn, "POST", `${caseUrl(caseId)}/esign/verify`, { otp });

/** Withdraw consent (or cancel the unfinished application): everything collected for KYC is deleted at once. */
export const withdrawConsent = (caseId: string, fetchFn: FetchFn = fetch, cancel = false) =>
  send<{ withdrawn: true; deleted: true; deletedOn: string; orderStopped: boolean }>(fetchFn, "DELETE", `${caseUrl(caseId)}${cancel ? "?cancel=true" : ""}`);

const KYC_REF_KEY = "udyam.kyc";
/** The last application on this device, so the owner can come back to it (a convenience only). */
export function rememberApplication(caseId: string | null): void {
  try {
    if (caseId) window.localStorage.setItem(KYC_REF_KEY, caseId);
    else window.localStorage.removeItem(KYC_REF_KEY);
  } catch {
    // storage blocked: the owner can still type the reference
  }
}
export function rememberedApplication(): string | null {
  try {
    const v = window.localStorage.getItem(KYC_REF_KEY);
    return v && /^KYC-[0-9A-F]{8}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}
export const cleanCaseId = (raw: string): string | null => {
  const v = raw.trim().toUpperCase().replace(/\s+/g, "");
  return /^KYC-[0-9A-F]{8}$/.test(v) ? v : null;
};

export const listSamples = async (fetchFn: FetchFn = fetch) => (await send<{ samples: Sample[] }>(fetchFn, "GET", "/api/kyc/samples")).samples;

/** DEMO: fetch a sample document image, to upload it like a photo the owner took. */
export async function fetchSampleImage(sampleId: string, doc: DocType, fetchFn: FetchFn = fetch): Promise<Uint8Array<ArrayBuffer>> {
  let res: Response;
  try {
    res = await fetchFn(`/api/kyc/samples/${encodeURIComponent(sampleId)}/documents/${doc}`);
  } catch {
    throw new KycError(0, "network");
  }
  if (!res.ok) throw new KycError(res.status, "sample_not_found");
  return new Uint8Array(await res.arrayBuffer());
}

/** A chosen file's bytes. FileReader works on older phone browsers too (Blob.arrayBuffer needs Safari 14+). */
export function readFileBytes(file: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("could not read the file"));
    reader.readAsArrayBuffer(file);
  });
}

/** Same rules as the backend (backend/src/kyc/identifiers.ts), for instant feedback while typing. */
const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function gstinProblem(raw: string): "format" | "state_code" | "pan_type" | "checksum" | null {
  const g = raw.toUpperCase().replace(/[\s-]+/g, "");
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return "format";
  const state = Number(g.slice(0, 2));
  if (!((state >= 1 && state <= 38) || state === 97)) return "state_code";
  if (!"ABCFGHJLPTX".includes(g[5]!)) return "pan_type";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = GSTIN_CHARS.indexOf(g[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === g[14] ? null : "checksum";
}

export function udyamProblem(raw: string): "format" | null {
  return /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(raw.toUpperCase().replace(/\s+/g, "")) ? null : "format";
}
