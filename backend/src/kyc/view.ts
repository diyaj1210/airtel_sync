import type { Catalogue } from "../catalogue/catalogue.js";
import type { AcceptedQuote } from "../quote/store.js";
import type { CaseEvaluation } from "./review.js";
import { DOC_TYPES, type DocType, type DocumentReading } from "./documents.js";
import type { Agreement } from "./esign.js";
import { fixOcrGstin, fixOcrUdyam, maskGstin, maskNumber, maskUdyam } from "./identifiers.js";
import type { KycCase } from "./store.js";

/**
 * What the API sends to the app. Identifiers (GSTIN, Udyam number, ID and consumer numbers) are
 * always masked here; names, addresses and dates are shown so the owner can check them.
 */

const v = (doc: DocumentReading, name: string) => doc.fields[name]?.value ?? null;

function documentSummary(doc: DocumentReading): Record<string, string | null> {
  switch (doc.docType) {
    case "gst_certificate": {
      const gstin = v(doc, "gstin");
      return { gstin: gstin ? maskGstin(fixOcrGstin(gstin)) : null, legalName: v(doc, "legalName"), tradeName: v(doc, "tradeName") };
    }
    case "udyam_certificate": {
      const number = v(doc, "udyamNumber");
      return { udyamNumber: number ? maskUdyam(fixOcrUdyam(number)) : null, enterpriseName: v(doc, "enterpriseName") };
    }
    case "signatory_id": {
      const id = v(doc, "idNumber");
      return { name: v(doc, "name"), designation: v(doc, "designation"), idNumber: id ? maskNumber(id) : null, validTill: v(doc, "validTill") };
    }
    case "address_proof":
      return { billedTo: v(doc, "billedTo"), billDate: v(doc, "billDate"), address: v(doc, "address") };
  }
}

/** Selected quote lines that need an Active GSTIN, when the business does not have one. */
export function blockedProducts(evaluation: CaseEvaluation, quote: AcceptedQuote | undefined, catalogue: Catalogue) {
  if (!quote || evaluation.status === "not_started" || evaluation.gstinProductsAllowed) return [];
  return quote.quote.items
    .filter((item) => item.selected && catalogue.get(item.productId).requiresGstin)
    .map((item) => ({ productId: item.productId, name: item.name }));
}

export function caseView(kycCase: KycCase, evaluation: CaseEvaluation, quote: AcceptedQuote | undefined, catalogue: Catalogue) {
  const { business } = kycCase;
  const { gst, udyam } = evaluation.registry;
  return {
    caseId: kycCase.caseId,
    consent: {
      id: kycCase.consent.id,
      version: kycCase.consent.noticeVersion,
      acceptedOn: kycCase.consent.acceptedOn,
      purposes: kycCase.consent.purposes,
      marketing: kycCase.consent.marketing,
      channel: kycCase.consent.channel,
    },
    quoteId: kycCase.quoteId,
    sampleId: kycCase.sampleId,
    business: business && {
      applicantName: business.applicantName,
      gstin: business.gstin ? maskGstin(business.gstin) : null,
      hasUdyam: business.hasUdyam,
      udyamNumber: business.udyamNumber ? maskUdyam(business.udyamNumber) : null,
    },
    // MOCK lookups (registry CSVs).
    registry: {
      gst: gst && {
        gstin: maskGstin(gst.gstin),
        legalName: gst.legalName,
        tradeName: gst.tradeName,
        constitution: gst.constitution,
        address: gst.address,
        state: gst.state,
        status: gst.status,
      },
      udyam: udyam && {
        udyamNumber: maskUdyam(udyam.udyamNumber),
        enterpriseName: udyam.enterpriseName,
        majorActivity: udyam.majorActivity,
        city: udyam.city,
        state: udyam.state,
      },
    },
    documents: Object.fromEntries(
      DOC_TYPES.map((d: DocType) => {
        const doc = kycCase.documents[d];
        return [d, { ...evaluation.documents[d], uploaded: !!doc, read: doc?.readable ? documentSummary(doc) : null }];
      }),
    ),
    result: {
      status: evaluation.status,
      issues: evaluation.issues,
      warnings: evaluation.warnings,
      gstin: evaluation.gstin,
      gstinProductsAllowed: evaluation.gstinProductsAllowed,
      blockedProducts: blockedProducts(evaluation, quote, catalogue),
      // A reviewer's decision on a manual-review case (back-office).
      review: evaluation.review,
    },
    submitted: kycCase.submitted,
    esign: kycCase.esign && { started: true, signed: kycCase.esign.signed },
  };
}

export function agreementFor(kycCase: KycCase, evaluation: CaseEvaluation, quote: AcceptedQuote | undefined, today: string): Agreement {
  const gst = evaluation.registry.gst;
  const signatory = kycCase.documents.signatory_id ? v(kycCase.documents.signatory_id, "name") : null;
  return {
    caseId: kycCase.caseId,
    business: gst?.legalName ?? evaluation.registry.udyam?.enterpriseName ?? kycCase.business?.applicantName ?? "",
    gstin: kycCase.business?.gstin ? maskGstin(kycCase.business.gstin) : null,
    signatory: signatory ?? kycCase.business?.applicantName ?? "",
    quote: quote
      ? {
          quoteId: quote.quoteId,
          bundle: quote.quote.name,
          monthlyInr: quote.quote.totals.monthlyInr,
          setupInr: quote.quote.totals.setupInr,
          contractMonths: quote.quote.totals.contractMonths,
        }
      : null,
    consentVersion: kycCase.consent.noticeVersion,
    date: today,
  };
}
