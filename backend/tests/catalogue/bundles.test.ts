import { describe, expect, it } from "vitest";
import { buildBundle, filterToEligible, TEMPLATES, type BundleVariant } from "../../src/catalogue/bundles.js";
import { loadCatalogue } from "../../src/catalogue/catalogue.js";
import { checkBundle, checkProduct } from "../../src/catalogue/rules.js";
import { GSTIN_STATUSES, type BusinessProfile, type CityTier, type Segment } from "../../src/catalogue/types.js";

const catalogue = loadCatalogue();
const linesOf = (b: { lines: { productId: string; qty: number }[] }) =>
  Object.fromEntries(b.lines.map((l) => [l.productId, l.qty]));

describe("the bundles in solution_outline_chat/bundles-and-pricing.md", () => {
  it("1 Dukaan Digital Starter: ₹1,597 + ₹1,000 setup, 12 months, ~3 days", () => {
    const b = buildBundle(catalogue, "micro", { cityTier: 2, employees: 3, sites: 1, gstin: "none" });
    expect(linesOf(b)).toEqual({ P04: 1, P07: 1, P22: 1 });
    expect(b.price).toMatchObject({ monthlyInr: 1597, setupInr: 1000, contractMonths: 12, installDays: 3 });
    expect(b.removed).toEqual([]);
  });

  it("1b Starter Lite: ₹1,198, no setup, 6 months, ~2 days", () => {
    const b = buildBundle(catalogue, "micro", { cityTier: 2, employees: 3, sites: 1, gstin: "none" }, "lite");
    expect(linesOf(b)).toEqual({ P04: 1, P07: 1 });
    expect(b.price).toMatchObject({ monthlyInr: 1198, setupInr: 0, contractMonths: 6, installDays: 2 });
  });

  it("2 Office Pro (5 employees): ₹4,215 + ₹1,500 setup, 12 months", () => {
    const b = buildBundle(catalogue, "prof", { cityTier: 2, employees: 5, sites: 1, gstin: "none" });
    expect(linesOf(b)).toEqual({ P02: 1, P07: 2, P16: 5, P17: 1, P20: 5, P09: 1 });
    expect(b.price).toMatchObject({ monthlyInr: 4215, setupInr: 1500, contractMonths: 12, installDays: 5 });
  });

  it("3 Chain Connect (3 sites, 15 employees, GSTIN): ₹19,182 + ₹34,300 setup, 24 months", () => {
    const b = buildBundle(catalogue, "multi", { cityTier: 2, employees: 15, sites: 3, gstin: "active" });
    expect(linesOf(b)).toEqual({ P02: 3, P09: 3, P23: 6, P22: 3, P10: 3, P13: 1, P08: 3 });
    expect(b.price).toMatchObject({ monthlyInr: 19182, setupInr: 34300, contractMonths: 24, installDays: 14 });
  });

  it("4 Factory Connect (10 employees, GSTIN): ₹13,192 + ₹29,000 setup, 24 months", () => {
    const b = buildBundle(catalogue, "mfg", { cityTier: 2, employees: 10, sites: 1, gstin: "active" });
    expect(linesOf(b)).toEqual({ P05: 1, P21: 1, P24: 5, P16: 10, P08: 2 });
    expect(b.price).toMatchObject({ monthlyInr: 13192, setupInr: 29000, contractMonths: 24, installDays: 21 });
  });
});

describe("per-profile filtering and fallbacks", () => {
  it("Chain Connect with 2 sites drops SD-WAN (needs 3 sites) and the contract falls to 12 months", () => {
    const b = buildBundle(catalogue, "multi", { cityTier: 1, employees: 15, sites: 2, gstin: "active" });
    expect(b.lines.map((l) => l.productId)).not.toContain("P10");
    expect(b.removed).toEqual([
      expect.objectContaining({ productId: "P10", violations: [expect.objectContaining({ code: "MIN_SITES" })] }),
    ]);
    expect(b.price.contractMonths).toBe(12);
  });

  it("Chain Connect without GSTIN drops SD-WAN and toll-free", () => {
    const b = buildBundle(catalogue, "multi", { cityTier: 2, employees: 15, sites: 3, gstin: "none" });
    expect(b.removed.map((r) => r.productId).sort()).toEqual(["P10", "P13"]);
  });

  it("Factory Connect below 10 employees falls back to fibre + static IP + endpoint security", () => {
    const b = buildBundle(catalogue, "mfg", { cityTier: 2, employees: 8, sites: 1, gstin: "active" });
    expect(linesOf(b)).toEqual({ P16: 8, P08: 2, P02: 1, P11: 1, P20: 8 });
    expect(b.removed.map((r) => r.productId)).toEqual(["P05", "P21", "P24"]);
    expect(b.price.contractMonths).toBe(12);
  });

  it("Factory Connect with a cancelled GSTIN uses the same fallback and says why", () => {
    const b = buildBundle(catalogue, "mfg", { cityTier: 1, employees: 40, sites: 1, gstin: "inactive" });
    expect(b.lines.map((l) => l.productId)).toEqual(["P16", "P08", "P02", "P11", "P20"]);
    for (const r of b.removed) {
      expect(r.violations.map((v) => v.code)).toContain("GSTIN_REQUIRED");
    }
  });

  it("Office Pro scales email and endpoint security with headcount and fibre/failover with sites", () => {
    const b = buildBundle(catalogue, "prof", { cityTier: 1, employees: 12, sites: 2, gstin: "active" });
    expect(linesOf(b)).toEqual({ P02: 2, P07: 2, P16: 12, P17: 1, P20: 12, P09: 2 });
  });

  it("removal repeats until stable: dropping a line can break another line's dependency", () => {
    const profile: BusinessProfile = { cityTier: 2, employees: 30, sites: 1, gstin: "active" };
    const result = filterToEligible(
      catalogue,
      [
        { productId: "P03", qty: 1 }, // tier 1 only -> removed
        { productId: "P11", qty: 1 }, // needs P01/P02/P03 -> removed in the next round
        { productId: "P07", qty: 1 },
      ],
      profile,
    );
    expect(result.lines).toEqual([{ productId: "P07", qty: 1 }]);
    expect(result.removed.map((r) => [r.productId, r.violations[0]!.code])).toEqual([
      ["P03", "CITY_TIER"],
      ["P11", "REQUIRES_ONE_OF"],
    ]);
  });
});

