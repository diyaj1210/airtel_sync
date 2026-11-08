import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SERVICE_NAME = "backend";
export const SERVICE_VERSION = "0.1.0";

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  port: number;
  aiServiceUrl: string;
  logLevel: LogLevel;
  aiServiceTimeoutMs: number;
  /** Advisor calls to the ai-service (Gemini answers in 1-3 s; after this the advisor uses its rules). */
  advisorTimeoutMs: number;
  /** Reading one KYC document (OCR: 1-5 s; the first one also loads the models). */
  kycOcrTimeoutMs: number;
  /** Scoring up to 500 leads (milliseconds of arithmetic; the first call also loads the data). */
  propensityTimeoutMs: number;
}

/** Repo root: backend/src (dev, via tsx) and backend/dist (built) are both two levels down. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Load the shared root .env into process.env if it exists. Values already set in the
 * environment win (Node's loadEnvFile does not override existing variables).
 */
export function loadRootEnv(envPath = resolve(REPO_ROOT, ".env")): boolean {
  if (!existsSync(envPath)) return false;
  process.loadEnvFile(envPath);
  return true;
}

function parsePort(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535, got "${raw}"`);
  }
  return value;
}

function parseLogLevel(raw: string | undefined): LogLevel {
  const value = (raw ?? "info").trim().toLowerCase();
  if (!(LOG_LEVELS as readonly string[]).includes(value)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}, got "${raw}"`);
  }
  return value as LogLevel;
}

function parseUrl(name: string, raw: string | undefined, fallback: string): string {
  const value = raw === undefined || raw.trim() === "" ? fallback : raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid http(s) URL, got "${value}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be an http(s) URL, got "${value}"`);
  }
  return value.replace(/\/+$/, "");
}

/** Build the config from environment variables. Pure: pass `env` in tests. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: parsePort("BACKEND_PORT", env.BACKEND_PORT, 4000),
    aiServiceUrl: parseUrl("AI_SERVICE_URL", env.AI_SERVICE_URL, "http://127.0.0.1:8000"),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    aiServiceTimeoutMs: 2000,
    advisorTimeoutMs: 15000,
    kycOcrTimeoutMs: 60000,
    propensityTimeoutMs: 10000,
  };
}
