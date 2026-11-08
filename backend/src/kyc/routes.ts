import express, { Router, type ErrorRequestHandler, type Request, type Response } from "express";
import { parseAttribution } from "../backoffice/staff.js";
import type { Catalogue } from "../catalogue/catalogue.js";
import type { Logger } from "../logger.js";
import type { QuoteStore } from "../quote/store.js";
import type { BusinessDetails } from "./checks.js";
import { DocumentReadError, IMAGE_TYPES, isDocType, MAX_IMAGE_BYTES, type DocumentReader } from "./documents.js";
import { startEsign, verifyEsign } from "./esign.js";
import { evaluateKyc } from "./checks.js";
import { maskIdentifiers } from "../masking.js";
import { RETENTION } from "../privacy/retention.js";
import { buildAlternative } from "../readiness/alternatives.js";
import { assessReadiness } from "../readiness/assess.js";
import type { AlternativeKind } from "../readiness/types.js";
import { DOC_TYPES } from "./documents.js";
import type { KycService } from "./service.js";
import { suggestGstin } from "./suggest.js";
import { checkGstin, checkUdyam, maskGstin, maskUdyam } from "./identifiers.js";
import type { Registries } from "./registry.js";
import { sampleImagePath, SAMPLE_ID_RE, type SampleApplicant } from "./samples.js";
import { CONSENT_CHANNELS, CONSENT_PURPOSES, CONSENT_VERSION, type ConsentChannel, type ConsentPurpose, type KycCase, type KycCaseStore } from "./store.js";
import { agreementFor } from "./view.js";

/**
 *   POST   /api/kyc/cases                          consent given -> new case          { consent: {accepted, version}, lang, quoteId?, attributionCode? }
 *   GET    /api/kyc/cases/:id                      case + current result
 *   PUT    /api/kyc/cases/:id/business             applicant, GSTIN, Udyam -> lookups { applicantName, gstin|null, hasUdyam, udyamNumber? } | { sampleId }
 *   PUT    /api/kyc/cases/:id/documents/:docType   upload one image (raw body, image/png|jpeg|webp, <= 8 MB) -> OCR -> checks
 *   DELETE /api/kyc/cases/:id/documents/:docType   remove an uploaded document
 *   POST   /api/kyc/cases/:id/submit               "check my documents": a missing document now counts as a problem
 *   POST   /api/kyc/cases/:id/esign/start          MOCK e-sign: agreement + one-time password (shown, not sent)
 *   POST   /api/kyc/cases/:id/esign/verify         { otp }
 *   DELETE /api/kyc/cases/:id                      withdraw consent: the case and all its data are deleted
 *   GET    /api/lookup/gstin/:gstin                MOCK GSTIN lookup (mock_gstin_registry.csv)
 *   GET    /api/lookup/udyam/:udyamNumber          MOCK Udyam lookup (mock_udyam_registry.csv)
 *   GET    /api/kyc/samples                        DEMO: the 12 sample applicants (no identifiers)
 *   GET    /api/kyc/samples/:id/documents/:docType DEMO: a sample document image
 *
 * Add-ons (One-Sitting Completion, privacy inside the journey):
 *   GET    /api/privacy/retention                  retention periods (proposed) and the consent purposes
 *   POST   /api/kyc/lookup                         before consent, nothing stored: registry lookup, documents still needed, readiness preview
 *   POST   /api/kyc/cases/:id/resume               save and return
 *   GET    /api/kyc/cases/:id/my-data              what is held (masked), purposes, deletion countdown, deletion log
 *   POST   /api/kyc/cases/:id/documents/delete     delete the document photos now (the result is kept)
 *   DELETE /api/kyc/cases/:id?cancel=true          cancel the unfinished application (same deletion as withdrawing)
 *   POST   /api/kyc/cases/:id/alternative          { kind } switch to the alternative bundle the readiness check offers
 *   POST   /api/kyc/cases/:id/gstin-suggestion     confirm "Did you mean ...?" (K06)
 *   POST   /api/kyc/cases/:id/authorisation[/sign] MOCK e-sign link for the registered owner (K10)
 *   POST   /api/kyc/cases/:id/answers              { blockerId, answer } to the team's question (K07)
 *
 * Every KYC write needs a valid consent record (403 after withdrawal). Identifiers leave the
 * server only masked. Document photos are stored only encrypted (privacy/vault.ts) and never logged.
 */

