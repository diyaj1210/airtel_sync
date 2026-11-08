import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../../src/catalogue/bundles.js";
import { checkBundle } from "../../src/catalogue/rules.js";
import { GSTIN_STATUSES, type BusinessProfile } from "../../src/catalogue/types.js";
import { buildQuote, QuoteRequestError, QuoteSelectionError, type Quote, type QuoteRequest } from "../../src/quote/quote.js";
import { catalogue } from "../testApp.js";

const micro: BusinessProfile = { cityTier: 2, employees: 3, sites: 1, gstin: "none" };
const office: BusinessProfile = { cityTier: 2, employees: 5, sites: 1, gstin: "none" };

function quote(partial: Partial<QuoteRequest> & Pick<QuoteRequest, "segment" | "profile">): Quote {
  return buildQuote(catalogue, { variant: "standard", exclude: [], include: [], ...partial });
}
const item = (q: Quote, id: string) => q.items.find((i) => i.productId === id)!;
const codes = (q: Quote, id: string) => item(q, id).blockedBy.map((b) => b.code);

function selectionError(fn: () => unknown): QuoteSelectionError {
  try {
    fn();
  } catch (err) {
    if (err instanceof QuoteSelectionError) return err;
    throw err;
  }
  throw new Error("expected a QuoteSelectionError");
}

describe("default quote", () => {
  it("is the segment bundle: one monthly price, setup and contract shown separately", () => {
    const q = quote({ segment: "prof", profile: office });
    expect(q.totals).toEqual({ monthlyInr: 4215, monthlyMaxInr: expect.any(Number), setupInr: 1500, contractMonths: 12, installDays: 5 });
    expect(q.items.filter((i) => i.kind === "core").every((i) => i.selected)).toBe(true);
    expect(q.items.filter((i) => i.kind === "addon").every((i) => !i.selected)).toBe(true);
  });

  it("gives every item a plain name and description, not just a code", () => {
    const q = quote({ segment: "micro", profile: micro });
    expect(item(q, "P04")).toMatchObject({
      name: "Biz 5G AirFiber 100",
      description: expect.stringContaining("5G"),
      unit: "per site",
      qty: 1,
      unitPriceInr: 899,
      monthlyInr: 899,
    });
  });

  it("offers the 6-month Lite plan only for micro businesses", () => {
    expect(quote({ segment: "micro", profile: micro }).variants).toEqual(["standard", "lite"]);
    expect(quote({ segment: "prof", profile: office }).variants).toEqual(["standard"]);
    expect(quote({ segment: "micro", variant: "lite", profile: micro }).totals.monthlyInr).toBe(1198);
  });
});

describe("toggling add-ons", () => {
  it("switching on Cloud POS adds its monthly price and setup fee", () => {
    const q = quote({ segment: "micro", profile: micro, include: ["P19"] });
    expect(item(q, "P19").selected).toBe(true);
    expect(q.totals).toMatchObject({ monthlyInr: 1597 + 599, setupInr: 1000 + 2500 });
  });

  it("an ineligible add-on cannot be switched on and says why (WhatsApp API needs a GSTIN)", () => {
    const q = quote({ segment: "micro", profile: micro });
    expect(item(q, "P15").canToggle).toBe(false);
    expect(codes(q, "P15")).toEqual(["GSTIN_REQUIRED"]);
    const err = selectionError(() => quote({ segment: "micro", profile: micro, include: ["P15"] }));
    expect(err.problems).toEqual([{ productId: "P15", action: "add", reasons: [expect.objectContaining({ code: "GSTIN_REQUIRED" })] }]);
  });

  it("the same add-on becomes available with an active GSTIN", () => {
    const q = quote({ segment: "micro", profile: { ...micro, gstin: "active" }, include: ["P15"] });
    expect(item(q, "P15").selected).toBe(true);
    expect(q.totals.monthlyInr).toBe(1597 + 999);
  });

  it("cloud telephony is blocked below 3 employees", () => {
    const q = quote({ segment: "prof", profile: { ...office, employees: 2, gstin: "active" } });
    expect(codes(q, "P12")).toEqual(["MIN_EMPLOYEES"]);
  });

  it("the leased-line upgrade replaces the 20 Mbps line and re-prices the bundle", () => {
    const profile: BusinessProfile = { cityTier: 1, employees: 25, sites: 1, gstin: "active" };
    const base = quote({ segment: "mfg", profile });
    const up = quote({ segment: "mfg", profile, include: ["P06"] });
    expect(item(up, "P05")).toMatchObject({ selected: false, canToggle: false });
    expect(codes(up, "P05")).toEqual(["REPLACED_BY"]);
    expect(item(up, "P06").selected).toBe(true);
    expect(up.totals.monthlyInr).toBe(base.totals.monthlyInr - 8000 + 25000);
    expect(up.totals.setupInr).toBe(base.totals.setupInr - 10000 + 15000);
    expect(up.totals.installDays).toBe(30);
    // the firewall still has its required line (P06 satisfies P21's requires_one_of)
    expect(checkBundle(catalogue, up.items.filter((i) => i.selected), profile).valid).toBe(true);
  });
});

