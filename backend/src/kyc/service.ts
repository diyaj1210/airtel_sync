import type { Catalogue } from "../catalogue/catalogue.js";
import type { City } from "../cities.js";
import { addDays } from "../clock.js";
import type { Logger } from "../logger.js";
import { RETENTION } from "../privacy/retention.js";
import type { DocumentVault } from "../privacy/vault.js";
import type { QuoteStore } from "../quote/store.js";
import { assessReadiness, type Readiness } from "../readiness/assess.js";
import { openBlockers, syncBlockers } from "../readiness/sync.js";
import type { DocType, DocumentReading } from "./documents.js";
import { maskGstin, maskUdyam } from "./identifiers.js";
import type { Registries } from "./registry.js";
import { evaluateCase, type CaseEvaluation } from "./review.js";
import { CONSENT_PURPOSES, type KycCase, type KycCaseStore } from "./store.js";
import { caseView } from "./view.js";

/**
 * KYC case operations shared by the app's API and the WhatsApp channel: evaluation, the
 * readiness check (One-Sitting Completion, blockers kept on the case), encrypted document
 * storage, withdrawal and the retention job (privacy feature).
 */
export interface KycServiceDeps {
  store: KycCaseStore;
  vault: DocumentVault;
  registries: Registries;
  catalogue: Catalogue;
  quoteStore: QuoteStore;
  cities: readonly City[];
  today: () => string;
  logger: Logger;
  /** The order placed for a case, if any. */
  orderFor?: (caseId: string) => string | null;
  /** Consent withdrawn: stop the order before activation. */
  stopOrder?: (caseId: string, on: string) => boolean;
}

export class KycService {
  constructor(readonly d: KycServiceDeps) {}

  get(caseId: string): KycCase | undefined {
    return this.d.store.get(caseId);
  }

  quoteOf(c: KycCase) {
    return c.quoteId ? this.d.quoteStore.get(c.quoteId) : undefined;
  }

  evaluate(c: KycCase): CaseEvaluation {
    return evaluateCase(c, this.d.registries, this.d.today());
  }

  /** Re-run the readiness check and keep the blockers on the case. */
  refresh(c: KycCase): { evaluation: CaseEvaluation; readiness: Readiness | null } {
    const evaluation = this.evaluate(c);
    if (c.withdrawn) return { evaluation, readiness: null };
    const readiness = assessReadiness({
      kycCase: c,
      evaluation,
      quote: this.quoteOf(c),
      catalogue: this.d.catalogue,
      registries: this.d.registries,
      cities: this.d.cities,
      today: this.d.today(),
    });
    if (readiness) syncBlockers(c, readiness.blockers, this.d.today());
    return { evaluation, readiness };
  }

  /** What the owner's app gets: the case (identifiers masked), the readiness card and the blocker history. */
  view(c: KycCase) {
    const { evaluation, readiness } = this.refresh(c);
    return {
      ...caseView(c, evaluation, this.quoteOf(c), this.d.catalogue),
      orderId: this.d.orderFor?.(c.caseId) ?? null,
      readiness,
      blockerHistory: c.blockers.filter((b) => b.status === "resolved" || b.status === "waived"),
      withdrawn: c.withdrawn,
    };
  }

  /** Keep the photo encrypted (replacing an earlier one for the same document). */
  storeDocument(c: KycCase, doc: DocType, bytes: Uint8Array, reading: DocumentReading): void {
    const today = this.d.today();
    const previous = c.files[doc];
    if (previous && !previous.deletedOn) this.d.store.deleteFiles(c, this.d.vault, today, "replaced", doc);
    c.files[doc] = {
      fileId: this.d.vault.put(bytes),
      storedOn: today,
      deleteDueOn: c.verifiedOn ? addDays(today, RETENTION.rawDocumentDaysAfterVerification) : null,
      deletedOn: null,
    };
    c.documents[doc] = reading;
  }

