import type { Lang } from "../advisor/text.js";
import { attributionStaff, STAFF } from "../backoffice/staff.js";
import type { Catalogue } from "../catalogue/catalogue.js";
import type { GstinStatus } from "../catalogue/types.js";
import type { City } from "../cities.js";
import { addDays } from "../clock.js";
import { formatDate, formatInr } from "../channels/text.js";
import { ADDRESS_PROOF_MAX_DAYS, type IssueCode, type KycIssue } from "../kyc/checks.js";
import { DOC_TYPES, type DocType } from "../kyc/documents.js";
import { maskGstin } from "../kyc/identifiers.js";
import { docName, issueSentence } from "../kyc/issueText.js";
import type { CaseEvaluation } from "../kyc/review.js";
import type { KycCase } from "../kyc/store.js";
import { suggestGstin, suggestionView } from "../kyc/suggest.js";
import type { Registries } from "../kyc/registry.js";
import { shiftTimeline, verificationStart } from "../timeline/timeline.js";
import type { AcceptedQuote } from "../quote/store.js";
import { buildAlternative, type Alternative } from "./alternatives.js";
import { checkFeasibility, LEASED_LINES, needsWired, selectedIds, type Feasibility } from "./feasibility.js";
import { both, type ReadinessKey } from "./text.js";
import type { AlternativeKind, Bilingual, Blocker, ReadinessState, RequirementGroup } from "./types.js";

/**
 * One-Sitting Completion + No Dead Ends (add-on feature). Pure: everything is passed in.
 *
 * Tells the owner, before and after each upload, whether the journey can be completed now, what
 * could stop it, and for every problem a concrete fix. It is a completion and confidence check,
 * NOT a KYC approval, a fraud-risk score or an installation guarantee: the checks (kyc/checks.ts),
 * the rules engine and the reviewers still decide.
 *
 * States, by precedence: NOT_CURRENTLY_POSSIBLE (a hard block for the selected bundle, always with
 * an alternative or a save-and-return path) > PARTNER_ASSISTANCE_RECOMMENDED (the owner can still
 * continue) > NEEDS_REVIEW (a person must look; says what, who, when) > ALMOST_READY (the owner
 * can finish now) > READY.
 */

export interface Requirement {
  group: RequirementGroup;
  applicable: boolean;
  verified: boolean;
}

export interface Readiness {
  state: ReadinessState;
  percent: number;
  verified: number;
  applicable: number;
  requirements: Requirement[];
  /** Applicable groups not verified yet. */
  remaining: RequirementGroup[];
  /** Optional extra verification the owner may add (Udyam: no product requires it). */
  optional: "udyam"[];
  found: { key: "businessName" | "gstin" | "location" | "businessType"; value: string }[];
  /** Documents the checks still need (lookup first: only what the registries could not confirm). */
  documentsToUpload: DocType[];
  expectedMinutes: number;
  /** After verification: when the selected bundle should be ready (shared computeTimeline). */
  after: { bundle: string; product: string; days: number; readyOn: string; start: string; dayOne: string[]; window: { from: number; to: number } | null } | null;
  feasibility: Feasibility;
  partner: { code: string; name: string } | null;
  blockers: Blocker[];
  /** For NOT_CURRENTLY_POSSIBLE: the best alternative and how ready the journey is with it. */
  alternative: { kind: AlternativeKind; bundle: string; state: ReadinessState } | null;
  bundle: string | null;
  /** MOCK service level for anything a person reviews. */
  reviewWithinHours: number;
}

export interface AssessInput {
  kycCase: Pick<KycCase, "caseId" | "business" | "documents" | "submitted" | "authorisation" | "answers" | "attributionCode">;
  evaluation: CaseEvaluation;
  quote: AcceptedQuote | undefined;
  catalogue: Catalogue;
  registries: Registries;
  cities: readonly City[];
  today: string;
}

export const REVIEW_WITHIN_HOURS = 4;
export const PARTNER_MONTHLY_INR = 10_000;
export const PARTNER_SITES = 3;
export const PARTNER_INSTALL_DAYS = 14;
const MINUTES_PER_UPLOAD = 2;
const MINUTES_PER_CONFIRM = 1;
const MINUTES_TO_SIGN_AND_PAY = 2;