describe("removing products", () => {
  it("removing a product another line needs is blocked with the reason (failover needs fibre)", () => {
    const q = quote({ segment: "prof", profile: office });
    expect(item(q, "P02").canToggle).toBe(false);
    expect(item(q, "P02").blockedBy).toEqual([
      expect.objectContaining({ code: "REQUIRED_BY", params: { products: ["P09"] } }),
    ]);
    expect(item(q, "P02").blockedBy[0]!.message).toBe("Can't remove Biz Fibre 300: Backup 4G/5G Failover needs it.");
    const err = selectionError(() => quote({ segment: "prof", profile: office, exclude: ["P02"] }));
    expect(err.problems[0]).toMatchObject({ productId: "P02", action: "remove" });
  });

  it("after removing the dependent, the product can be removed too", () => {
    const q1 = quote({ segment: "prof", profile: office, exclude: ["P09"] });
    expect(item(q1, "P09")).toMatchObject({ selected: false, canToggle: true });
    expect(item(q1, "P02").canToggle).toBe(true);
    const q2 = quote({ segment: "prof", profile: office, exclude: ["P09", "P02"] });
    expect(q2.totals.monthlyInr).toBe(4215 - 499 - 1499);
  });

  it("a removed product that needs another removed product cannot be added back alone", () => {
    const q = quote({ segment: "prof", profile: office, exclude: ["P09", "P02"] });
    expect(codes(q, "P09")).toEqual(["REQUIRES_ONE_OF"]);
    expect(item(q, "P02").canToggle).toBe(true);
  });

  it("AirFiber is needed by Wi-Fi and by a CCTV add-on: both are named", () => {
    const q = quote({ segment: "micro", profile: micro, include: ["P23"] });
    expect(item(q, "P04").blockedBy[0]).toMatchObject({ code: "REQUIRED_BY", params: { products: ["P22", "P23"] } });
  });

  it("the last product cannot be removed", () => {
    const q = quote({ segment: "micro", variant: "lite", profile: micro, exclude: ["P07"] });
    expect(codes(q, "P04")).toEqual(["LAST_ITEM"]);
  });

  it("removing both a product and its dependent in one request is allowed", () => {
    expect(() => quote({ segment: "micro", profile: micro, exclude: ["P22", "P04"] })).not.toThrow();
  });
});

describe("unavailable products", () => {
  it("lists what the rules engine left out, with reasons", () => {
    const q = quote({ segment: "mfg", profile: { cityTier: 2, employees: 8, sites: 1, gstin: "active" } });
    expect(q.unavailable.map((u) => [u.productId, u.name, u.violations[0]!.code])).toEqual([
      ["P05", "Internet Leased Line 20", "MIN_EMPLOYEES"],
      ["P21", "Managed Firewall", "MIN_EMPLOYEES"],
      ["P24", "Machine Monitoring IoT", "MIN_EMPLOYEES"],
    ]);
  });
});

describe("request validation", () => {
  const run = (partial: Partial<QuoteRequest>) => () => quote({ segment: "micro", profile: micro, ...partial });
  it("rejects products that are not part of this bundle", () => {
    expect(run({ exclude: ["P10"] })).toThrow(QuoteRequestError);
    expect(run({ include: ["P04"] })).toThrow(/not an add-on/);
    expect(run({ include: ["P19", "P19"] })).toThrow(/twice/);
  });
});

describe("invariant: canToggle always tells the truth", () => {
  it("every allowed toggle succeeds with an all-eligible bundle; every blocked toggle is rejected", () => {
    let toggles = 0;
    for (const t of TEMPLATES)
      for (const cityTier of [1, 2] as const)
        for (const employees of [1, 3, 9, 10, 25])
          for (const sites of [1, 3])
            for (const gstin of GSTIN_STATUSES) {
              const profile = { cityTier, employees, sites, gstin };
              const req: QuoteRequest = { segment: t.segment, variant: t.variant, profile, exclude: [], include: [] };
              // start from the default quote and from one with every allowed add-on switched on
              const start = buildQuote(catalogue, req);
              const allAddOns = start.items.filter((i) => i.kind === "addon" && i.canToggle && !i.replaces).map((i) => i.productId);
              for (const base of [req, { ...req, include: allAddOns }]) {
                const q = buildQuote(catalogue, base);
                for (const it of q.items.filter((i) => i.blockedBy[0]?.code !== "REPLACED_BY")) {
                  const next: QuoteRequest =
                    it.kind === "core"
                      ? { ...base, exclude: it.selected ? [...base.exclude, it.productId] : base.exclude.filter((x) => x !== it.productId) }
                      : { ...base, include: it.selected ? base.include.filter((x) => x !== it.productId) : [...base.include, it.productId] };
                  const label = `${t.id} ${JSON.stringify(profile)} toggle ${it.productId}`;
                  if (it.canToggle) {
                    const after = buildQuote(catalogue, next);
                    const lines = after.items.filter((i) => i.selected).map((i) => ({ productId: i.productId, qty: i.qty }));
                    expect(checkBundle(catalogue, lines, profile).valid, label).toBe(true);
                  } else {
                    expect(() => buildQuote(catalogue, next), label).toThrow(QuoteSelectionError);
                  }
                  toggles++;
                }
              }
            }
    expect(toggles).toBeGreaterThan(2000);
  });
});
