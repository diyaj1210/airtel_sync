import { randomBytes } from "node:crypto";
import type { BusinessDetails } from "./checks.js";
import type { DocType, DocumentReading } from "./documents.js";
import type { KycReview } from "./review.js";

/**
 * KYC cases, in memory (prototype). What is kept, and for how long, is what the consent screen
 * says (frontend i18n "kyc.consent.*"):
 * - document images: never stored; read by OCR in memory and dropped at once;
 * - the details read from them and the check results: kept with the case;
 * - withdrawing consent deletes the case, everything in it, straight away.
 * A restart of the backend also clears everything (no database in the prototype).
 */

/** Bump when the consent text changes; the frontend sends the version it showed. */
export const CONSENT_VERSION = "kyc-consent-v1";
export const CONSENT_PURPOSES = ["identity_verification", "regulatory_compliance"] as const;
export const MAX_CASES = 1000;
export const CASE_ID_RE = /^KYC-[0-9A-F]{8}$/;

export interface EsignState {
  /** MOCK one-time password (shown on screen; no SMS is sent). */
  otp: string;
  issuedAtMs: number;
  attempts: number;
  signed: { reference: string; signedOn: string; documentHash: string } | null;
}

export interface KycCase {
  caseId: string;
  consent: { version: string; acceptedOn: string; lang: "en" | "hi"; purposes: readonly string[] };
  /** The accepted quote this KYC is for (optional: KYC can be started from the home screen). */
  quoteId: string | null;
  business: BusinessDetails | null;
  /** DEMO: filled from a sample applicant (K01-K12). */
  sampleId: string | null;
  documents: Partial<Record<DocType, DocumentReading>>;
  submitted: boolean;
  esign: EsignState | null;
  /** Partner / sales code the owner was referred by (from the quote, or given when starting), or null. */
  attributionCode: string | null;
  /** A reviewer's decision on a manual-review case (back-office), or null. */
  review: KycReview | null;
}

export class KycCaseStore {
  private readonly cases = new Map<string, KycCase>();

  constructor(
    private readonly today: () => string,
    private readonly newId: () => string = () => `KYC-${randomBytes(4).toString("hex").toUpperCase()}`,
    private readonly maxCases = MAX_CASES,
  ) {}

  create(lang: "en" | "hi", quoteId: string | null, attributionCode: string | null = null): KycCase {
    let caseId = this.newId();
    for (let tries = 0; this.cases.has(caseId); tries++) {
      if (tries > 10) throw new Error("Could not generate a unique KYC case id");
      caseId = this.newId();
    }
    // Oldest case out first when full (prototype memory bound).
    while (this.cases.size >= this.maxCases) this.cases.delete(this.cases.keys().next().value!);
    const kycCase: KycCase = {
      caseId,
      consent: { version: CONSENT_VERSION, acceptedOn: this.today(), lang, purposes: CONSENT_PURPOSES },
      quoteId,
      business: null,
      sampleId: null,
      documents: {},
      submitted: false,
      esign: null,
      attributionCode,
      review: null,
    };
    this.cases.set(caseId, kycCase);
    return kycCase;
  }

  get(caseId: string): KycCase | undefined {
    return CASE_ID_RE.test(caseId) ? this.cases.get(caseId) : undefined;
  }

  /** Consent withdrawn: the case and everything in it is deleted. */
  delete(caseId: string): boolean {
    return this.cases.delete(caseId);
  }

  list(): KycCase[] {
    return [...this.cases.values()];
  }

  get size(): number {
    return this.cases.size;
  }
}