  /** "Check my documents": the verification date starts the retention period of the photos. */
  submit(c: KycCase): CaseEvaluation {
    const today = this.d.today();
    c.submitted = true;
    c.verifiedOn ??= today;
    for (const file of Object.values(c.files)) {
      if (file && !file.deletedOn && !file.deleteDueOn) file.deleteDueOn = addDays(today, RETENTION.rawDocumentDaysAfterVerification);
    }
    const evaluation = this.refresh(c).evaluation;
    this.d.logger.info("kyc checked", { caseId: c.caseId, status: evaluation.status, issues: evaluation.issues.map((i) => i.code) });
    return evaluation;
  }

  /** Withdraw consent / cancel onboarding: delete all KYC data now, stop an order not yet activated. */
  withdraw(c: KycCase, cancelled: boolean): { orderStopped: boolean } {
    this.d.store.withdraw(c, this.d.vault, cancelled);
    const orderStopped = this.d.stopOrder?.(c.caseId, this.d.today()) ?? false;
    this.d.logger.info(cancelled ? "kyc onboarding cancelled, data deleted" : "kyc consent withdrawn, data deleted", { caseId: c.caseId, orderStopped });
    return { orderStopped };
  }

  /** The owner asks for their document photos to be deleted now (the verification result is kept). */
  deleteDocuments(c: KycCase): number {
    const n = this.d.store.deleteFiles(c, this.d.vault, this.d.today(), "owner_request");
    this.d.logger.info("kyc documents deleted on request", { caseId: c.caseId, files: n });
    return n;
  }

  /** Retention job: delete photos whose period ended on or before `asOf`. */
  runRetention(asOf: string): { files: number; cases: number } {
    let files = 0;
    let cases = 0;
    for (const c of this.d.store.list()) {
      let n = 0;
      for (const [doc, file] of Object.entries(c.files) as [DocType, NonNullable<KycCase["files"][DocType]>][]) {
        if (file.deletedOn || !file.deleteDueOn || file.deleteDueOn > asOf) continue;
        n += this.d.store.deleteFiles(c, this.d.vault, asOf, "retention", doc);
      }
      if (n > 0) cases += 1;
      files += n;
    }
    this.d.logger.info("retention job", { asOf, files, cases });
    return { files, cases };
  }

  /** The owner's "My data" page: what is held (masked), why, since when, and when it is deleted. */
  myData(c: KycCase) {
    const today = this.d.today();
    const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
    const evaluation = this.evaluate(c);
    return {
      caseId: c.caseId,
      status: c.withdrawn ? (c.withdrawn.cancelled ? "cancelled" : "withdrawn") : "active",
      consent: {
        id: c.consent.id,
        noticeVersion: c.consent.noticeVersion,
        acceptedOn: c.consent.acceptedOn,
        acceptedAt: c.consent.acceptedAt,
        purposes: c.consent.purposes,
        allPurposes: CONSENT_PURPOSES,
        marketing: c.consent.marketing,
        lang: c.consent.lang,
        channel: c.consent.channel,
        withdrawnOn: c.consent.withdrawnOn,
      },
      held: c.business
        ? {
            applicantName: c.business.applicantName,
            gstin: c.business.gstin ? maskGstin(c.business.gstin) : null,
            udyamNumber: c.business.udyamNumber ? maskUdyam(c.business.udyamNumber) : null,
            hasUdyam: c.business.hasUdyam,
            verificationResult: c.submitted ? evaluation.status : null,
          }
        : null,
      documents: (Object.entries(c.files) as [DocType, NonNullable<KycCase["files"][DocType]>][]).map(([doc, f]) => ({
        doc,
        storedOn: f.storedOn,
        encrypted: true,
        deleteDueOn: f.deleteDueOn,
        daysLeft: f.deleteDueOn && !f.deletedOn ? Math.max(0, days(today, f.deleteDueOn)) : null,
        deletedOn: f.deletedOn,
        detailsKept: !!c.documents[doc],
      })),
      deletionLog: c.deletionLog,
      retention: RETENTION,
      orderId: this.d.orderFor?.(c.caseId) ?? null,
      openBlockers: c.withdrawn ? 0 : openBlockers(c).length,
    };
  }
}
