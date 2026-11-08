import type { AdvisorLlm } from "../src/advisor/llm.js";
import { LeadStore } from "../src/advisor/leads.js";
import type { AiServiceStatus } from "../src/aiClient.js";
import { createApp } from "../src/app.js";
import { loadCatalogue } from "../src/catalogue/catalogue.js";
import { loadCities } from "../src/cities.js";
import { TODAY } from "../src/clock.js";
import type { DocumentReader } from "../src/kyc/documents.js";
import { loadRegistries } from "../src/kyc/registry.js";
import { loadSamples } from "../src/kyc/samples.js";
import { KycCaseStore } from "../src/kyc/store.js";
import { createLogger } from "../src/logger.js";
import { OrderStore } from "../src/orders/store.js";
import { QuoteStore } from "../src/quote/store.js";

export const catalogue = loadCatalogue();
export const cities = loadCities();
export const registries = loadRegistries();
export const kycSamples = loadSamples();

/** App wired with the real data files, a capturing logger and a stub ai-service check. */
export function makeTestApp(
  ai: AiServiceStatus = { status: "ok", version: "0.1.0", latencyMs: 1 },
  options: { advisorLlm?: AdvisorLlm; documentReader?: DocumentReader; nowMs?: () => number } = {},
) {
  const logLines: string[] = [];
  const logger = createLogger({ service: "backend", level: "info", sink: (l) => logLines.push(l) });
  const quoteStore = new QuoteStore(() => TODAY);
  const leadStore = new LeadStore(() => TODAY);
  const kycStore = new KycCaseStore(() => TODAY);
  const orderStore = new OrderStore();
  const app = createApp({
    logger,
    checkAiService: async () => ai,
    catalogue,
    cities,
    quoteStore,
    leadStore,
    advisorLlm: options.advisorLlm,
    registries,
    kycSamples,
    kycStore,
    orderStore,
    documentReader: options.documentReader,
    nowMs: options.nowMs,
  });
  return { app, logLines, quoteStore, leadStore, kycStore, orderStore };
}
