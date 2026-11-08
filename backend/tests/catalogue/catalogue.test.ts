import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOGUE_PATH, loadCatalogue, parseCatalogue } from "../../src/catalogue/catalogue.js";

const realCsv = readFileSync(DEFAULT_CATALOGUE_PATH, "utf8");

describe("loadCatalogue (data/raw/product_catalogue.csv)", () => {
  const catalogue = loadCatalogue();

  it("loads all 25 products, P01..P25 in order", () => {
    expect(catalogue.products.map((p) => p.id)).toEqual(
      Array.from({ length: 25 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`),
    );
  });

  it("parses a plain product correctly (P01)", () => {
    expect(catalogue.get("P01")).toEqual({
      id: "P01",
      category: "Connectivity",
      name: "Biz Fibre 100",
      description: "Business fibre broadband, 100 Mbps, unlimited data",
      unit: "per site",
      priceMinInr: 999,
      priceMaxInr: 1199,
      setupInr: 0,
      minContractMonths: 12,
      cityTiers: [1, 2],
      minEmployees: 1,
      minSites: 1,
      requiresGstin: false,
      requiresOneOf: [],
      installDays: 5,
      targetSegments: ["micro", "prof"],
    });
  });

  it("parses the rule columns that matter", () => {
    expect(catalogue.get("P03")).toMatchObject({ cityTiers: [1], minEmployees: 5, requiresGstin: true });
    expect(catalogue.get("P10")).toMatchObject({
      minEmployees: 10,
      minSites: 3,
      requiresGstin: true,
      requiresOneOf: ["P01", "P02", "P03", "P05", "P06"],
      minContractMonths: 24,
      installDays: 14,
    });
    expect(catalogue.get("P22").requiresOneOf).toEqual(["P01", "P02", "P03", "P04"]);
    expect(catalogue.get("P05")).toMatchObject({ setupInr: 10000, installDays: 21, minEmployees: 10 });
  });

  it("matches the catalogue's rule counts", () => {
    const ps = catalogue.products;
    expect(ps.filter((p) => p.requiresGstin).map((p) => p.id)).toEqual([
      "P03", "P05", "P06", "P10", "P12", "P13", "P14", "P15", "P21", "P24",
    ]);
    expect(ps.filter((p) => p.requiresOneOf.length > 0).map((p) => p.id)).toEqual([
      "P09", "P10", "P11", "P12", "P21", "P22", "P23",
    ]);
    expect(ps.filter((p) => !p.cityTiers.includes(2)).map((p) => p.id)).toEqual(["P03"]);
  });

  it("throws for an unknown product id", () => {
    expect(() => catalogue.get("P99")).toThrow(/Unknown product "P99"/);
  });
});

describe("parseCatalogue validation", () => {
  const header = realCsv.split(/\r?\n/)[0]!;
  const p01 = realCsv.split(/\r?\n/)[1]!;
  const withRow = (row: string) => `${header}\n${row}\n`;

  it("accepts the real file", () => {
    expect(parseCatalogue(realCsv).products).toHaveLength(25);
  });

  it("rejects a missing column", () => {
    expect(() => parseCatalogue("product_id,category\nP01,x\n")).toThrow(/missing column/);
  });

  it("rejects an unknown city tier", () => {
    expect(() => parseCatalogue(withRow(p01.replace(",1;2,", ",1;3,")))).toThrow(/unknown tier "3"/);
  });

  it("rejects a max price below the min price", () => {
    expect(() => parseCatalogue(withRow(p01.replace(",999,1199,", ",999,500,")))).toThrow(/below price_min/);
  });

  it("rejects a non-integer number", () => {
    expect(() => parseCatalogue(withRow(p01.replace(",999,1199,", ",abc,1199,")))).toThrow(/price_min_inr_per_month/);
  });

  it("rejects a bad requires_gstin flag", () => {
    expect(() => parseCatalogue(withRow(p01.replace(",N,,5,", ",maybe,,5,")))).toThrow(/requires_gstin/);
  });

  it("rejects a dependency on an unknown product", () => {
    expect(() => parseCatalogue(withRow(p01.replace(",N,,5,", ",N,P77,5,")))).toThrow(/unknown product "P77"/);
  });

  it("rejects duplicate product ids", () => {
    expect(() => parseCatalogue(`${header}\n${p01}\n${p01}\n`)).toThrow(/duplicate product_id "P01"/);
  });
});