describe("add-ons", () => {
  it("micro add-ons: WhatsApp API is offered but blocked without a GSTIN, with the reason", () => {
    const b = buildBundle(catalogue, "micro", { cityTier: 2, employees: 3, sites: 1, gstin: "none" });
    const byId = Object.fromEntries(b.addOns.map((a) => [a.productId, a]));
    expect(Object.keys(byId)).toEqual(["P19", "P23", "P18", "P15"]);
    expect(byId.P15!.eligible).toBe(false);
    expect(byId.P15!.violations.map((v) => v.code)).toEqual(["GSTIN_REQUIRED"]);
    expect(byId.P23!.eligible).toBe(true); // CCTV works on AirFiber
  });

  it("Office Pro: cloud telephony needs 3 employees and a GSTIN", () => {
    const small = buildBundle(catalogue, "prof", { cityTier: 1, employees: 2, sites: 1, gstin: "active" });
    expect(small.addOns.find((a) => a.productId === "P12")!.violations.map((v) => v.code)).toEqual(["MIN_EMPLOYEES"]);
    const ok = buildBundle(catalogue, "prof", { cityTier: 1, employees: 3, sites: 1, gstin: "active" });
    expect(ok.addOns.find((a) => a.productId === "P12")!.eligible).toBe(true);
  });

  it("Factory Connect: the 100 Mbps leased line upgrade replaces P05 and needs 25 employees", () => {
    const b10 = buildBundle(catalogue, "mfg", { cityTier: 2, employees: 10, sites: 1, gstin: "active" });
    const up10 = b10.addOns.find((a) => a.productId === "P06")!;
    expect(up10).toMatchObject({ replaces: "P05", eligible: false });
    const b25 = buildBundle(catalogue, "mfg", { cityTier: 2, employees: 25, sites: 1, gstin: "active" });
    expect(b25.addOns.find((a) => a.productId === "P06")).toMatchObject({ replaces: "P05", eligible: true, qty: 1 });
  });

  it("the P06 upgrade is not offered when the fallback (no leased line) is used", () => {
    const b = buildBundle(catalogue, "mfg", { cityTier: 2, employees: 8, sites: 1, gstin: "active" });
    expect(b.addOns.map((a) => a.productId)).not.toContain("P06");
  });

  it("never offers an add-on that is already in the bundle", () => {
    const b = buildBundle(catalogue, "mfg", { cityTier: 2, employees: 8, sites: 1, gstin: "active" });
    expect(b.lines.map((l) => l.productId)).toContain("P20");
    expect(b.addOns.map((a) => a.productId)).not.toContain("P20");
  });
});

describe("invariant over many business profiles: a built bundle never contains an ineligible product", () => {
  const tiers: CityTier[] = [1, 2];
  const employeeCounts = [1, 2, 3, 4, 5, 9, 10, 11, 24, 25, 26, 100];
  const siteCounts = [1, 2, 3, 4, 10];
  const variants: [Segment, BundleVariant][] = TEMPLATES.map((t) => [t.segment, t.variant]);

  it(`holds for ${variants.length * tiers.length * employeeCounts.length * siteCounts.length * GSTIN_STATUSES.length} combinations`, () => {
    let checked = 0;
    for (const [segment, variant] of variants)
      for (const cityTier of tiers)
        for (const employees of employeeCounts)
          for (const sites of siteCounts)
            for (const gstin of GSTIN_STATUSES) {
              const profile: BusinessProfile = { cityTier, employees, sites, gstin };
              const b = buildBundle(catalogue, segment, profile, variant);
              const label = JSON.stringify({ segment, variant, profile });

              expect(b.lines.length, label).toBeGreaterThan(0);
              expect(checkBundle(catalogue, b.lines, profile).valid, label).toBe(true);
              // pricing invariants
              const contract = Math.max(...b.lines.map((l) => catalogue.get(l.productId).minContractMonths));
              expect(b.price.contractMonths, label).toBe(contract);
              expect(b.price.monthlyInr, label).toBeLessThanOrEqual(b.price.monthlyMaxInr);
              // every removed line really is ineligible in the final bundle context
              const ids = b.lines.map((l) => l.productId);
              for (const r of b.removed) {
                expect(checkProduct(catalogue.get(r.productId), profile, [...ids, r.productId]).length, label).toBeGreaterThan(0);
              }
              // add-ons marked eligible really are eligible once added
              for (const a of b.addOns.filter((x) => x.eligible)) {
                const withAddOn = b.lines.filter((l) => l.productId !== a.replaces).concat({ productId: a.productId, qty: a.qty });
                expect(checkBundle(catalogue, withAddOn, profile).valid, `${label} + ${a.productId}`).toBe(true);
              }
              checked++;
            }
    expect(checked).toBe(1800);
  });
});

describe("errors", () => {
  it("there is no lite variant outside micro", () => {
    expect(() => buildBundle(catalogue, "prof", { cityTier: 1, employees: 5, sites: 1, gstin: "none" }, "lite")).toThrow(
      /No "lite" bundle for segment "prof"/,
    );
  });
});
