import { checkAiService } from "./aiClient.js";
import { createApp } from "./app.js";
import { type Catalogue, DEFAULT_CATALOGUE_PATH, loadCatalogue } from "./catalogue/catalogue.js";
import { loadConfig, loadRootEnv, SERVICE_NAME, SERVICE_VERSION } from "./config.js";
import { createLogger } from "./logger.js";

const envLoaded = loadRootEnv();
const config = loadConfig();
const logger = createLogger({ service: SERVICE_NAME, level: config.logLevel });

let catalogue: Catalogue;
try {
  catalogue = loadCatalogue();
} catch (err) {
  logger.error("could not load the product catalogue", { path: DEFAULT_CATALOGUE_PATH, error: err });
  process.exit(1);
}

const app = createApp({
  logger,
  checkAiService: () => checkAiService(config.aiServiceUrl, config.aiServiceTimeoutMs),
  catalogue,
});

const server = app.listen(config.port, () => {
  logger.info("backend listening", {
    url: `http://localhost:${config.port}`,
    version: SERVICE_VERSION,
    aiServiceUrl: config.aiServiceUrl,
    products: catalogue.products.length,
    envFile: envLoaded ? ".env loaded" : "no .env (using defaults)",
  });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error(`port ${config.port} is already in use; set BACKEND_PORT in .env`);
  } else {
    logger.error("server error", { error: err });
  }
  process.exit(1);
});

const shutdown = (signal: string) => {
  logger.info("shutting down", { signal });
  server.close(() => process.exit(0));
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
