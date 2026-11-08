import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AiServiceStatus } from "../src/aiClient.js";
import { createApp } from "../src/app.js";
import { loadCatalogue } from "../src/catalogue/catalogue.js";
import { createLogger } from "../src/logger.js";

const catalogue = loadCatalogue();

function makeApp(ai: AiServiceStatus) {
  const lines: string[] = [];
  const logger = createLogger({ service: "backend", level: "info", sink: (l) => lines.push(l) });
  const app = createApp({ logger, checkAiService: async () => ai, catalogue });
  return { app, lines };
}

const AI_OK: AiServiceStatus = { status: "ok", version: "0.1.0", latencyMs: 3 };
const AI_DOWN: AiServiceStatus = { status: "unreachable", reason: "connection failed" };

describe("GET /api/health", () => {
  it("returns ok with service name and version", async () => {
    const { app } = makeApp(AI_OK);
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "backend", version: "0.1.0" });
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("GET /api/health/full", () => {
  it("returns 200 ok when the ai-service is up", async () => {
    const { app } = makeApp(AI_OK);
    const res = await request(app).get("/api/health/full");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      services: { backend: { status: "ok", version: "0.1.0" }, aiService: AI_OK },
    });
  });

  it("returns 503 degraded when the ai-service is unreachable", async () => {
    const { app } = makeApp(AI_DOWN);
    const res = await request(app).get("/api/health/full");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.services.backend.status).toBe("ok");
    expect(res.body.services.aiService).toEqual(AI_DOWN);
  });
});

describe("errors and logging", () => {
  it("returns JSON 404 for unknown routes", async () => {
    const { app } = makeApp(AI_OK);
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });

  it("returns 400 for malformed JSON without echoing it back", async () => {
    const { app } = makeApp(AI_OK);
    const res = await request(app)
      .post("/api/health")
      .set("content-type", "application/json")
      .send('{"gstin": "27XUIXG0767D1ZP"');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "bad_request" });
  });

  it("logs each request with the identifier in the path masked", async () => {
    const { app, lines } = makeApp(AI_OK);
    await request(app).get("/api/lookup/27XUIXG0767D1ZP");
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("27XUIXG0767D1ZP");
    expect(JSON.parse(lines[0]!)).toMatchObject({
      msg: "request",
      method: "GET",
      path: "/api/lookup/27XUIX******1ZP",
      status: 404,
    });
  });

  it("never logs request bodies", async () => {
    const { app, lines } = makeApp(AI_OK);
    await request(app).post("/api/anything").send({ secretDoc: "SHOULD-NOT-APPEAR" });
    expect(lines.join("\n")).not.toContain("SHOULD-NOT-APPEAR");
  });
});
