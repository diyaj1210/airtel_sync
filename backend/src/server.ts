import { createAiServiceLlm } from "./advisor/llm.js";
import { checkAiService } from "./aiClient.js";
import { createApp } from "./app.js";
import { type Catalogue, DEFAULT_CATALOGUE_PATH, loadCatalogue } from "./catalogue/catalogue.js";
import { type City, DEFAULT_LEADS_PATH, loadCities } from "./cities.js";
import { TODAY } from "./clock.js";
import { loadConfig, loadRootEnv, SERVICE_NAME, SERVICE_VERSION } from "./config.js";
import { createAiServiceReader } from "./kyc/documents.js";
import { DEFAULT_GSTIN_REGISTRY_PATH, loadRegistries, type Registries } from "./kyc/registry.js";
import { loadSamples, type SampleApplicant } from "./kyc/samples.js";
import { createLogger } from "./logger.js";
import { createAiServicePropensity } from "./propensity/client.js";
import { QuoteStore } from "./quote/store.js";

const envLoaded = loadRootEnv();
const config = loadConfig();
const logger = createLogger({ service: SERVICE_NAME, level: config.logLevel });

let catalogue: Catalogue;
let cities: City[];
try {
  catalogue = loadCatalogue();
} catch (err) {
  logger.error("could not load the product catalogue", { path: DEFAULT_CATALOGUE_PATH, error: err });
  process.exit(1);
}
try {
  cities = loadCities();
} catch (err) {
  logger.error("could not load the city list", { path: DEFAULT_LEADS_PATH, error: err });
  process.exit(1);
}

let registries: Registries;
let kycSamples: SampleApplicant[];
try {
  registries = loadRegistries();
  kycSamples = loadSamples();
} catch (err) {
  logger.error("could not load the mock GSTIN / Udyam registries or the sample applicants", { path: DEFAULT_GSTIN_REGISTRY_PATH, error: err });
  process.exit(1);
}

const app = createApp({
  logger,
  checkAiService: () => checkAiService(config.aiServiceUrl, config.aiServiceTimeoutMs),
  catalogue,
  cities,
  quoteStore: new QuoteStore(() => TODAY),
  advisorLlm: createAiServiceLlm(config.aiServiceUrl, config.advisorTimeoutMs),
  registries,
  kycSamples,
  documentReader: createAiServiceReader(config.aiServiceUrl, config.kycOcrTimeoutMs),
  propensity: createAiServicePropensity(config.aiServiceUrl, config.propensityTimeoutMs),
});

const server = app.listen(config.port, () => {
  logger.info("backend listening", {
    url: `http://localhost:${config.port}`,
    version: SERVICE_VERSION,
    aiServiceUrl: config.aiServiceUrl,
    products: catalogue.products.length,
    registries: `${registries.gst.size} GSTINs, ${registries.udyam.size} Udyam numbers (mock)`,
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
