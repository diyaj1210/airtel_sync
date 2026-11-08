import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import type { AiServiceStatus } from "./aiClient.js";
import type { Catalogue } from "./catalogue/catalogue.js";
import { catalogueRouter } from "./catalogue/routes.js";
import type { City } from "./cities.js";
import { SERVICE_NAME, SERVICE_VERSION } from "./config.js";
import type { Logger } from "./logger.js";
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
}

export function createApp({ logger, checkAiService, catalogue, cities, quoteStore }: AppDeps): Express {
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
