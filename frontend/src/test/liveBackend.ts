/**
 * Test helper: start the REAL backend (same code as `npm run dev` in backend/) on a free port,
 * so UI tests exercise the real rules engine, prices and quote API instead of hand-written fakes.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { LeadStore } from "../../../backend/src/advisor/leads";
import type { AdvisorLlm } from "../../../backend/src/advisor/llm";
import { createApp } from "../../../backend/src/app";
import { loadCatalogue } from "../../../backend/src/catalogue/catalogue";
import { loadCities } from "../../../backend/src/cities";
import { TODAY } from "../../../backend/src/clock";
import type { DocumentReader } from "../../../backend/src/kyc/documents";
import { loadRegistries } from "../../../backend/src/kyc/registry";
import { loadSamples } from "../../../backend/src/kyc/samples";
import { KycCaseStore } from "../../../backend/src/kyc/store";
import { createLogger } from "../../../backend/src/logger";
import { QuoteStore } from "../../../backend/src/quote/store";

export interface LiveBackend {
  /** Drop-in for window.fetch: relative /api URLs go to the live backend. */
  fetchFn: typeof fetch;
  /** Request bodies sent to the backend, in order (for asserting what the UI sent). */
  requests: { method: string; url: string; body: unknown }[];
  /** Make the next requests to a path fail as if the network were down. */
  failNext: (pathPrefix: string, times?: number) => void;
  /** Leads saved by the advisor (to check what the back-office receives). */
  leadStore: LeadStore;
  /** KYC cases (to check what is kept, and that withdrawing deletes it). */
  kycStore: KycCaseStore;
  close: () => Promise<void>;
}

export const catalogue = loadCatalogue();
const registries = loadRegistries();
const kycSamples = loadSamples();

export async function startBackend(options: { advisorLlm?: AdvisorLlm; documentReader?: DocumentReader } = {}): Promise<LiveBackend> {
  const leadStore = new LeadStore(() => TODAY);
  const kycStore = new KycCaseStore(() => TODAY);
  const app = createApp({
    logger: createLogger({ service: "backend", level: "silent" }),
    checkAiService: async () => ({ status: "ok", version: "0.1.0", latencyMs: 1 }),
    catalogue,
    cities: loadCities(),
    quoteStore: new QuoteStore(() => TODAY),
    leadStore,
    advisorLlm: options.advisorLlm,
    registries,
    kycSamples,
    kycStore,
    documentReader: options.documentReader,
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const requests: LiveBackend["requests"] = [];
  const failures: { prefix: string; times: number }[] = [];

  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    requests.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const failure = failures.find((f) => url.startsWith(f.prefix) && f.times > 0);
    if (failure) {
      failure.times--;
      throw new TypeError("Failed to fetch");
    }
    return fetch(`http://127.0.0.1:${port}${url}`, init);
  };

  return {
    fetchFn,
    requests,
    failNext: (prefix, times = 1) => failures.push({ prefix, times }),
    leadStore,
    kycStore,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
