import request from "supertest";
import { describe, expect, it } from "vitest";
import { makeTestApp } from "../testApp.js";

const profile = { cityTier: 2, employees: 3, sites: 1, gstin: "none" };

describe("GET /api/cities", () => {
  it("returns the 22 cities in the leads data with their tier", async () => {
    const { app } = makeTestApp();
    const res = await request(app).get("/api/cities");
    expect(res.status).toBe(200);
    expect(res.body.cities).toHaveLength(22);
    expect(res.body.cities).toContainEqual({ name: "Mumbai", state: "Maharashtra", tier: 1 });
    expect(res.body.cities).toContainEqual({ name: "Kochi", state: "Kerala", tier: 2 });
    expect(res.body.cities.filter((c: { tier: number }) => c.tier === 1)).toHaveLength(8);
  });
});

describe("POST /api/quote", () => {
  it("returns the live quote for a selection", async () => {
    const { app } = makeTestApp();
    const res = await request(app).post("/api/quote").send({ segment: "micro", profile, include: ["P19"] });
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ monthlyInr: 2196, setupInr: 3500, contractMonths: 12 });
  });

  it("returns 422 with the reason when a selection breaks a rule", async () => {
    const { app } = makeTestApp();
    const res = await request(app).post("/api/quote").send({ segment: "micro", profile, include: ["P15"] });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: "not_allowed",
      problems: [
        {
          productId: "P15",
          action: "add",
          reasons: [expect.objectContaining({ code: "GSTIN_REQUIRED", message: "WhatsApp Business API Starter needs a valid, active GSTIN." })],
        },
      ],
    });
  });

  it("returns 400 for malformed requests", async () => {
    const { app } = makeTestApp();
    const bad = await request(app).post("/api/quote").send({ segment: "micro", profile, include: "P19" });
    expect(bad.status).toBe(400);
    expect(bad.body.details).toEqual(["include must be an array of product ids (at most 50)"]);
    const notInBundle = await request(app).post("/api/quote").send({ segment: "micro", profile, exclude: ["P10"] });
    expect(notInBundle.status).toBe(400);
    expect(notInBundle.body.details).toEqual(["exclude: P10 is not in the Dukaan Digital Starter bundle"]);
  });
});

describe("POST /api/quotes and GET /api/quotes/:id", () => {
  it("accepts a quote, recomputes the price on the server and stores it for 7 days from today", async () => {
    const { app } = makeTestApp();
    const res = await request(app)
      .post("/api/quotes")
      .send({ segment: "micro", profile, include: ["P19"], totals: { monthlyInr: 1 } });
    expect(res.status).toBe(201);
    expect(res.body.quoteId).toMatch(/^Q-[0-9A-F]{8}$/);
    expect(res.body).toMatchObject({ acceptedOn: "2026-07-15", validUntil: "2026-07-22" });
    expect(res.body.quote.totals.monthlyInr).toBe(2196); // not the 1 sent by the client

    const got = await request(app).get(`/api/quotes/${res.body.quoteId}`);
    expect(got.status).toBe(200);
    expect(got.body.quote.totals.monthlyInr).toBe(2196);
  });

  it("does not accept a quote that breaks a rule", async () => {
    const { app } = makeTestApp();
    const res = await request(app).post("/api/quotes").send({ segment: "micro", profile, include: ["P15"] });
    expect(res.status).toBe(422);
  });

  it("returns 404 for unknown or malformed quote ids", async () => {
    const { app } = makeTestApp();
    expect((await request(app).get("/api/quotes/Q-00000000")).status).toBe(404);
    expect((await request(app).get("/api/quotes/../../etc")).status).toBe(404);
  });
});
