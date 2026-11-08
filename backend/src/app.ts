import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import { AdvisorEngine } from "./advisor/engine.js";
import { LeadStore } from "./advisor/leads.js";
import { LlmGate, NO_LLM, type AdvisorLlm } from "./advisor/llm.js";
import { advisorRouter } from "./advisor/routes.js";
import { AdvisorSessionStore } from "./advisor/sessions.js";
import type { AiServiceStatus } from "./aiClient.js";
import type { Catalogue } from "./catalogue/catalogue.js";
import { catalogueRouter } from "./catalogue/routes.js";
import type { City } from "./cities.js";
import { StaffSessions } from "./backoffice/auth.js";
import { loadBusinessTypes, loadCrmLeads, type CrmLead } from "./backoffice/crm.js";
import { backofficeRouter } from "./backoffice/routes.js";
import { BackofficeScoring } from "./backoffice/scoring.js";
import { whatsappRouter } from "./channels/routes.js";
import { WhatsAppBot } from "./channels/whatsapp.js";
import { TODAY } from "./clock.js";
import { SERVICE_NAME, SERVICE_VERSION } from "./config.js";
import { NO_READER, type DocumentReader } from "./kyc/documents.js";
import type { Registries } from "./kyc/registry.js";
import { kycRouter } from "./kyc/routes.js";
import type { SampleApplicant } from "./kyc/samples.js";
import { KycCaseStore } from "./kyc/store.js";
import type { Logger } from "./logger.js";
import { ordersRouter } from "./orders/routes.js";
import { OrderStore } from "./orders/store.js";
import { NO_PROPENSITY, propensityRouter, type PropensityApi } from "./propensity/client.js";
import { quoteRouter } from "./quote/routes.js";
import type { QuoteStore } from "./quote/store.js";

export interface AppDeps {
  logger: Logger;
  /** Returns the ai-service health. Injected so tests need no running ai-service. */
  checkAiService: () => Promise<AiServiceStatus>;
  /** Product catalogue, loaded once at startup from data/raw/product_catalogue.csv. */
  catalogue: Catalogue;
  /** Cities served, with tier (from smb_leads.csv). */
  cities: City[];
  /** Accepted quotes (in memory). */
  quoteStore: QuoteStore;
  /** The advisor's language model (via the ai-service). Default: none, the advisor runs on rules. */
  advisorLlm?: AdvisorLlm;
  /** Advisor chats (in memory). */
  advisorSessions?: AdvisorSessionStore;
  /** Leads the advisor could not close (in memory). */
  leadStore?: LeadStore;
  /** Clock for pausing the LLM after failures and for e-sign OTP expiry (tests inject one). */
  nowMs?: () => number;
  /** Mock GSTIN / Udyam registries (data/raw CSVs). */
  registries: Registries;
  /** DEMO sample applicants K01-K12. */
  kycSamples: SampleApplicant[];
  /** Folder of the sample document images (tests may point elsewhere). */
  kycDocumentsDir?: string;
  /** Reads document images (OCR in the ai-service). Default: none, every upload answers 503. */
  documentReader?: DocumentReader;
  /** KYC cases (in memory). */
  kycStore?: KycCaseStore;
  /** Orders placed after the MOCK payment (in memory). */
  orderStore?: OrderStore;
  /** Lead propensity model (in the ai-service). Default: none, the endpoints answer 503. */
  propensity?: PropensityApi;
  /** MOCK staff sign-ins for the back-office (in memory). */
  staffSessions?: StaffSessions;
  /** Past-quarter dropped leads and the business types in smb_leads.csv (default: read once from the file). */
  crmLeads?: CrmLead[];
  businessTypes?: ReadonlySet<string>;
}

let leadsData: { crmLeads: CrmLead[]; businessTypes: Set<string> } | undefined;
const defaultLeadsData = () => (leadsData ??= { crmLeads: loadCrmLeads(), businessTypes: loadBusinessTypes() });

