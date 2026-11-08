import request from "supertest";
import { describe, expect, it } from "vitest";
import { addDays, TODAY } from "../../src/clock.js";
import type { GstinStatus, Segment } from "../../src/catalogue/types.js";
import { OrderStore } from "../../src/orders/store.js";
import { planOrder } from "../../src/orders/tracker.js";
import { buildQuote, type QuoteRequest } from "../../src/quote/quote.js";
import { computeTimeline, TIMELINE_RULES, verificationStart } from "../../src/timeline/timeline.js";
import { CONSENT } from "../consent.js";
import { recordedReader, sampleImage, samples } from "../kyc/helpers.js";
import { catalogue, makeTestApp } from "../testApp.js";

/** Time to value (add-on A3): one timeline for the quote, the readiness check and the tracker. */

const quote = (segment: Segment, profile: QuoteRequest["profile"], include: string[] = [], exclude: string[] = []) =>
  buildQuote(catalogue, { segment, variant: "standard", profile, exclude, include });
const ids = (list: readonly string[]) => [...list].sort();

describe("computeTimeline: the expected values", () => {
  it("Office Pro (P02, P07x2, P16x5, P17, P20x5, P09): ready in 5 days, contract 12, Day 1 = P07 P16 P17 P20", () => {
    const q = quote("prof", { cityTier: 1, employees: 5, sites: 1, gstin: "none" });
    expect(q.items.filter((i) => i.selected).map((i) => `${i.productId}x${i.qty}`)).toEqual(["P02x1", "P07x2", "P16x5", "P17x1", "P20x5", "P09x1"]);
    expect(q.timeline).toMatchObject({ approximate: true, start: TODAY, readyDays: 5, readyOn: "2026-07-20", window: null });
    expect(q.contract.months).toBe(12);
    expect(ids(q.timeline.dayOne)).toEqual(["P07", "P16", "P17", "P20"]);
    // The failover router needs the fibre link: never before it.
    expect(q.timeline.lines.find((l) => l.productId === "P09")).toMatchObject({ ownDays: 3, days: 5, waitsFor: "P02", readyOn: "2026-07-20" });
    expect(q.timeline.groups.map((g) => [g.days, ids(g.productIds)])).toEqual([
      [1, ["P07", "P16", "P17", "P20"]],
      [5, ["P02", "P09"]],
    ]);
  });

  it("Micro starter (P04, P07, P22): ready in 3 days; contract 12 because of Secure Wi-Fi, 6 without it", () => {
    const q = quote("micro", { cityTier: 1, employees: 3, sites: 1, gstin: "none" });
    expect(ids(q.items.filter((i) => i.selected).map((i) => i.productId))).toEqual(["P04", "P07", "P22"]);
    expect(q.timeline.readyDays).toBe(3);
    expect(q.contract).toEqual({ months: 12, drivers: [{ productId: "P22", name: "Secure Wi-Fi with Guest Network", months: 12 }], shorter: { remove: "P22", name: "Secure Wi-Fi with Guest Network", months: 6 } });
    // Taking the offer really gives a 6-month contract, and the price and dates update with it.
    const without = quote("micro", { cityTier: 1, employees: 3, sites: 1, gstin: "none" }, [], ["P22"]);
    expect(without.contract.months).toBe(6);
    expect(without.totals.monthlyInr).toBeLessThan(q.totals.monthlyInr);
    expect(without.timeline.readyDays).toBe(2);
  });

  it("Chain Connect (P02, P09, P23, P22, P10, P13, P08): ready in 14 days (SD-WAN), contract 24, service window and site survey", () => {
    const q = quote("multi", { cityTier: 1, employees: 15, sites: 3, gstin: "active" });
    expect(ids(q.items.filter((i) => i.selected).map((i) => i.productId))).toEqual(["P02", "P08", "P09", "P10", "P13", "P22", "P23"]);
    expect(q.timeline).toMatchObject({ readyDays: 14, readyOn: "2026-07-29" });
    expect(q.timeline.slowest.productId).toBe("P10");
    expect(q.contract.months).toBe(24);
    expect(q.timeline.window).toEqual({ from: 14, to: 21, siteSurvey: true, productIds: ["P10"] });
  });

  it("Factory Connect (P05, P21, P24, P16, P08): ready in 21 days (leased line), contract 24", () => {
    const q = quote("mfg", { cityTier: 2, employees: 12, sites: 1, gstin: "active" });
    expect(ids(q.items.filter((i) => i.selected).map((i) => i.productId))).toEqual(["P05", "P08", "P16", "P21", "P24"]);
    expect(q.timeline).toMatchObject({ readyDays: 21, readyOn: "2026-08-05" });
    expect(q.timeline.slowest.productId).toBe("P05");
    expect(q.contract.months).toBe(24);
    // The managed firewall (10 days) needs the leased line: 21.
    expect(q.timeline.lines.find((l) => l.productId === "P21")).toMatchObject({ ownDays: 10, days: 21, waitsFor: "P05" });
    expect(q.timeline.window).toMatchObject({ from: 21, to: 30, siteSurvey: true });
  });

  it("a dependent product is never ready before a base link it needs (every template, many profiles, every add-on)", () => {
    let checked = 0;
    for (const segment of ["micro", "prof", "multi", "mfg"] as const)
      for (const cityTier of [1, 2] as const)
        for (const employees of [1, 5, 12, 30])
          for (const sites of [1, 3, 6])
            for (const gstin of ["active", "none"] as GstinStatus[]) {
              const base = quote(segment, { cityTier, employees, sites, gstin });
              const addOns = base.items.filter((i) => i.kind === "addon" && i.canToggle).map((i) => i.productId);
              const q = quote(segment, { cityTier, employees, sites, gstin }, addOns);
              const byId = new Map(q.timeline.lines.map((l) => [l.productId, l]));
              for (const l of q.timeline.lines) {
                const bases = catalogue.get(l.productId).requiresOneOf.filter((b) => byId.has(b));
                if (bases.length) expect(l.days, `${segment} ${l.productId}`).toBeGreaterThanOrEqual(Math.min(...bases.map((b) => byId.get(b)!.days)));
                expect(l.days).toBeGreaterThanOrEqual(catalogue.get(l.productId).installDays);
                expect(l.readyOn <= q.timeline.readyOn).toBe(true);
              }
              // The bundle date is the same number the quote has always shown.
              expect(q.timeline.readyDays).toBe(q.totals.installDays);
              expect(q.contract.months).toBe(q.totals.contractMonths);
              checked++;
            }
    expect(checked).toBeGreaterThan(150);
  });

  it("reads typical_install_days from the catalogue (not hard-coded), and the rules live in one config", () => {
    const t = computeTimeline([{ productId: "P06", name: "x", qty: 1, unit: "site" }], catalogue, TODAY);
    expect(t.readyDays).toBe(catalogue.get("P06").installDays);
    expect(t.window).toMatchObject({ from: 30, to: 45 });
    expect(TIMELINE_RULES.dayOneMaxDays).toBe(1);
    expect(verificationStart(TODAY, false)).toBe(TODAY);
    expect(verificationStart(TODAY, true)).toBe("2026-07-16");
  });

  it("toggling an add-on updates price, contract and dates at once", () => {
    const profile = { cityTier: 1, employees: 5, sites: 1, gstin: "active" } as const;
    const plain = quote("prof", profile);
    const withPhone = quote("prof", profile, ["P12"]); // cloud telephony: 5 days, 12 months, needs fibre
    expect(withPhone.totals.monthlyInr).toBeGreaterThan(plain.totals.monthlyInr);
    expect(withPhone.timeline.lines.map((l) => l.productId)).toContain("P12");
    expect(withPhone.timeline.lines.find((l) => l.productId === "P12")!.days).toBe(5);
  });
});

