import type { AdvisorLlm } from "../src/advisor/llm.js";
import { LeadStore } from "../src/advisor/leads.js";
import type { AiServiceStatus } from "../src/aiClient.js";
import { createApp } from "../src/app.js";
import { loadCatalogue } from "../src/catalogue/catalogue.js";
import { loadCities } from "../src/cities.js";
import { TODAY } from "../src/clock.js";
import { createLogger } from "../src/logger.js";
import { QuoteStore } from "../src/quote/store.js";

export const catalogue = loadCatalogue();
export const cities = loadCities();

/** App wired with the real data files, a capturing logger and a stub ai-service check. */
export function makeTestApp(
  ai: AiServiceStatus = { status: "ok", version: "0.1.0", latencyMs: 1 },
  options: { advisorLlm?: AdvisorLlm } = {},
) {
  const logLines: string[] = [];
  const logger = createLogger({ service: "backend", level: "info", sink: (l) => logLines.push(l) });
  const quoteStore = new QuoteStore(() => TODAY);
  const leadStore = new LeadStore(() => TODAY);
  const app = createApp({ logger, checkAiService: async () => ai, catalogue, cities, quoteStore, leadStore, advisorLlm: options.advisorLlm });
  return { app, logLines, quoteStore, leadStore };
}
