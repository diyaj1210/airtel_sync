import { describe, expect, it } from "vitest";
import { loadCatalogue } from "../../src/catalogue/catalogue.js";
import { checkBundle, checkProduct, type RuleCode } from "../../src/catalogue/rules.js";
import type { BusinessProfile } from "../../src/catalogue/types.js";
import { loadActivatedLeads } from "./leadsData.js";

const catalogue = loadCatalogue();
const base: BusinessProfile = { cityTier: 1, employees: 50, sites: 5, gstin: "active" };
const codes = (id: string, profile: Partial<BusinessProfile>, bundle: string[] = []) =>
  checkProduct(catalogue.get(id), { ...base, ...profile }, bundle).map((v) => v.code);

describe("rule: available_city_tiers", () => {
  it("P03 Biz Fibre 1G is sold in tier 1 only", () => {
    expect(codes("P03", { cityTier: 1 })).toEqual([]);
    expect(codes("P03", { cityTier: 2 })).toEqual(["CITY_TIER"]);
  });

  it("every other product is sold in both tiers", () => {
    for (const p of catalogue.products.filter((p) => p.id !== "P03")) {
      expect(checkProduct(p, { ...base, cityTier: 2 }, ["P01", "P02", "P03", "P04", "P05"]).map((v) => v.code)).not.toContain("CITY_TIER");
    }
  });
});

describe("rule: min_employees (offered at or above the minimum)", () => {
  it.each([
    ["P03", 5],
    ["P05", 10],
    ["P06", 25],
    ["P10", 10],
    ["P12", 3],
    ["P21", 10],
    ["P24", 10],
  ])("%s needs at least %i employees", (id, min) => {
    const bundle = ["P01", "P02", "P05"];
    expect(codes(id, { employees: min - 1 }, bundle)).toContain("MIN_EMPLOYEES");
    expect(codes(id, { employees: min }, bundle)).not.toContain("MIN_EMPLOYEES");
  });
});

describe("rule: min_sites", () => {
  it("P10 Managed SD-WAN needs at least 3 sites", () => {
    expect(codes("P10", { sites: 2 }, ["P02"])).toEqual(["MIN_SITES"]);
    expect(codes("P10", { sites: 3 }, ["P02"])).toEqual([]);
  });
});

describe("rule: requires_gstin = Y needs a valid, active GSTIN", () => {
  it.each(["P03", "P05", "P06", "P10", "P12", "P13", "P14", "P15", "P21", "P24"])("%s", (id) => {
    const bundle = ["P02", "P05"];
    expect(codes(id, { gstin: "active" }, bundle)).not.toContain("GSTIN_REQUIRED");
    expect(codes(id, { gstin: "none" }, bundle)).toContain("GSTIN_REQUIRED");
    expect(codes(id, { gstin: "inactive" }, bundle)).toContain("GSTIN_REQUIRED");
  });

  it("explains a cancelled/suspended GSTIN differently from a missing one", () => {
    const none = checkProduct(catalogue.get("P15"), { ...base, gstin: "none" }, []);
    const inactive = checkProduct(catalogue.get("P15"), { ...base, gstin: "inactive" }, []);
    expect(none[0]!.message).toMatch(/needs a valid, active GSTIN/);
    expect(inactive[0]!.message).toMatch(/cancelled or suspended/);
  });

  it("products without the flag do not need a GSTIN", () => {
    expect(codes("P01", { gstin: "none" })).toEqual([]);
    expect(codes("P07", { gstin: "inactive" })).toEqual([]);
  });
});

describe("rule: requires_one_of (in the same bundle)", () => {
  it("P09 failover needs a wired line (P01/P02/P03/P05/P06), not AirFiber", () => {
    expect(codes("P09", {}, [])).toEqual(["REQUIRES_ONE_OF"]);
    expect(codes("P09", {}, ["P04"])).toEqual(["REQUIRES_ONE_OF"]);
    for (const dep of ["P01", "P02", "P03", "P05", "P06"]) expect(codes("P09", {}, [dep])).toEqual([]);
  });

  it("P22 Secure Wi-Fi accepts AirFiber (P04)", () => {
    expect(codes("P22", {}, ["P04"])).toEqual([]);
  });

  it("P11 Static IP needs fibre (P01/P02/P03), not a leased line", () => {
    expect(codes("P11", {}, ["P05"])).toEqual(["REQUIRES_ONE_OF"]);
    expect(codes("P11", {}, ["P03"])).toEqual([]);
  });

  it("a product never satisfies its own dependency", () => {
    expect(codes("P09", {}, ["P09"])).toEqual(["REQUIRES_ONE_OF"]);
  });
});

describe("several rules at once", () => {
  it("reports every broken rule, in a fixed order", () => {
    expect(codes("P10", { cityTier: 2, employees: 2, sites: 1, gstin: "none" }, [])).toEqual([
      "MIN_EMPLOYEES",
      "MIN_SITES",
      "GSTIN_REQUIRED",
      "REQUIRES_ONE_OF",
    ]);
    expect(codes("P03", { cityTier: 2, employees: 1, gstin: "inactive" })).toEqual([
      "CITY_TIER",
      "MIN_EMPLOYEES",
      "GSTIN_REQUIRED",
    ]);
  });
});

describe("checkBundle", () => {
  it("validates a whole bundle using the bundle for dependencies", () => {
    const micro: BusinessProfile = { cityTier: 2, employees: 3, sites: 1, gstin: "none" };
    const ok = checkBundle(catalogue, [{ productId: "P04", qty: 1 }, { productId: "P22", qty: 1 }], micro);
    expect(ok.valid).toBe(true);
    const bad = checkBundle(catalogue, [{ productId: "P22", qty: 1 }, { productId: "P15", qty: 1 }], micro);
    expect(bad.valid).toBe(false);
    expect(bad.lines.map((l) => [l.productId, l.violations.map((v) => v.code)])).toEqual([
      ["P22", ["REQUIRES_ONE_OF"]],
      ["P15", ["GSTIN_REQUIRED"]],
    ]);
  });
});

describe("cross-check with past sales in smb_leads.csv", () => {
  // scripts/verify_outline.py (an independent Python implementation) finds 49 product lines in
  // the 368 activated bundles that break catalogue rules: tier 24, GSTIN 12, requires_one_of 9,
  // min_employees 8. Our engine must find exactly the same.
  it("flags exactly the 49 rule-breaking lines, by the same rules", () => {
    const leads = loadActivatedLeads();
    expect(leads).toHaveLength(368);
    let badLines = 0;
    const byCode: Partial<Record<RuleCode, number>> = {};
    for (const lead of leads) {
      for (const line of checkBundle(catalogue, lead.lines, lead.profile).lines) {
        if (!line.eligible) badLines++;
        for (const v of line.violations) byCode[v.code] = (byCode[v.code] ?? 0) + 1;
      }
    }
    expect(badLines).toBe(49);
    expect(byCode).toEqual({ CITY_TIER: 24, GSTIN_REQUIRED: 12, REQUIRES_ONE_OF: 9, MIN_EMPLOYEES: 8 });
  });
});