/** Problems a person reviews; the owner can answer the question meanwhile. */
const QUESTION: Partial<Record<IssueCode, (issue: KycIssue) => ReadinessKey>> = {
  CERT_DETAILS_MISMATCH: (i) =>
    i.params.field === "tradeName" ? "question.tradeName" : i.params.field === "address" ? "question.address" : i.params.field === "constitution" ? "question.constitution" : "question.legalName",
  BILL_NAME_MISMATCH: () => "question.billName",
  BILL_DATE_IN_FUTURE: () => "question.billDate",
  GSTIN_NOT_IN_REGISTRY: () => "question.notInRegistry",
};
const IDENTITY_REVIEW: IssueCode[] = ["CERT_DETAILS_MISMATCH", "GSTIN_NOT_IN_REGISTRY", "BILL_NAME_MISMATCH"];

const issueMessage = (issue: KycIssue): Bilingual => ({ en: issueSentence("en", issue), hi: issueSentence("hi", issue) });
const docVars = (doc: string) => (lang: Lang) => ({ doc: docName(lang, doc) });

function categoryOf(issue: KycIssue): Blocker["category"] {
  if (issue.code === "SIGNATORY_NOT_VERIFIED") return "signatory";
  if (issue.code === "ID_EXPIRED" || issue.doc === "signatory_id") return "identity";
  if (["CERT_GSTIN_MISMATCH", "GSTIN_NOT_FOUND", "GSTIN_NOT_IN_REGISTRY", "CERT_DETAILS_MISMATCH"].includes(issue.code)) return "registry";
  return "document";
}

/** The partner who helps when one is recommended: the one who referred the owner, else field sales for the city tier. */
export function partnerFor(attributionCode: string | null, cityTier: number): { code: string; name: string } {
  const referred = attributionCode ? attributionStaff(attributionCode) : undefined;
  const s = referred ?? STAFF.find((x) => x.code === (cityTier === 1 ? "SLS-01" : "SLS-02"))!;
  return { code: s.code, name: s.name };
}

function blockerBase(id: string, today: string): Pick<Blocker, "id" | "status" | "openedOn" | "resolvedOn" | "resolvedBy" | "hard"> {
  return { id, status: "open", openedOn: today, resolvedOn: null, resolvedBy: null, hard: false };
}

