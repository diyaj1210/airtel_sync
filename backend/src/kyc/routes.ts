import express, { Router, type ErrorRequestHandler, type Request, type Response } from "express";
import type { Catalogue } from "../catalogue/catalogue.js";
import type { Logger } from "../logger.js";
import type { QuoteStore } from "../quote/store.js";
import { evaluateKyc, type BusinessDetails } from "./checks.js";
import { DocumentReadError, IMAGE_TYPES, isDocType, MAX_IMAGE_BYTES, type DocumentReader } from "./documents.js";
import { startEsign, verifyEsign } from "./esign.js";
import { checkGstin, checkUdyam, maskGstin, maskUdyam } from "./identifiers.js";
import type { Registries } from "./registry.js";
import { sampleImagePath, SAMPLE_ID_RE, type SampleApplicant } from "./samples.js";
import { CONSENT_VERSION, type KycCase, type KycCaseStore } from "./store.js";
import { agreementFor, caseView } from "./view.js";

/**
 *   POST   /api/kyc/cases                          consent given -> new case          { consent: {accepted, version}, lang, quoteId? }
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
 * Identifiers leave the server only masked. Images are never stored or logged.
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
  const { catalogue, quoteStore, registries, store, reader, samples, today, nowMs, logger } = deps;
  const router = Router();
  const quoteOf = (c: KycCase) => (c.quoteId ? quoteStore.get(c.quoteId) : undefined);
  const evaluate = (c: KycCase) => evaluateKyc({ business: c.business, documents: c.documents, submitted: c.submitted }, registries, today());
  const send = (res: Response, c: KycCase, status = 200) => res.status(status).json(caseView(c, evaluate(c), quoteOf(c), catalogue));

  const findCase = (req: Request, res: Response): KycCase | undefined => {
    const c = store.get(String(req.params.caseId));
    if (!c) res.status(404).json({ error: "case_not_found" });
    return c;
  };
  const unsigned = (c: KycCase, res: Response): boolean => {
    if (c.esign?.signed) {
      res.status(409).json({ error: "case_signed" });
      return false;
    }
    return true;
  };

  // ---- consent ----
  router.post("/kyc/cases", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const consent = (body.consent ?? {}) as Record<string, unknown>;
    if (consent.accepted !== true) return void res.status(400).json({ error: "consent_required" });
    if (consent.version !== CONSENT_VERSION) return void res.status(400).json({ error: "consent_version", current: CONSENT_VERSION });
    const lang = body.lang === "hi" ? "hi" : body.lang === "en" || body.lang === undefined ? "en" : null;
    if (!lang) return void res.status(400).json({ error: "invalid_request" });
    let quoteId: string | null = null;
    if (body.quoteId !== undefined && body.quoteId !== null) {
      if (typeof body.quoteId !== "string" || !quoteStore.get(body.quoteId)) return void res.status(400).json({ error: "quote_not_found" });
      quoteId = body.quoteId;
    }
    const c = store.create(lang, quoteId);
    logger.info("kyc consent given", { caseId: c.caseId, version: CONSENT_VERSION });
    send(res, c, 201);
  });

  router.get("/kyc/cases/:caseId", (req, res) => {
    const c = findCase(req, res);
    if (c) send(res, c);
  });

  router.delete("/kyc/cases/:caseId", (req, res) => {
    const c = findCase(req, res);
    if (!c) return;
    store.delete(c.caseId);
    logger.info("kyc consent withdrawn, case deleted", { caseId: c.caseId });
    res.json({ withdrawn: true, deleted: true });
  });

  // ---- business details + lookups ----
  router.put("/kyc/cases/:caseId/business", (req, res) => {
    const c = findCase(req, res);
    if (!c || !unsigned(c, res)) return;
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
    const c = findCase(req, res);
    if (!c || !unsigned(c, res)) return;
    const docType = req.params.docType;
    if (!isDocType(docType)) return void res.status(400).json({ error: "invalid_doc_type" });
    if (!c.business) return void res.status(409).json({ error: "business_details_missing" });
    const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (!(IMAGE_TYPES as readonly string[]).includes(contentType) || !Buffer.isBuffer(req.body)) {
      return void res.status(415).json({ error: "unsupported_type" });
    }
    if (req.body.length === 0) return void res.status(400).json({ error: "empty_upload" });
    try {
      const reading = await reader.read(new Uint8Array(req.body), contentType, docType);
      if (!store.get(c.caseId)) return void res.status(404).json({ error: "case_not_found" }); // withdrawn meanwhile
      c.documents[docType] = reading;
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
    const c = findCase(req, res);
    if (!c || !unsigned(c, res)) return;
    if (!isDocType(req.params.docType)) return void res.status(400).json({ error: "invalid_doc_type" });
    delete c.documents[req.params.docType];
    send(res, c);
  });

  router.post("/kyc/cases/:caseId/submit", (req, res) => {
    const c = findCase(req, res);
    if (!c || !unsigned(c, res)) return;
    if (!c.business) return void res.status(409).json({ error: "business_details_missing" });
    c.submitted = true;
    const evaluation = evaluate(c);
    logger.info("kyc checked", { caseId: c.caseId, status: evaluation.status, issues: evaluation.issues.map((i) => i.code) });
    send(res, c);
  });

  // ---- MOCK e-sign ----
  router.post("/kyc/cases/:caseId/esign/start", (req, res) => {
    const c = findCase(req, res);
    if (!c || !unsigned(c, res)) return;
    const evaluation = evaluate(c);
    if (!c.submitted || evaluation.status !== "pass") return void res.status(409).json({ error: "kyc_not_passed", status: evaluation.status });
    c.esign = startEsign(nowMs());
    res.json({
      mock: true,
      otp: c.esign.otp,
      note: "MOCK e-sign: no SMS is sent and no legal signature is made.",
      agreement: agreementFor(c, evaluation, quoteOf(c), today()),
    });
  });

  router.post("/kyc/cases/:caseId/esign/verify", (req, res) => {
    const c = findCase(req, res);
    if (!c) return;
    if (!c.esign) return void res.status(409).json({ error: "esign_not_started" });
    const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
    const outcome = verifyEsign(c.esign, otp, agreementFor(c, evaluate(c), quoteOf(c), today()), nowMs(), today());
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
