import request from "supertest";
import { describe, expect, it } from "vitest";
import { makeTestApp } from "../testApp.js";

const { app } = makeTestApp();

describe("GET /api/catalogue", () => {
  it("returns all 25 products", async () => {
    const res = await request(app).get("/api/catalogue");
    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(25);
    expect(res.body.products[0]).toMatchObject({ id: "P01", name: "Biz Fibre 100", priceMinInr: 999 });
  });
});

describe("GET /api/bundles/templates", () => {
  it("lists the five templates", async () => {
    const res = await request(app).get("/api/bundles/templates");
    expect(res.body.templates.map((t: { id: string }) => t.id)).toEqual([
      "dukaan-digital-starter",
      "dukaan-digital-starter-lite",
      "office-pro",
      "chain-connect",
      "factory-connect",
    ]);
  });
});

describe("POST /api/bundles/build", () => {
  it("builds Chain Connect with the outline's totals", async () => {
    const res = await request(app)
      .post("/api/bundles/build")
      .send({ segment: "multi", profile: { cityTier: 2, employees: 15, sites: 3, gstin: "active" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      templateId: "chain-connect",
      variant: "standard",
      price: { monthlyInr: 19182, setupInr: 34300, contractMonths: 24 },
      removed: [],
    });
  });

  it("builds Starter Lite", async () => {
    const res = await request(app)
      .post("/api/bundles/build")
      .send({ segment: "micro", variant: "lite", profile: { cityTier: 1, employees: 2, sites: 1, gstin: "none" } });
    expect(res.status).toBe(200);
    expect(res.body.price.monthlyInr).toBe(1198);
  });

  it("returns 400 with every problem listed for a bad request", async () => {
    const res = await request(app)
      .post("/api/bundles/build")
      .send({ segment: "shop", variant: "lite", profile: { cityTier: 3, employees: 0, sites: 1.5, gstin: "yes" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.details).toEqual([
      "segment must be one of micro, prof, multi, mfg",
      "variant lite exists only for segment micro",
      "profile.cityTier must be 1 or 2",
      "profile.employees must be a whole number from 1 to 100000",
      "profile.sites must be a whole number from 1 to 1000",
      "profile.gstin must be one of active, inactive, none",
    ]);
  });

  it("rejects a missing profile and strings instead of numbers", async () => {
    expect((await request(app).post("/api/bundles/build").send({ segment: "micro" })).body.details).toEqual([
      "profile must be an object",
    ]);
    const res = await request(app)
      .post("/api/bundles/build")
      .send({ segment: "micro", profile: { cityTier: "1", employees: "3", sites: 1, gstin: "none" } });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/eligibility", () => {
  it("returns eligibility and reasons per product, using the list as the bundle", async () => {
    const res = await request(app)
      .post("/api/eligibility")
      .send({ productIds: ["P04", "P22", "P09", "P15"], profile: { cityTier: 2, employees: 3, sites: 1, gstin: "none" } });
    expect(res.status).toBe(200);
    expect(
      res.body.results.map((r: { productId: string; eligible: boolean; violations: { code: string }[] }) => [
        r.productId,
        r.eligible,
        r.violations.map((v) => v.code),
      ]),
    ).toEqual([
      ["P04", true, []],
      ["P22", true, []],
      ["P09", false, ["REQUIRES_ONE_OF"]],
      ["P15", false, ["GSTIN_REQUIRED"]],
    ]);
  });

  it("rejects unknown, duplicate and missing product ids", async () => {
    const profile = { cityTier: 1, employees: 1, sites: 1, gstin: "none" };
    const res = await request(app).post("/api/eligibility").send({ productIds: ["P01", "P01", "P99", 7], profile });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([
      "product id P01 is listed twice",
      'unknown product id "P99"',
      "unknown product id 7",
    ]);
    expect((await request(app).post("/api/eligibility").send({ productIds: [], profile })).status).toBe(400);
  });
});
