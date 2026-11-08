import { describe, expect, it } from "vitest";
import { addDays, TODAY } from "../../src/clock.js";
import type { GstinStatus, Segment } from "../../src/catalogue/types.js";
import { OrderStore } from "../../src/orders/store.js";
import { currentStageIndex, nextStage, planOrder, STAGES } from "../../src/orders/tracker.js";
import { buildQuote, type QuoteRequest } from "../../src/quote/quote.js";
import { catalogue } from "../testApp.js";

const quote = (segment: Segment, profile: QuoteRequest["profile"], include: string[] = [], variant: "standard" | "lite" = "standard") =>
  buildQuote(catalogue, { segment, variant, profile, exclude: [], include });

describe("tracker dates (today = 2026-07-15, typical_install_days from the catalogue)", () => {
  it("each line is ready on order date + its install days; the bundle when its slowest line is", () => {
    // Office Pro for a 5-person clinic: fibre 5 days, failover 3, SIMs / email / backup / security 1.
    const q = quote("prof", { cityTier: 1, employees: 5, sites: 1, gstin: "none" });
    const plan = planOrder(q, TODAY, TODAY);
    const byId = Object.fromEntries(plan.lines.map((l) => [l.productId, l.expectedOn]));
    expect(byId).toMatchObject({ P02: "2026-07-20", P07: "2026-07-16", P09: "2026-07-18", P16: "2026-07-16" });
    expect(plan.readyOn).toBe("2026-07-20");
    expect(plan.stages).toEqual([
      { stage: "kyc_verified", expectedOn: "2026-07-15", doneOn: "2026-07-15" },
      { stage: "order_placed", expectedOn: "2026-07-15", doneOn: "2026-07-15" },
      { stage: "installation_scheduled", expectedOn: "2026-07-16", doneOn: null },
      { stage: "installed", expectedOn: "2026-07-20", doneOn: null },
      { stage: "activated", expectedOn: "2026-07-20", doneOn: null },
    ]);
  });

  it.each([
    ["micro", { cityTier: 1, employees: 3, sites: 1, gstin: "none" }, [], "standard", "2026-07-18"], // secure Wi-Fi 3 days
    ["micro", { cityTier: 2, employees: 3, sites: 1, gstin: "none" }, [], "lite", "2026-07-17"], // AirFiber 2 days
    ["multi", { cityTier: 1, employees: 15, sites: 3, gstin: "active" }, [], "standard", "2026-07-29"], // SD-WAN 14 days
    ["mfg", { cityTier: 2, employees: 12, sites: 1, gstin: "active" }, [], "standard", "2026-08-05"], // leased line 21 days, into August
    ["mfg", { cityTier: 2, employees: 30, sites: 1, gstin: "active" }, ["P06"], "standard", "2026-08-14"], // leased line 100: 30 days
  ] as const)("%s (%j, add %j, %s) is ready on %s", (segment, profile, include, variant, readyOn) => {
    const q = quote(segment, { ...profile, gstin: profile.gstin as GstinStatus }, [...include], variant);
    const plan = planOrder(q, TODAY, TODAY);
    expect(plan.readyOn).toBe(readyOn);
    expect(plan.readyOn).toBe(addDays(TODAY, q.totals.installDays)); // same number the quote showed as "Ready in"
  });

  it("never: a line after the bundle's ready date, a stage before the one before it (many profiles)", () => {
    let checked = 0;
    for (const segment of ["micro", "prof", "multi", "mfg"] as const)
      for (const cityTier of [1, 2] as const)
        for (const employees of [1, 5, 10, 25, 60])
          for (const sites of [1, 3, 8])
            for (const gstin of ["active", "none"] as const) {
              const q = quote(segment, { cityTier, employees, sites, gstin });
              if (!q.items.some((i) => i.selected)) continue;
              const plan = planOrder(q, TODAY, TODAY);
              for (const l of plan.lines) {
                expect(l.expectedOn).toBe(addDays(TODAY, l.installDays));
                expect(l.expectedOn <= plan.readyOn).toBe(true);
              }
              expect(plan.lines.some((l) => l.expectedOn === plan.readyOn)).toBe(true);
              const dates = plan.stages.map((s) => s.expectedOn);
              expect([...dates].sort()).toEqual(dates);
              expect(plan.stages.map((s) => s.stage)).toEqual([...STAGES]);
              checked++;
            }
    expect(checked).toBeGreaterThan(200);
  });

  it("a one-day bundle is scheduled and ready the next day", () => {
    const q = quote("prof", { cityTier: 1, employees: 5, sites: 1, gstin: "none" });
    const oneDay = { ...q, items: q.items.map((i) => ({ ...i, selected: i.installDays === 1 && i.selected })) };
    const plan = planOrder(oneDay, TODAY, TODAY);
    expect(plan.readyOn).toBe("2026-07-16");
    expect(plan.stages.find((s) => s.stage === "installation_scheduled")!.expectedOn).toBe("2026-07-16");
    expect(() => planOrder({ ...q, items: q.items.map((i) => ({ ...i, selected: false })) }, TODAY, TODAY)).toThrow();
  });

  it("dates come from the order date passed in, never the clock", () => {
    const q = quote("prof", { cityTier: 1, employees: 5, sites: 1, gstin: "none" });
    expect(planOrder(q, "2026-12-29", "2026-12-28").readyOn).toBe("2027-01-03");
  });
});