export function createApp({
  logger,
  checkAiService,
  catalogue,
  cities,
  quoteStore,
  advisorLlm = NO_LLM,
  advisorSessions = new AdvisorSessionStore(),
  leadStore = new LeadStore(() => TODAY),
  nowMs = () => Date.now(),
  registries,
  kycSamples,
  kycDocumentsDir,
  documentReader = NO_READER,
  kycStore = new KycCaseStore(() => TODAY),
  orderStore = new OrderStore(),
  propensity = NO_PROPENSITY,
  staffSessions,
  crmLeads,
  businessTypes,
}: AppDeps): Express {
  const gate = new LlmGate(advisorLlm, (kind) => logger.warn("advisor LLM unavailable, answering by rules", { kind }), nowMs);
  const advisor = new AdvisorEngine({ catalogue, cities, gate, logger });
  const llmStatus = async () => {
    const status = await advisorLlm.status();
    return status.enabled
      ? { mode: gate.available() ? "gemini" : "basic", provider: status.provider, model: status.model, ...(gate.available() ? {} : { pausedAfter: gate.lastFailureKind }) }
      : { mode: "basic", reason: status.reason };
  };
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  // Request log: method, path (identifiers masked by the logger), status, duration.
  // Request bodies are never logged.
  const requestLog: RequestHandler = (req, res, next) => {
    const started = performance.now();
    res.on("finish", () => {
      logger.info("request", {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
      });
    });
    next();
  };
  app.use(requestLog);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: SERVICE_NAME, version: SERVICE_VERSION });
  });

  // Health of the whole chain the frontend depends on: backend + ai-service.
  app.get("/api/health/full", async (_req, res) => {
    const ai = await checkAiService();
    const healthy = ai.status === "ok";
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "degraded",
      services: {
        backend: { status: "ok", version: SERVICE_VERSION },
        aiService: ai,
      },
    });
  });

  app.use("/api", catalogueRouter(catalogue));
  app.use("/api", quoteRouter(catalogue, cities, quoteStore));
  app.use("/api", advisorRouter(advisor, advisorSessions, leadStore, llmStatus));
  app.use(
    "/api",
    kycRouter({
      catalogue,
      quoteStore,
      registries,
      store: kycStore,
      reader: documentReader,
      samples: kycSamples,
      documentsDir: kycDocumentsDir,
      today: () => TODAY,
      nowMs,
      logger,
      orderFor: (caseId) => orderStore.forCase(caseId)?.orderId ?? null,
    }),
  );
  app.use("/api", propensityRouter(propensity));
  app.use("/api", ordersRouter({ catalogue, quoteStore, registries, kycStore, orderStore, today: () => TODAY, logger }));
  // MOCK WhatsApp Business API webhook (step 8): the same advisor, quote, KYC and order code.
  const whatsapp = new WhatsAppBot({
    engine: advisor,
    advisorSessions,
    leadStore,
    catalogue,
    quoteStore,
    kycStore,
    registries,
    samples: kycSamples,
    reader: documentReader,
    orderStore,
    today: () => TODAY,
    nowMs,
    logger,
  });
  app.use("/api", whatsappRouter(whatsapp));
  app.use(
    "/api",
    backofficeRouter({
      sessions: staffSessions ?? new StaffSessions(nowMs),
      leadStore,
      quoteStore,
      kycStore,
      orderStore,
      catalogue,
      registries,
      crmLeads: crmLeads ?? defaultLeadsData().crmLeads,
      scoring: new BackofficeScoring(propensity, businessTypes ?? defaultLeadsData().businessTypes),
      today: () => TODAY,
      logger,
    }),
  );

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status =
      typeof err?.status === "number" && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) logger.error("unhandled error", { error: err });
    res.status(status).json({ error: status >= 500 ? "internal_error" : "bad_request" });
  };
  app.use(errorHandler);

  return app;
}
