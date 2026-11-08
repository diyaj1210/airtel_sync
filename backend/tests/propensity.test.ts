import request from "supertest";
import { describe, expect, it } from "vitest";
import { createAiServicePropensity, parseScoreRequest, type PropensityApi } from "../src/propensity/client.js";
import { makeTestApp } from "./testApp.js";

const SCORE = {
  id: "L00001",
  probability: 0.12,
  score: 81,
  band: "high",
  reasons: [{ feature: "lead_source", value: "Referral", effect: "up", weight: 0.71 }],
};

/** A stand-in ai-service: records calls and answers with what the test gives it. */
function fakeApi(answer: (method: string, path: string, body?: unknown) => { status: number; body: unknown }) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const api: PropensityApi = {
    async call(method, path, body) {
      calls.push({ method, path, body });
      return answer(method, path, body);
    },
  };
  return { api, calls };
}

const appWith = (api: PropensityApi) => request(makeTestApp(undefined, { propensity: api }).app);

describe("propensity API (backend)", () => {
  it("passes a valid request on and returns the scores", async () => {
    const { api, calls } = fakeApi(() => ({ status: 200, body: { scores: [SCORE] } }));
    const res = await appWith(api).post("/api/propensity/score").send({ leads: [{ id: "L00001", lead: { lead_source: "Referral" } }] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scores: [SCORE] });
    expect(calls).toEqual([{ method: "POST", path: "/propensity/score", body: { leads: [{ id: "L00001", lead: { lead_source: "Referral" } }] } }]);
  });

  it("validates requests before calling the ai-service", async () => {
    const { api, calls } = fakeApi(() => ({ status: 200, body: { scores: [] } }));
    const app = appWith(api);
    expect((await app.post("/api/propensity/score").send({})).status).toBe(400);
    expect((await app.post("/api/propensity/score").send({ leads: [] })).status).toBe(400);
    expect((await app.post("/api/propensity/score").send({ leads: [{ lead: {}, extra: 1 }] })).status).toBe(400);
    expect(parseScoreRequest({ leads: Array.from({ length: 501 }, () => ({ lead: {} })) })).toMatch(/1 to 500/);
    expect(parseScoreRequest({ leads: [{ id: "x".repeat(41), lead: {} }] })).toMatch(/at most 40/);
    expect((await app.get("/api/propensity/leads/whatever")).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("passes the ai-service's field problems on (422)", async () => {
    const problem = { error: "invalid_lead", index: 0, problems: [{ field: "segment", problem: "unknown_value" }] };
    const { api } = fakeApi(() => ({ status: 422, body: problem }));
    const res = await appWith(api).post("/api/propensity/score").send({ leads: [{ lead: { segment: "x" } }] });
    expect(res.status).toBe(422);
    expect(res.body).toEqual(problem);
  });

  it.each([
    ["service down", { status: 503, body: { error: "model_unavailable" } }],
    ["score out of range", { status: 200, body: { scores: [{ ...SCORE, score: 140 }] } }],
    ["unknown band", { status: 200, body: { scores: [{ ...SCORE, band: "maybe" }] } }],
    ["too many reasons", { status: 200, body: { scores: [{ ...SCORE, reasons: Array(4).fill(SCORE.reasons[0]) }] } }],
    ["wrong count", { status: 200, body: { scores: [] } }],
    ["not JSON object", { status: 200, body: "oops" }],
  ])("treats a bad answer as unavailable: %s", async (_name, answer) => {
    const { api } = fakeApi(() => answer);
    const res = await appWith(api).post("/api/propensity/score").send({ leads: [{ lead: {} }] });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "propensity_unavailable" });
  });

  it("scores a lead from the data, and shows the model card", async () => {
    const card = { model: "logistic_regression", metrics: { logisticRegression: { testAuc: 0.67 } } };
    const { api, calls } = fakeApi((_m, path) =>
      path === "/propensity/model" ? { status: 200, body: card } : path.endsWith("L00001") ? { status: 200, body: SCORE } : { status: 404, body: { error: "lead_not_found" } },
    );
    const app = appWith(api);
    expect((await app.get("/api/propensity/leads/L00001")).body).toEqual(SCORE);
    expect((await app.get("/api/propensity/leads/L99999")).status).toBe(404);
    expect((await app.get("/api/propensity/model")).body).toEqual(card);
    expect(calls.map((c) => c.path)).toEqual(["/propensity/leads/L00001", "/propensity/leads/L99999", "/propensity/model"]);
  });

  it("without an ai-service every endpoint answers 503", async () => {
    const app = request(makeTestApp().app);
    expect((await app.get("/api/propensity/model")).status).toBe(503);
    expect((await app.post("/api/propensity/score").send({ leads: [{ lead: {} }] })).status).toBe(503);
    expect((await app.get("/api/propensity/leads/L00001")).status).toBe(503);
  });

  it("client: network errors and timeouts become 503; answers pass through", async () => {
    const down = createAiServicePropensity("http://x", 50, async () => {
      throw new TypeError("connection refused");
    });
    expect(await down.call("GET", "/propensity/model")).toEqual({ status: 503, body: { error: "propensity_unavailable" } });
    const ok = createAiServicePropensity("http://x", 50, async (url, init) => {
      expect(url).toBe("http://x/propensity/score");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ scores: [] }), { status: 200 });
    });
    expect(await ok.call("POST", "/propensity/score", { leads: [] })).toEqual({ status: 200, body: { scores: [] } });
  });
});
