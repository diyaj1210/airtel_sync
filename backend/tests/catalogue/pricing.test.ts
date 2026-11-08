import { describe, expect, it } from "vitest";
import { loadCatalogue } from "../../src/catalogue/catalogue.js";
import { priceBundle } from "../../src/catalogue/pricing.js";
import { loadActivatedLeads } from "./leadsData.js";

const catalogue = loadCatalogue();

describe("priceBundle", () => {
  it("uses catalogue minimum price as list price and charges setup per unit", () => {
    const price = priceBundle(catalogue, [
      { productId: "P23", qty: 3 }, // CCTV 199/camera, setup 1800/camera
      { productId: "P02", qty: 1 }, // Fibre 300: 1499, no setup
    ]);
    expect(price.monthlyInr).toBe(3 * 199 + 1499);
    expect(price.monthlyMaxInr).toBe(3 * 299 + 1799);
    expect(price.setupInr).toBe(3 * 1800);
    expect(price.lines[0]).toMatchObject({ productId: "P23", unitPriceInr: 199, monthlyInr: 597, setupInr: 5400 });
  });

  it("contract = longest minimum contract, install ETA = longest install time", () => {
    const price = priceBundle(catalogue, [
      { productId: "P04", qty: 1 }, // 6 months, 2 days
      { productId: "P07", qty: 1 }, // 1 month, 1 day
      { productId: "P22", qty: 1 }, // 12 months, 3 days
    ]);
    expect(price.contractMonths).toBe(12);
    expect(price.installDays).toBe(3);
  });

  it("rejects empty bundles, unknown products, duplicates and bad quantities", () => {
    expect(() => priceBundle(catalogue, [])).toThrow(/at least one product/);
    expect(() => priceBundle(catalogue, [{ productId: "P99", qty: 1 }])).toThrow(/Unknown product/);
    expect(() =>
      priceBundle(catalogue, [
        { productId: "P01", qty: 1 },
        { productId: "P01", qty: 2 },
      ]),
    ).toThrow(/appears twice/);
    for (const qty of [0, -1, 1.5, Number.NaN]) {
      expect(() => priceBundle(catalogue, [{ productId: "P01", qty }])).toThrow(/whole number/);
    }
  });
});

describe("cross-check with the 368 activated bundles in smb_leads.csv", () => {
  const leads = loadActivatedLeads();

  it("setup fee = Σ setup × qty for every bundle (setup is per unit)", () => {
    const mismatches = leads.filter((l) => priceBundle(catalogue, l.lines).setupInr !== l.setupInr);
    expect(mismatches.map((l) => l.leadId)).toEqual([]);
  });

  it("every sold monthly value lies inside the catalogue price range", () => {
    const outside = leads.filter((l) => {
      const p = priceBundle(catalogue, l.lines);
      return l.monthlyValueInr < p.monthlyInr || l.monthlyValueInr > p.monthlyMaxInr;
    });
    expect(outside.map((l) => l.leadId)).toEqual([]);
  });
});