export interface KycDeps {
  catalogue: Catalogue;
  quoteStore: QuoteStore;
  registries: Registries;
  store: KycCaseStore;
  reader: DocumentReader;
  samples: SampleApplicant[];
  documentsDir?: string;
  today: () => string;
  nowMs: () => number;
  logger: Logger;
  /** The order placed for a case, if any (step 5). */
  orderFor?: (caseId: string) => string | null;
  /** Case operations: readiness, encrypted documents, withdrawal (add-on features). */
  service: KycService;
}

const NAME_RE = /^[\p{L}][\p{L} .'-]{1,79}$/u;

type Parsed<T> = { ok: true; value: T } | { ok: false; errors: { field: string; problem: string }[] };

export function parseBusiness(body: unknown): Parsed<BusinessDetails> {
  const b = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const errors: { field: string; problem: string }[] = [];
  const applicantName = typeof b.applicantName === "string" ? b.applicantName.trim().replace(/\s+/g, " ") : "";
  if (!NAME_RE.test(applicantName)) errors.push({ field: "applicantName", problem: "invalid" });
  let gstin: string | null = null;
  if (typeof b.gstin === "string" && b.gstin.trim() !== "") {
    const checked = checkGstin(b.gstin);
    if (checked.ok) gstin = checked.value;
    else errors.push({ field: "gstin", problem: checked.problem });
  } else if (b.gstin !== null && b.gstin !== undefined && b.gstin !== "") {
    errors.push({ field: "gstin", problem: "format" });
  }
  if (typeof b.hasUdyam !== "boolean") errors.push({ field: "hasUdyam", problem: "invalid" });
  let udyamNumber: string | null = null;
  if (typeof b.udyamNumber === "string" && b.udyamNumber.trim() !== "") {
    const checked = checkUdyam(b.udyamNumber);
    if (!checked.ok) errors.push({ field: "udyamNumber", problem: checked.problem });
    else if (b.hasUdyam !== true) errors.push({ field: "udyamNumber", problem: "not_registered" });
    else udyamNumber = checked.value;
  } else if (b.udyamNumber !== null && b.udyamNumber !== undefined && b.udyamNumber !== "") {
    errors.push({ field: "udyamNumber", problem: "format" });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { applicantName, gstin, hasUdyam: b.hasUdyam as boolean, udyamNumber } };
}

export function kycRouter(deps: KycDeps): Router {
  const { catalogue, quoteStore, registries, store, reader, samples, today, nowMs, logger, service } = deps;
  const router = Router();
  const send = (res: Response, c: KycCase, status = 200) => res.status(status).json(service.view(c));

  const findCase = (req: Request, res: Response): KycCase | undefined => {
    const c = store.get(String(req.params.caseId));
    if (!c) res.status(404).json({ error: "case_not_found" });
    return c;
  };
  /** Server-side consent enforcement: nothing more is collected or processed without a valid consent record. */
  const consented = (c: KycCase, res: Response): boolean => {
    if (c.withdrawn) {
      res.status(403).json({ error: "consent_withdrawn", withdrawnOn: c.withdrawn.on });
      return false;
    }
    if (c.consent.noticeVersion !== CONSENT_VERSION) {
      res.status(403).json({ error: "consent_outdated", current: CONSENT_VERSION });
      return false;
    }
    return true;
  };
  const unsigned = (c: KycCase, res: Response): boolean => {
    if (c.esign?.signed) {
      res.status(409).json({ error: "case_signed" });
      return false;
    }
    return true;
  };
  /** A case the owner may still change: found, consent valid, not signed yet. */
  const editable = (req: Request, res: Response): KycCase | undefined => {
    const c = findCase(req, res);
    return c && consented(c, res) && unsigned(c, res) ? c : undefined;
  };

  // ---- retention periods and purposes (consent screen, My data) ----
  router.get("/privacy/retention", (_req, res) => {
    res.json({ retention: RETENTION, purposes: CONSENT_PURPOSES, noticeVersion: CONSENT_VERSION });
  });

  // ---- lookup first: before consent, nothing stored ----
  // Only the public business registries (GST, Udyam) are looked up with the business identifiers,
  // so the consent screen can list just the documents this journey still needs.
  router.post("/kyc/lookup", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    let business: { applicantName: string; gstin: string | null; hasUdyam: boolean; udyamNumber: string | null };
    if (body.sampleId !== undefined) {
      const sample = samples.find((s) => s.id === body.sampleId);
      if (!sample) return void res.status(400).json({ error: "sample_not_found" });
      business = { applicantName: "", gstin: sample.gstin, hasUdyam: sample.hasUdyam, udyamNumber: null };
    } else {
      const parsed = parseBusiness({ ...body, applicantName: "Lookup Only" });
      if (!parsed.ok) return void res.status(400).json({ error: "invalid_request", details: parsed.errors });
      business = { ...parsed.value, applicantName: "" };
    }
    let quote: ReturnType<QuoteStore["get"]> = undefined;
    if (body.quoteId !== undefined && body.quoteId !== null) {
      quote = typeof body.quoteId === "string" ? quoteStore.get(body.quoteId) : undefined;
      if (!quote) return void res.status(400).json({ error: "quote_not_found" });
    }
    const evaluation = { ...evaluateKyc({ business, documents: {}, submitted: false }, registries, today()), review: null };
    const readiness = assessReadiness({
      kycCase: { caseId: "KYC-PREVIEW", business, documents: {}, submitted: false, authorisation: null, answers: {}, attributionCode: quote?.attributionCode ?? null },
      evaluation,
      quote,
      catalogue,
      registries,
      cities: service.d.cities,
      today: today(),
    });
    const { gst, udyam } = evaluation.registry;
    const needed = DOC_TYPES.filter((d) => evaluation.documents[d].need === "required");
    res.json({
      mock: true,
      registry: {
        gst: gst && { gstin: maskGstin(gst.gstin), legalName: gst.legalName, tradeName: gst.tradeName, constitution: gst.constitution, address: gst.address, state: gst.state, status: gst.status },
        udyam: udyam && { udyamNumber: maskUdyam(udyam.udyamNumber), enterpriseName: udyam.enterpriseName, city: udyam.city, state: udyam.state },
      },
      gstin: evaluation.gstin,
      documents: Object.fromEntries(DOC_TYPES.map((d) => [d, evaluation.documents[d].need])),
      documentsNeeded: needed,
      documentsNotNeeded: DOC_TYPES.length - needed.length,
      readiness,
    });
  });

  // ---- consent ----
  router.post("/kyc/cases", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const consent = (body.consent ?? {}) as Record<string, unknown>;
    if (consent.accepted !== true) return void res.status(400).json({ error: "consent_required" });
    if (consent.version !== CONSENT_VERSION) return void res.status(400).json({ error: "consent_version", current: CONSENT_VERSION });
    // Specific consent: every purpose KYC needs, each named (no blanket "service improvement").
    const purposes = consent.purposes;
    if (!Array.isArray(purposes) || !CONSENT_PURPOSES.every((p) => purposes.includes(p)) || !purposes.every((p) => (CONSENT_PURPOSES as readonly unknown[]).includes(p))) {
      return void res.status(400).json({ error: "consent_purposes", required: CONSENT_PURPOSES });
    }
    if (consent.marketing !== undefined && typeof consent.marketing !== "boolean") return void res.status(400).json({ error: "invalid_request" });
    const lang = body.lang === "hi" ? "hi" : body.lang === "en" || body.lang === undefined ? "en" : null;
    const channel = body.channel === undefined ? "app" : (CONSENT_CHANNELS as readonly unknown[]).includes(body.channel) ? (body.channel as ConsentChannel) : null;
    if (!lang || !channel) return void res.status(400).json({ error: "invalid_request" });
    let quoteId: string | null = null;
    if (body.quoteId !== undefined && body.quoteId !== null) {
      if (typeof body.quoteId !== "string" || !quoteStore.get(body.quoteId)) return void res.status(400).json({ error: "quote_not_found" });
      quoteId = body.quoteId;
    }
    const attribution = parseAttribution(body.attributionCode);
    if (!attribution.ok) return void res.status(400).json({ error: "invalid_request" });
    // A partner who referred the quote keeps the credit when the owner does KYC on their own.
    const c = store.create(
      { purposes: purposes as ConsentPurpose[], marketing: consent.marketing === true, lang, channel },
      quoteId,
      attribution.code ?? (quoteId ? (quoteStore.get(quoteId)?.attributionCode ?? null) : null),
    );
    logger.info("kyc consent given", { caseId: c.caseId, version: CONSENT_VERSION, channel, marketing: c.consent.marketing });
    send(res, c, 201);
  });

  router.get("/kyc/cases/:caseId", (req, res) => {
    const c = findCase(req, res);
    if (c) send(res, c);
  });

  /** Save and return: the owner came back to an application with its reference. */
  router.post("/kyc/cases/:caseId/resume", (req, res) => {
    const c = findCase(req, res);
    if (!c) return;
    if (!c.withdrawn) c.journey.resumes += 1;
    send(res, c);
  });

  // Withdraw consent (or ?cancel=true: cancel unfinished onboarding). Everything collected for KYC
  // is deleted at once; the consent record and the deletion log stay as proof.
  router.delete("/kyc/cases/:caseId", (req, res) => {
    const c = findCase(req, res);
    if (!c) return;
    if (c.withdrawn) return void res.json({ withdrawn: true, deleted: true, deletedOn: c.withdrawn.on, orderStopped: false });
    const { orderStopped } = service.withdraw(c, req.query.cancel === "true");
    res.json({ withdrawn: true, deleted: true, deletedOn: c.withdrawn!.on, orderStopped });
  });

  // ---- My data ----
  router.get("/kyc/cases/:caseId/my-data", (req, res) => {
    const c = findCase(req, res);
    if (c) res.json(service.myData(c));
  });

  router.post("/kyc/cases/:caseId/documents/delete", (req, res) => {
    const c = findCase(req, res);
    if (!c || !consented(c, res)) return;
    service.deleteDocuments(c);
    res.json(service.myData(c));
  });

  // ---- business details + lookups ----
  router.put("/kyc/cases/:caseId/business", (req, res) => {
    const c = editable(req, res);
    if (!c) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.sampleId !== undefined) {
      const sample = samples.find((s) => s.id === body.sampleId);
      if (!sample) return void res.status(400).json({ error: "sample_not_found" });
      c.business = { applicantName: sample.applicantName, gstin: sample.gstin, hasUdyam: sample.hasUdyam, udyamNumber: null };
      c.sampleId = sample.id;
    } else {
      const parsed = parseBusiness(body);
      if (!parsed.ok) return void res.status(400).json({ error: "invalid_request", details: parsed.errors });
      c.business = parsed.value;
      c.sampleId = null;
    }
    send(res, c);
  });

  // ---- documents ----
  const rawImage = express.raw({ type: [...IMAGE_TYPES], limit: MAX_IMAGE_BYTES });
  router.put("/kyc/cases/:caseId/documents/:docType", rawImage, async (req, res) => {
    const c = editable(req, res);
    if (!c) return;
    const docType = req.params.docType;
    if (!isDocType(docType)) return void res.status(400).json({ error: "invalid_doc_type" });
    if (!c.business) return void res.status(409).json({ error: "business_details_missing" });
    const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (!(IMAGE_TYPES as readonly string[]).includes(contentType) || !Buffer.isBuffer(req.body)) {
      return void res.status(415).json({ error: "unsupported_type" });
    }
    if (req.body.length === 0) return void res.status(400).json({ error: "empty_upload" });
    try {
      const bytes = new Uint8Array(req.body);
      const reading = await reader.read(bytes, contentType, docType);
      if (!store.get(c.caseId) || c.withdrawn) return void res.status(403).json({ error: "consent_withdrawn" }); // withdrawn meanwhile
      service.storeDocument(c, docType, bytes, reading);
      logger.info("kyc document read", { caseId: c.caseId, docType, readable: reading.readable });
      send(res, c);
    } catch (err) {
      if (!(err instanceof DocumentReadError)) throw err;
      logger.warn("kyc document not read", { caseId: c.caseId, docType, reason: err.kind });
      const status = err.kind === "unavailable" ? 503 : err.kind === "too_large" ? 413 : err.kind === "unsupported_type" ? 415 : 422;
      res.status(status).json({ error: err.kind === "unavailable" ? "ocr_unavailable" : err.kind });
    }
  });

  router.delete("/kyc/cases/:caseId/documents/:docType", (req, res) => {
    const c = editable(req, res);
    if (!c) return;
    if (!isDocType(req.params.docType)) return void res.status(400).json({ error: "invalid_doc_type" });
    store.deleteFiles(c, service.d.vault, today(), "owner_request", req.params.docType);
    delete c.documents[req.params.docType];
    send(res, c);
  });

  router.post("/kyc/cases/:caseId/submit", (req, res) => {
    const c = editable(req, res);
    if (!c) return;
    if (!c.business) return void res.status(409).json({ error: "business_details_missing" });
    service.submit(c);
    send(res, c);
  });

  // ---- No Dead Ends: the fixes the readiness check offers ----
  /** Switch to the alternative bundle the readiness check offers (the rules engine builds it). */
  router.post("/kyc/cases/:caseId/alternative", (req, res) => {
    const c = editable(req, res);
    if (!c) return;
    const kind = (req.body ?? {}).kind as AlternativeKind;
    const quote = service.quoteOf(c);
    const offered = service.refresh(c).readiness?.blockers.find((b) => b.alternative?.kind === kind && (b.status === "open" || b.status === "in_progress"));
    if (!quote || !offered) return void res.status(409).json({ error: "no_alternative" });
    const gstin = service.evaluate(c).gstin === "none" ? "none" : "inactive";
    const alt = buildAlternative(kind, quote, catalogue, gstin);
    if (!alt) return void res.status(409).json({ error: "no_alternative" });
    const accepted = quoteStore.accept(alt.request, alt.quote, quote.attributionCode ?? c.attributionCode);
    c.quoteId = accepted.quoteId;
    c.alternativesAccepted += 1;
    logger.info("alternative accepted", { caseId: c.caseId, kind, quoteId: accepted.quoteId });
    send(res, c);
  });

  /** "Did you mean ...?" one-tap confirm (K06). The suggestion is recomputed here, never taken from the request. */
  router.post("/kyc/cases/:caseId/gstin-suggestion", (req, res) => {
    const c = editable(req, res);
    if (!c) return;
    if (!c.business) return void res.status(409).json({ error: "business_details_missing" });
    const suggestion = suggestGstin(c.documents.gst_certificate, registries);
    if (!suggestion) return void res.status(409).json({ error: "no_suggestion" });
    c.certGstinConfirmed = { printed: suggestion.printed, gstin: suggestion.gstin };
    if (c.business.gstin !== suggestion.gstin) c.business = { ...c.business, gstin: suggestion.gstin };
    logger.info("gstin suggestion confirmed", { caseId: c.caseId });
    send(res, c);
  });

  /** MOCK e-sign link to the registered owner, who authorises the person signing (K10). */
  router.post("/kyc/cases/:caseId/authorisation", (req, res) => {
    const c = editable(req, res);
    if (!c) return;
    if (!c.business) return void res.status(409).json({ error: "business_details_missing" });
    if (!service.evaluate(c).issues.some((i) => i.code === "SIGNATORY_NOT_VERIFIED")) return void res.status(409).json({ error: "not_needed" });
    c.authorisation = { ...startEsign(nowMs()), sentOn: today() };
    logger.info("owner authorisation link sent (MOCK)", { caseId: c.caseId });
    res.json({
      mock: true,
      sentTo: c.business.applicantName,
      // MOCK: no SMS or e-mail is sent; the code is shown so the demo can play the owner signing.
      otp: c.authorisation.otp,
      note: "MOCK e-sign link: nothing is sent; the registered owner's code is shown for the demo.",
      case: service.view(c),
    });
  });

  router.post("/kyc/cases/:caseId/authorisation/sign", (req, res) => {
    const c = editable(req, res);
    if (!c) return;
    if (!c.authorisation) return void res.status(409).json({ error: "authorisation_not_sent" });
    const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
    const outcome = verifyEsign(c.authorisation, otp, agreementFor(c, service.evaluate(c), service.quoteOf(c), today()), nowMs(), today());
    if (!outcome.ok) {
      const status = outcome.error === "wrong_otp" ? 400 : outcome.error === "too_many_attempts" ? 429 : 409;
      return void res.status(status).json({ error: outcome.error, attemptsLeft: outcome.attemptsLeft });
    }
    logger.info("owner authorised the signatory (MOCK e-sign)", { caseId: c.caseId });
    send(res, c);
  });

  /** The owner answers the team's question while a review is open (K07). */
  router.post("/kyc/cases/:caseId/answers", (req, res) => {
    const c = editable(req, res);
    if (!c) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const answer = typeof b.answer === "string" ? b.answer.trim().replace(/\s+/g, " ") : "";
    const blocker = service.refresh(c).readiness?.blockers.find((x) => x.id === b.blockerId && x.question);
    if (!blocker) return void res.status(404).json({ error: "question_not_found" });
    if (!answer || answer.length > 300) return void res.status(400).json({ error: "invalid_request", details: ["answer must be 1 to 300 characters"] });
    c.answers[blocker.id] = { answer: maskIdentifiers(answer), on: today() };
    logger.info("owner answered a review question", { caseId: c.caseId, blocker: blocker.id });
    send(res, c);
  });

  // ---- MOCK e-sign ----
  router.post("/kyc/cases/:caseId/esign/start", (req, res) => {
    const c = editable(req, res);
    if (!c) return;
    const evaluation = service.evaluate(c);
    if (!c.submitted || evaluation.status !== "pass") return void res.status(409).json({ error: "kyc_not_passed", status: evaluation.status });
    c.esign = startEsign(nowMs());
    res.json({
      mock: true,
      otp: c.esign.otp,
      note: "MOCK e-sign: no SMS is sent and no legal signature is made.",
      agreement: agreementFor(c, evaluation, service.quoteOf(c), today()),
    });
  });

  router.post("/kyc/cases/:caseId/esign/verify", (req, res) => {
    const c = findCase(req, res);
    if (!c || !consented(c, res)) return;
    if (!c.esign) return void res.status(409).json({ error: "esign_not_started" });
    const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
    const outcome = verifyEsign(c.esign, otp, agreementFor(c, service.evaluate(c), service.quoteOf(c), today()), nowMs(), today());
    if (!outcome.ok) {
      const status = outcome.error === "wrong_otp" ? 400 : outcome.error === "too_many_attempts" ? 429 : 409;
      return void res.status(status).json({ error: outcome.error, attemptsLeft: outcome.attemptsLeft });
    }
    logger.info("kyc e-signed (MOCK)", { caseId: c.caseId });
    send(res, c);
  });

  // ---- MOCK registry lookups ----
  router.get("/lookup/gstin/:gstin", (req, res) => {
    const checked = checkGstin(String(req.params.gstin));
    if (!checked.ok) return void res.status(400).json({ error: "invalid_gstin", problem: checked.problem });
    const r = registries.gst.get(checked.value);
    if (!r) return void res.status(404).json({ mock: true, found: false });
    const { gstin, ...rest } = r;
    res.json({ mock: true, found: true, source: "mock_gstin_registry.csv", gstin: maskGstin(gstin), ...rest });
  });

  router.get("/lookup/udyam/:udyamNumber", (req, res) => {
    const checked = checkUdyam(String(req.params.udyamNumber));
    if (!checked.ok) return void res.status(400).json({ error: "invalid_udyam", problem: checked.problem });
    const r = registries.udyam.get(checked.value);
    if (!r) return void res.status(404).json({ mock: true, found: false });
    const { udyamNumber, ...rest } = r;
    res.json({ mock: true, found: true, source: "mock_udyam_registry.csv", udyamNumber: maskUdyam(udyamNumber), ...rest });
  });

  // ---- DEMO sample applicants ----
  router.get("/kyc/samples", (_req, res) => {
    res.json({ samples: samples.map((s) => ({ id: s.id, businessName: s.businessName, documents: s.documents })) });
  });

  router.get("/kyc/samples/:sampleId/documents/:docType", (req, res) => {
    const { sampleId, docType } = req.params;
    const sample = SAMPLE_ID_RE.test(sampleId) ? samples.find((s) => s.id === sampleId) : undefined;
    if (!sample || !isDocType(docType) || !sample.documents.includes(docType)) return void res.status(404).json({ error: "not_found" });
    res.type("png").sendFile(sampleImagePath(sample.id, docType, deps.documentsDir));
  });

  // A body over the size limit, or a broken JSON body, on these routes.
  const bodyErrors: ErrorRequestHandler = (err, _req, res, next) => {
    if (err?.type === "entity.too.large") return void res.status(413).json({ error: "too_large" });
    next(err);
  };
  router.use(bodyErrors);
  return router;
}
