import { randomBytes } from "node:crypto";
import type { DocumentVault } from "../privacy/vault.js";
import type { Blocker } from "../readiness/types.js";
import type { BusinessDetails } from "./checks.js";
import type { DocType, DocumentReading } from "./documents.js";
import type { KycReview } from "./review.js";

/**
 * KYC cases, in memory (prototype). What is kept, and for how long, is what the consent screen
 * says (privacy/retention.ts):
 * - document photos: encrypted at rest (privacy/vault.ts), deleted 30 days after verification, or
 *   at once when the owner deletes them or withdraws consent;
 * - the details read from them and the check result: kept with the case;
 * - withdrawing consent deletes everything collected for KYC at once; only the consent record and
 *   the deletion log stay, as proof (and so the owner can see when deletion happened).
 * A restart of the backend also clears everything (no database in the prototype).
 */

/** Bump when the consent text changes; the app sends the version it showed. */
export const CONSENT_VERSION = "kyc-consent-v2";
/** Separate purposes the owner consents to (no generic "service improvement" for identity documents). */
export const CONSENT_PURPOSES = ["identity_verification", "product_eligibility", "order_activation", "electronic_signing", "manual_review"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export const CONSENT_CHANNELS = ["app", "whatsapp"] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
export const MAX_CASES = 1000;
export const CASE_ID_RE = /^KYC-[0-9A-F]{8}$/;

export interface EsignState {
  /** MOCK one-time password (shown on screen; no SMS is sent). */
  otp: string;
  issuedAtMs: number;
  attempts: number;
  signed: { reference: string; signedOn: string; documentHash: string } | null;
}

/** The consent record (DPDP Act 2023): kept as proof of consent, also after withdrawal. */
export interface ConsentRecord {
  id: string;
  noticeVersion: string;
  purposes: ConsentPurpose[];
  /** Marketing messages: a separate, optional consent, off unless ticked. */
  marketing: boolean;
  lang: "en" | "hi";
  channel: ConsentChannel;
  acceptedOn: string;
  /** Time of consent (ISO). */
  acceptedAt: string;
  withdrawnOn: string | null;
}

export interface StoredDocument {
  fileId: string;
  storedOn: string;
  /** Set once the documents are verified: storedOn / verification date + the retention period. */
  deleteDueOn: string | null;
  deletedOn: string | null;
}

export type DeletionReason = "retention" | "owner_request" | "withdrawal" | "replaced";
export interface DeletionEntry {
  what: DocType | "all_kyc_data";
  deletedOn: string;
  reason: DeletionReason;
}

export interface KycCase {
  caseId: string;
  consent: ConsentRecord;
  /** The accepted quote this KYC is for (optional: KYC can be started from the home screen). */
  quoteId: string | null;
  business: BusinessDetails | null;
  /** DEMO: filled from a sample applicant (K01-K12). */
  sampleId: string | null;
  documents: Partial<Record<DocType, DocumentReading>>;
  /** Encrypted photos (privacy feature). */
  files: Partial<Record<DocType, StoredDocument>>;
  deletionLog: DeletionEntry[];
  submitted: boolean;
  /** First time the documents were checked (start of the raw-document retention period). */
  verifiedOn: string | null;
  esign: EsignState | null;
  /** Partner / sales code the owner was referred by (from the quote, or given when starting), or null. */
  attributionCode: string | null;
  /** A reviewer's decision on a manual-review case (back-office), or null. */
  review: KycReview | null;
  /** One-Sitting Completion: problems and what to do about them, kept across re-checks. */
  blockers: Blocker[];
  /** "Did you mean ...?" confirmed by the owner (K06). */
  certGstinConfirmed: { printed: string; gstin: string } | null;
  /** MOCK e-sign link to the registered owner authorising the person signing (K10). */
  authorisation: (EsignState & { sentOn: string }) | null;
  /** The owner's answers to the team's questions, by blocker id (K07). */
  answers: Record<string, { answer: string; on: string }>;
  /** Alternatives the owner accepted (e.g. the bundle without GSTIN-only products). */
  alternativesAccepted: number;
  /** For the one-sitting metric. */
  journey: { startedMs: number; resumes: number; orderedMs: number | null };
  /** Consent withdrawn / onboarding cancelled: the case is only a record that it happened. */
  withdrawn: { on: string; cancelled: boolean } | null;
}

export interface NewConsent {
  purposes: ConsentPurpose[];
  marketing: boolean;
  lang: "en" | "hi";
  channel: ConsentChannel;
}

export class KycCaseStore {
  private readonly cases = new Map<string, KycCase>();

  constructor(
    private readonly today: () => string,
    private readonly newId: () => string = () => `KYC-${randomBytes(4).toString("hex").toUpperCase()}`,
    private readonly maxCases = MAX_CASES,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  create(consent: NewConsent | "en" | "hi", quoteId: string | null, attributionCode: string | null = null): KycCase {
    const c: NewConsent = typeof consent === "string" ? { purposes: [...CONSENT_PURPOSES], marketing: false, lang: consent, channel: "app" } : consent;
    let caseId = this.newId();
    for (let tries = 0; this.cases.has(caseId); tries++) {
      if (tries > 10) throw new Error("Could not generate a unique KYC case id");
      caseId = this.newId();
    }
    // Oldest case out first when full (prototype memory bound).
    while (this.cases.size >= this.maxCases) this.cases.delete(this.cases.keys().next().value!);
    const now = this.nowMs();
    const kycCase: KycCase = {
      caseId,
      consent: {
        id: `CON-${randomBytes(4).toString("hex").toUpperCase()}`,
        noticeVersion: CONSENT_VERSION,
        purposes: [...c.purposes],
        marketing: c.marketing,
        lang: c.lang,
        channel: c.channel,
        acceptedOn: this.today(),
        acceptedAt: new Date(now).toISOString(),
        withdrawnOn: null,
      },
      quoteId,
      business: null,
      sampleId: null,
      documents: {},
      files: {},
      deletionLog: [],
      submitted: false,
      verifiedOn: null,
      esign: null,
      attributionCode,
      review: null,
      blockers: [],
      certGstinConfirmed: null,
      authorisation: null,
      answers: {},
      alternativesAccepted: 0,
      journey: { startedMs: now, resumes: 0, orderedMs: null },
      withdrawn: null,
    };
    this.cases.set(caseId, kycCase);
    return kycCase;
  }

  get(caseId: string): KycCase | undefined {
    return CASE_ID_RE.test(caseId) ? this.cases.get(caseId) : undefined;
  }

  /** Delete the stored photos of a case (all of them, or one), recording why. */
  deleteFiles(c: KycCase, vault: DocumentVault, on: string, reason: DeletionReason, only?: DocType): number {
    let n = 0;
    for (const [doc, file] of Object.entries(c.files) as [DocType, StoredDocument][]) {
      if ((only && doc !== only) || file.deletedOn) continue;
      vault.delete(file.fileId);
      file.deletedOn = on;
      c.deletionLog.push({ what: doc, deletedOn: on, reason });
      n += 1;
    }
    return n;
  }

  /**
   * Consent withdrawn (or onboarding cancelled): everything collected for KYC is deleted at once.
   * Kept: the consent record (proof of consent, marked withdrawn) and the deletion log.
   */
  withdraw(c: KycCase, vault: DocumentVault, cancelled: boolean): void {
    const on = this.today();
    this.deleteFiles(c, vault, on, "withdrawal");
    c.business = null;
    c.sampleId = null;
    c.documents = {};
    c.esign = null;
    c.authorisation = null;
    c.answers = {};
    c.certGstinConfirmed = null;
    c.blockers = [];
    c.review = null;
    c.consent.withdrawnOn = on;
    c.withdrawn = { on, cancelled };
    c.deletionLog.push({ what: "all_kyc_data", deletedOn: on, reason: "withdrawal" });
  }

  /** Remove a case completely (prototype memory; used when a WhatsApp chat is deleted with its case). */
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