describe("order store", () => {
  const q = quote("prof", { cityTier: 1, employees: 5, sites: 1, gstin: "none" });

  it("places one order per KYC case, with payment = setup + first month and two notifications", () => {
    let n = 0;
    const store = new OrderStore(() => `ORD-0000000${++n}`, () => "PAY-00000001");
    const order = store.place({ caseId: "KYC-1", quoteId: "Q-1", quote: q, method: "upi", placedOn: TODAY, kycVerifiedOn: TODAY });
    expect(order.payment).toEqual({
      reference: "PAY-00000001",
      method: "upi",
      paidOn: TODAY,
      setupInr: q.totals.setupInr,
      firstMonthInr: q.totals.monthlyInr,
      totalInr: q.totals.setupInr + q.totals.monthlyInr,
    });
    expect(order.notifications.map((x) => x.stage)).toEqual(["kyc_verified", "order_placed"]);
    expect(store.forCase("KYC-1")).toBe(order);
    expect(() => store.place({ caseId: "KYC-1", quoteId: "Q-1", quote: q, method: "card", placedOn: TODAY, kycVerifiedOn: TODAY })).toThrow();
  });

  it("MOCK advance: each stage happens on its expected date, with a notification, until activated", () => {
    const store = new OrderStore();
    const order = store.place({ caseId: "KYC-2", quoteId: "Q-2", quote: q, method: "card", placedOn: TODAY, kycVerifiedOn: TODAY });
    expect(nextStage(order.stages)!.stage).toBe("installation_scheduled");
    const seen: string[] = [];
    while (store.advance(order)) seen.push(`${order.stages[currentStageIndex(order.stages)]!.stage}@${order.notifications.at(-1)!.on}`);
    expect(seen).toEqual(["installation_scheduled@2026-07-16", "installed@2026-07-20", "activated@2026-07-20"]);
    expect(nextStage(order.stages)).toBeNull();
    expect(store.advance(order)).toBeNull();
    expect(order.notifications.map((x) => x.id)).toEqual([1, 2, 3, 4, 5]);
    expect(order.notifications.every((x) => x.params.readyOn === "2026-07-20")).toBe(true);
  });

  it("keeps at most the configured number of orders", () => {
    let n = 0;
    const store = new OrderStore(() => `ORD-${String(++n).padStart(8, "0")}`, undefined, 2);
    for (const c of ["A", "B", "C"]) store.place({ caseId: c, quoteId: "Q", quote: q, method: "upi", placedOn: TODAY, kycVerifiedOn: TODAY });
    expect(store.forCase("A")).toBeUndefined();
    expect(store.get("ORD-00000003")).toBeDefined();
    expect(store.get("nope")).toBeUndefined();
  });
});
