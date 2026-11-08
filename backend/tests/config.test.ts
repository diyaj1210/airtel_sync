import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, loadRootEnv } from "../src/config.js";

describe("loadConfig", () => {
  it("uses safe defaults when nothing is set", () => {
    expect(loadConfig({})).toEqual({
      port: 4000,
      aiServiceUrl: "http://127.0.0.1:8000",
      logLevel: "info",
      aiServiceTimeoutMs: 2000,
      advisorTimeoutMs: 15000,
      kycOcrTimeoutMs: 60000,
      propensityTimeoutMs: 10000,
    });
  });

  it("reads values from the environment and trims a trailing slash from the URL", () => {
    const config = loadConfig({ BACKEND_PORT: "4100", AI_SERVICE_URL: "http://127.0.0.1:8100/", LOG_LEVEL: "DEBUG" });
    expect(config).toMatchObject({ port: 4100, aiServiceUrl: "http://127.0.0.1:8100", logLevel: "debug" });
  });

  it.each(["0", "70000", "abc", "40.5"])("rejects invalid BACKEND_PORT %s", (port) => {
    expect(() => loadConfig({ BACKEND_PORT: port })).toThrow(/BACKEND_PORT/);
  });

  it("rejects an invalid AI_SERVICE_URL", () => {
    expect(() => loadConfig({ AI_SERVICE_URL: "not a url" })).toThrow(/AI_SERVICE_URL/);
    expect(() => loadConfig({ AI_SERVICE_URL: "ftp://x" })).toThrow(/AI_SERVICE_URL/);
  });

  it("rejects an unknown LOG_LEVEL", () => {
    expect(() => loadConfig({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });
});

describe("loadRootEnv", () => {
  const KEY = "UDYAM_TEST_ONLY_VAR";
  afterEach(() => {
    delete process.env[KEY];
  });

  it("returns false when the file does not exist", () => {
    expect(loadRootEnv(join(tmpdir(), "does-not-exist-udyam", ".env"))).toBe(false);
  });

  it("loads variables from an .env file", () => {
    const dir = mkdtempSync(join(tmpdir(), "udyam-env-"));
    const file = join(dir, ".env");
    writeFileSync(file, `${KEY}=from-file\n`);
    expect(loadRootEnv(file)).toBe(true);
    expect(process.env[KEY]).toBe("from-file");
  });
});