describe("the same dates in the quote, the readiness check and the tracker", () => {
  it("quote -> KYC (Ready, starts today) -> order: identical days per product; planned vs actual on the tracker", async () => {
    const t = makeTestApp(undefined, { documentReader: recordedReader() });
    const api = request(t.app);
    const body = { segment: "prof", variant: "standard", profile: { cityTier: 1, employees: 5, sites: 1, gstin: "active" }, exclude: [], include: [] };
    const live = (await api.post("/api/quote").send(body)).body;
    expect(live.timeline.readyOn).toBe("2026-07-20");
    const { quoteId } = (await api.post("/api/quotes").send(body)).body;
    const caseId = (await api.post("/api/kyc/cases").send({ consent: CONSENT, lang: "en", quoteId })).body.caseId;
    await api.put(`/api/kyc/cases/${caseId}/business`).send({ sampleId: "K03" });
    for (const d of samples.get("K03")!.documents) await api.put(`/api/kyc/cases/${caseId}/documents/${d}`).set("content-type", "image/png").send(sampleImage("K03", d));
    const view = (await api.post(`/api/kyc/cases/${caseId}/submit`)).body;
    expect(view.readiness.state).toBe("READY");
    expect(view.readiness.after).toMatchObject({ start: TODAY, days: 5, readyOn: "2026-07-20", window: null });
    expect(view.readiness.after.dayOne).toEqual(["Business Postpaid 299", "Cloud Email & Office Suite", "Cloud Backup 1 TB", "Endpoint Security"]);
    const start = await api.post(`/api/kyc/cases/${caseId}/esign/start`);
    await api.post(`/api/kyc/cases/${caseId}/esign/verify`).send({ otp: start.body.otp });
    const order = (await api.post("/api/orders").send({ caseId, method: "upi" })).body;
    const planned = Object.fromEntries(order.lines.map((l: { productId: string; expectedOn: string }) => [l.productId, l.expectedOn]));
    expect(planned).toEqual(Object.fromEntries(live.timeline.lines.map((l: { productId: string; readyOn: string }) => [l.productId, l.readyOn])));
    expect(order.lines.every((l: { doneOn: string | null }) => l.doneOn === null)).toBe(true);
    // MOCK: the visit is scheduled for tomorrow -> the Day-1 products are in.
    const day1 = (await api.post(`/api/orders/${order.orderId}/advance`)).body;
    expect(day1.lines.filter((l: { doneOn: string | null }) => l.doneOn).map((l: { productId: string }) => l.productId).sort()).toEqual(["P07", "P16", "P17", "P20"]);
    expect(day1.lines.find((l: { productId: string }) => l.productId === "P02").doneOn).toBeNull();
    const done = (await api.post(`/api/orders/${order.orderId}/advance`)).body;
    expect(done.lines.every((l: { expectedOn: string; doneOn: string }) => l.doneOn === l.expectedOn)).toBe(true);
  });

  it("Needs review: the readiness check starts the timeline one day later", async () => {
    const t = makeTestApp(undefined, { documentReader: recordedReader() });
    const api = request(t.app);
    const body = { segment: "prof", variant: "standard", profile: { cityTier: 1, employees: 5, sites: 1, gstin: "active" }, exclude: [], include: [] };
    const { quoteId } = (await api.post("/api/quotes").send(body)).body;
    const caseId = (await api.post("/api/kyc/cases").send({ consent: CONSENT, lang: "en", quoteId })).body.caseId;
    await api.put(`/api/kyc/cases/${caseId}/business`).send({ sampleId: "K07" });
    for (const d of samples.get("K07")!.documents) await api.put(`/api/kyc/cases/${caseId}/documents/${d}`).set("content-type", "image/png").send(sampleImage("K07", d));
    const r = (await api.post(`/api/kyc/cases/${caseId}/submit`)).body.readiness;
    expect(r.state).toBe("NEEDS_REVIEW");
    expect(r.after).toMatchObject({ start: "2026-07-16", days: 5, readyOn: addDays("2026-07-16", 5) });
  });

  it("a stopped order keeps its planned dates and gets no actual ones", () => {
    const store = new OrderStore();
    const q = quote("prof", { cityTier: 1, employees: 5, sites: 1, gstin: "active" });
    const order = store.place({ caseId: "KYC-00000001", quoteId: "Q-1", quote: q, method: "upi", placedOn: TODAY, kycVerifiedOn: TODAY });
    expect(planOrder(q, TODAY, TODAY).lines.map((l) => l.expectedOn)).toEqual(order.lines.map((l) => l.expectedOn));
    store.stop("KYC-00000001", TODAY);
    expect(store.advance(order)).toBeNull();
    expect(order.lines.every((l) => l.doneOn === null)).toBe(true);
  });
});