export function assessReadiness(input: AssessInput, withAlternatives = true): Readiness | null {
  const { kycCase: c, evaluation: ev, quote, catalogue, registries, cities, today } = input;
  const business = c.business;
  if (!business) return null;

  const approved = ev.review?.decision === "approved";
  const rejected = ev.review?.decision === "rejected";
  // A reviewer's approval settles the problems a person had to look at.
  const active = ev.issues.filter((i) => !(approved && i.severity === "review"));
  const docOk = (d: DocType) => !!c.documents[d] && !active.some((i) => i.doc === d);
  const gst = ev.registry.gst;
  const udyam = ev.registry.udyam;
  const q = quote?.quote;
  const selected = q ? selectedIds(q) : [];
  const gstinOnly = q ? q.items.filter((i) => i.selected && catalogue.get(i.productId).requiresGstin) : [];
  const quoteNeedsGstin = gstinOnly.length > 0;

  // ---- feasibility (MOCK coverage by installation city) ----
  const billAddress = docOk("address_proof") ? (c.documents.address_proof?.fields.address?.value ?? null) : null;
  const feasibility = checkFeasibility({ addressProof: billAddress, gst: gst?.address ?? null, udyamCity: udyam?.city ?? null }, cities);
  const wiredBlocked = !!q && needsWired(q) && feasibility.known && feasibility.fibre === false;

  // ---- requirements and readiness percentage (Udyam is never counted: no product needs it) ----
  const requirements: Requirement[] = [
    {
      group: "business",
      applicable: true,
      verified: (!!gst || !!udyam || docOk("address_proof")) && !active.some((i) => IDENTITY_REVIEW.includes(i.code)),
    },
    {
      group: "gstin",
      applicable: quoteNeedsGstin || !!business.gstin,
      verified:
        !!gst &&
        !active.some((i) => ["GSTIN_NOT_FOUND", "CERT_GSTIN_MISMATCH", "GSTIN_NOT_IN_REGISTRY"].includes(i.code)) &&
        (!quoteNeedsGstin || ev.gstinProductsAllowed),
    },
    { group: "signatory", applicable: true, verified: docOk("signatory_id") },
    { group: "address", applicable: true, verified: docOk("address_proof") },
    { group: "feasibility", applicable: true, verified: feasibility.known && !wiredBlocked },
  ];
  const applicable = requirements.filter((r) => r.applicable);
  const verified = applicable.filter((r) => r.verified).length;
  const documentsToUpload = DOC_TYPES.filter((d) => ev.documents[d].need === "required" && !c.documents[d]);

  // ---- blockers: every one with an action ----
  const blockers: Blocker[] = [];
  const suggestion = suggestGstin(c.documents.gst_certificate, registries);
  for (const issue of active) {
    const id = `${issue.code}:${issue.doc ?? "case"}`;
    const base = { ...blockerBase(id, today), category: categoryOf(issue), customerMessage: issueMessage(issue), ...(issue.doc ? { doc: issue.doc } : {}) };
    if (issue.severity === "review" && rejected) continue; // one "rejected" blocker below
    if (issue.code === "SIGNATORY_NOT_VERIFIED") {
      const owner = business.applicantName;
      const sent = !!c.authorisation && !c.authorisation.signed;
      blockers.push({
        ...base,
        actionType: "send_esign_link",
        responsibleParty: "customer",
        status: sent ? "in_progress" : "open",
        requiredAction: both(sent ? "action.ownerLinkSent" : "action.ownerLink", { owner }),
        expectedResolution: both("eta.owner"),
      });
    } else if (issue.severity === "review") {
      const question = QUESTION[issue.code]?.(issue);
      blockers.push({
        ...base,
        actionType: "wait_review",
        responsibleParty: "accel_ops",
        status: "in_progress",
        requiredAction: both("action.waitReview"),
        expectedResolution: both("eta.review"),
        ...(question ? { question: both(question), answer: c.answers[id]?.answer ?? null } : {}),
      });
    } else if (issue.code === "CERT_GSTIN_MISMATCH" && suggestion && suggestion.gstin === (business.gstin ?? suggestion.gstin)) {
      const view = suggestionView(suggestion);
      blockers.push({
        ...base,
        actionType: "confirm",
        responsibleParty: "customer",
        requiredAction: both("action.confirmGstin", { gstin: view.gstinMasked, name: view.legalName }),
        expectedResolution: both("eta.now", { minutes: MINUTES_PER_CONFIRM }),
        suggestion: view,
      });
    } else {
      const doc = issue.doc ?? (issue.code === "GSTIN_NOT_FOUND" ? "gst_certificate" : undefined);
      const action: Bilingual =
        issue.code === "ADDRESS_PROOF_TOO_OLD"
          ? both("action.recentBill", (lang) => ({ date: formatDate(addDays(today, -ADDRESS_PROOF_MAX_DAYS), lang) }))
          : issue.code === "DOC_UNREADABLE"
            ? both("action.photoTips", docVars(doc!))
            : issue.code === "ID_EXPIRED"
              ? both("action.validId")
              : issue.code === "ADDRESS_MISMATCH"
                ? both("action.billAddress")
                : issue.code === "GSTIN_NOT_FOUND" || issue.code === "CERT_GSTIN_MISMATCH"
                  ? both("action.checkGstin")
                  : issue.code === "DOC_MISSING"
                    ? both("action.upload", docVars(doc!))
                    : both("action.uploadAgain", docVars(doc ?? "gst_certificate"));
      blockers.push({
        ...base,
        ...(doc ? { doc } : {}),
        actionType: "upload",
        responsibleParty: "customer",
        requiredAction: action,
        expectedResolution: both("eta.now", { minutes: MINUTES_PER_UPLOAD }),
      });
    }
  }
  if (rejected) {
    blockers.push({
      ...blockerBase("REVIEW_REJECTED:case", today),
      category: "identity",
      customerMessage: both("msg.rejected", { note: ev.review?.note ?? "" }),
      requiredAction: both("action.rejected"),
      actionType: "upload",
      responsibleParty: "customer",
      expectedResolution: both("eta.now", { minutes: MINUTES_PER_UPLOAD }),
    });
  }

  let alternative: Alternative | null = null;
  const altBlocker = (alt: Alternative | null): Blocker["alternative"] =>
    alt
      ? { kind: alt.kind, bundle: alt.quote.name, monthlyInr: alt.quote.totals.monthlyInr, setupInr: alt.quote.totals.setupInr, removed: alt.removed, added: alt.added }
      : undefined;
  const saveReturn = both("action.saveReturn", { id: c.caseId });

  // GSTIN-only products with a GSTIN that cannot be used (K01: Cancelled): offer the bundle without them.
  const gstinState = ev.gstin;
  if (quote && quoteNeedsGstin && (gstinState === "cancelled" || gstinState === "suspended" || gstinState === "none")) {
    const alt = buildAlternative("without_gstin_products", quote, catalogue, (gstinState === "none" ? "none" : "inactive") as GstinStatus);
    alternative ??= alt;
    const products = gstinOnly.map((i) => i.name).join(", ");
    blockers.push({
      ...blockerBase("eligibility:gstin", today),
      hard: true,
      category: "eligibility",
      customerMessage:
        gstinState === "none"
          ? both("msg.gstinMissing", { products })
          : both("msg.gstinBlocked", (lang) => ({ status: lang === "hi" ? (gstinState === "cancelled" ? "रद्द" : "निलंबित") : gstinState === "cancelled" ? "Cancelled" : "Suspended", products })),
      requiredAction: alt ? both("action.withoutGstin", { bundle: alt.quote.name, monthly: formatInr(alt.quote.totals.monthlyInr) }) : saveReturn,
      actionType: alt ? "choose_alternative" : "contact_partner",
      responsibleParty: "customer",
      expectedResolution: both("eta.choice"),
      ...(alt ? { alternative: altBlocker(alt) } : {}),
    });
  }

  // No wired service at the installation address (MOCK coverage): offer the 5G AirFiber bundle.
  if (quote && wiredBlocked) {
    const leased = selected.some((id) => LEASED_LINES.includes(id));
    const alt = leased ? null : buildAlternative("airfiber", quote, catalogue);
    alternative ??= alt;
    blockers.push({
      ...blockerBase("feasibility:wired", today),
      hard: true,
      category: "feasibility",
      customerMessage: both(alt ? "msg.noFibre" : "msg.noFibreNoFallback", { city: feasibility.city ?? "" }),
      requiredAction: alt
        ? both("action.airfiber", { bundle: alt.quote.name, days: alt.quote.totals.installDays, monthly: formatInr(alt.quote.totals.monthlyInr) })
        : saveReturn,
      actionType: alt ? "choose_alternative" : "contact_partner",
      responsibleParty: alt ? "customer" : "partner",
      expectedResolution: alt ? both("eta.choice") : both("eta.partner"),
      ...(alt ? { alternative: altBlocker(alt) } : {}),
    });
  }

  // Payment needs a valid quote.
  if (quote && today > quote.validUntil) {
    const alt = buildAlternative("requote", quote, catalogue);
    alternative ??= alt;
    blockers.push({
      ...blockerBase("payment:quote_expired", today),
      hard: true,
      category: "payment",
      customerMessage: both("msg.quoteExpired", (lang) => ({ date: formatDate(quote.validUntil, lang) })),
      requiredAction: alt ? both("action.requote", { monthly: formatInr(alt.quote.totals.monthlyInr) }) : saveReturn,
      actionType: alt ? "choose_alternative" : "contact_partner",
      responsibleParty: "customer",
      expectedResolution: both("eta.choice"),
      ...(alt ? { alternative: altBlocker(alt) } : {}),
    });
  }
  if (!quote) {
    blockers.push({
      ...blockerBase("payment:no_quote", today),
      category: "payment",
      customerMessage: both("msg.noQuote"),
      requiredAction: both("action.getQuote"),
      actionType: "choose_alternative",
      responsibleParty: "customer",
      expectedResolution: both("eta.now", { minutes: MINUTES_PER_UPLOAD }),
    });
  }

  // Partner assistance (the owner can still continue digitally).
  let partner: Readiness["partner"] = null;
  if (q) {
    const reasons: { key: ReadinessKey; vars?: Record<string, number> }[] = [];
    if (selected.some((id) => LEASED_LINES.includes(id))) reasons.push({ key: "reason.leasedLine" });
    if (selected.includes("P10")) reasons.push({ key: "reason.sdwan" });
    if (q.profile.sites >= PARTNER_SITES) reasons.push({ key: "reason.sites", vars: { n: q.profile.sites } });
    if (q.totals.monthlyInr > PARTNER_MONTHLY_INR) reasons.push({ key: "reason.value" });
    if (q.totals.installDays >= PARTNER_INSTALL_DAYS) reasons.push({ key: "reason.install", vars: { days: q.totals.installDays } });
    else if (q.timeline.window) reasons.push({ key: "reason.window", vars: { from: q.timeline.window.from, to: q.timeline.window.to } });
    if (reasons.length > 0) {
      partner = partnerFor(c.attributionCode, q.profile.cityTier);
      const list = (lang: Lang) => reasons.map((r) => both(r.key, r.vars ?? {})[lang]).join(", ");
      blockers.push({
        ...blockerBase("installation:partner", today),
        category: "installation",
        customerMessage: both("msg.partner", (lang) => ({ reasons: list(lang) })),
        requiredAction: both("action.partner", { partner: partner.name }),
        actionType: "contact_partner",
        responsibleParty: "partner",
        status: "in_progress",
        expectedResolution: both("eta.partner"),
      });
    }
  }

  // ---- state ----
  // Without a selected bundle the state describes the KYC only; "get a quote" stays shown as the next action.
  const open = blockers.filter((b) => (b.status === "open" || b.status === "in_progress") && b.id !== "payment:no_quote");
  const missingInputs = applicable.filter((r) => !r.verified).length > 0 || documentsToUpload.length > 0;
  const state: ReadinessState = open.some((b) => b.hard)
    ? "NOT_CURRENTLY_POSSIBLE"
    : partner
      ? "PARTNER_ASSISTANCE_RECOMMENDED"
      : open.some((b) => b.responsibleParty === "accel_ops" || b.actionType === "send_esign_link")
        ? "NEEDS_REVIEW"
        : open.some((b) => b.responsibleParty === "customer") || missingInputs
          ? "ALMOST_READY"
          : "READY";

  // "Not possible for Office Pro - <alternative> is Ready": how ready the journey is with the alternative.
  let altView: Readiness["alternative"] = null;
  if (state === "NOT_CURRENTLY_POSSIBLE" && alternative && withAlternatives) {
    const altQuote: AcceptedQuote = { quoteId: "alternative", acceptedOn: today, validUntil: addDays(today, 7), request: alternative.request, quote: alternative.quote, attributionCode: c.attributionCode };
    const withAlt = assessReadiness({ ...input, quote: altQuote }, false);
    altView = { kind: alternative.kind, bundle: alternative.quote.name, state: withAlt?.state ?? "ALMOST_READY" };
  }

  // ---- card details ----
  const found: Readiness["found"] = [];
  const name = gst?.tradeName || gst?.legalName || udyam?.enterpriseName;
  if (name) found.push({ key: "businessName", value: name });
  if (gst) found.push({ key: "gstin", value: `${maskGstin(gst.gstin)} (${gst.status})` });
  if (gst || udyam) found.push({ key: "location", value: gst ? `${feasibility.city ?? ""}${feasibility.city ? ", " : ""}${gst.state}` : `${udyam!.city}, ${udyam!.state}` });
  if (gst?.constitution) found.push({ key: "businessType", value: gst.constitution });

  const uploads = documentsToUpload.length + open.filter((b) => b.actionType === "upload").length;
  const confirms = open.filter((b) => b.actionType === "confirm" || b.actionType === "choose_alternative").length;
  // Same timeline as the quote, from when verification should be complete (today, +1 day if a person reviews).
  const timeline = q ? shiftTimeline(q.timeline, verificationStart(today, state === "NEEDS_REVIEW")) : null;

  return {
    state,
    percent: Math.round((verified / applicable.length) * 100),
    verified,
    applicable: applicable.length,
    requirements,
    remaining: applicable.filter((r) => !r.verified).map((r) => r.group),
    optional: business.hasUdyam && !business.udyamNumber && !udyam ? ["udyam"] : [],
    found,
    documentsToUpload,
    expectedMinutes: uploads * MINUTES_PER_UPLOAD + confirms * MINUTES_PER_CONFIRM + MINUTES_TO_SIGN_AND_PAY,
    after:
      timeline && q
        ? {
            bundle: q.name,
            product: timeline.slowest.name,
            days: timeline.readyDays,
            readyOn: timeline.readyOn,
            start: timeline.start,
            dayOne: timeline.lines.filter((l) => l.dayOne).map((l) => l.name),
            window: timeline.window && { from: timeline.window.from, to: timeline.window.to },
          }
        : null,
    feasibility,
    partner,
    blockers: blockers.sort((a, b) => Number(b.hard) - Number(a.hard)),
    alternative: altView,
    bundle: q?.name ?? null,
    reviewWithinHours: REVIEW_WITHIN_HOURS,
  };
}
