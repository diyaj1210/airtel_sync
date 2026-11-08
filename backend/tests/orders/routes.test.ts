import request from "supertest";
import { describe, expect, it } from "vitest";
import { CONSENT_VERSION } from "../../src/kyc/store.js";
import { recordedReader, sampleImage, samples } from "../kyc/helpers.js";
import { makeTestApp } from "../testApp.js";

type Api = ReturnType<typeof request>;

function setup() {
  const t = makeTestApp(undefined, { documentReader: recordedReader() });
  return { ...t, api: request(t.app) };
}

const MICRO = { segment: "micro", variant: "standard", profile: { cityTier: 1, employees: 4, sites: 1, gstin: "active" }, exclude: [], include: [] as string[] };

async function acceptQuote(api: Api, body: Record<string, unknown> = MICRO) {
  const res = await api.post("/api/quotes").send(body);
  expect(res.status).toBe(201);
  return res.body as { quoteId: string; quote: { totals: { monthlyInr: number; setupInr: number; installDays: number } } };
}

/** Consent -> sample applicant -> documents -> submit -> (if passed) MOCK e-sign. */
async function kycFor(api: Api, sampleId: string, quoteId: string | null, sign = true) {
  const c = await api.post("/api/kyc/cases").send({ consent: { accepted: true, version: CONSENT_VERSION }, lang: "en", ...(quoteId ? { quoteId } : {}) });
  const caseId = c.body.caseId as string;
  await api.put(`/api/kyc/cases/${caseId}/business`).send({ sampleId });
  for (const d of samples.get(sampleId)!.documents) {
    await api.put(`/api/kyc/cases/${caseId}/documents/${d}`).set("content-type", "image/png").send(sampleImage(sampleId, d));
  }
  const submitted = await api.post(`/api/kyc/cases/${caseId}/submit`);
  if (sign && submitted.body.result.status === "pass") {
    const start = await api.post(`/api/kyc/cases/${caseId}/esign/start`);
    const signed = await api.post(`/api/kyc/cases/${caseId}/esign/verify`).send({ otp: start.body.otp });
    expect(signed.status).toBe(200);
  }
  return caseId;
}

describe("checkout and MOCK payment", () => {
  it("shows what is due now (setup + first month) and places the order", async () => {
    const { api } = setup();
    const q = await acceptQuote(api, { ...MICRO, include: ["P15"] }); // WhatsApp API: needs the Active GSTIN K03 has
    const caseId = await kycFor(api, "K03", q.quoteId);
    const co = await api.get(`/api/orders/checkout/${caseId}`);
    expect(co.body).toMatchObject({
      quoteId: q.quoteId,
      monthlyInr: q.quote.totals.monthlyInr,
      setupInr: q.quote.totals.setupInr,
      dueNowInr: q.quote.totals.monthlyInr + q.quote.totals.setupInr,
      canPay: true,
      block: null,
      orderId: null,
    });
    const paid = await api.post("/api/orders").send({ caseId, method: "upi" });
    expect(paid.status).toBe(201);
    expect(paid.body).toMatchObject({
      orderId: expect.stringMatching(/^ORD-[0-9A-F]{8}$/),
      placedOn: "2026-07-15",
      payment: { mock: true, method: "upi", reference: expect.stringMatching(/^PAY-[0-9A-F]{8}$/), totalInr: co.body.dueNowInr },
      currentStage: "order_placed",
      nextStage: { stage: "installation_scheduled", expectedOn: "2026-07-16" },
      readyOn: "2026-07-18",
      activated: false,
    });
    expect(paid.body.lines.map((l: { productId: string }) => l.productId)).toContain("P15");
    expect(paid.body.notifications.map((n: { stage: string }) => n.stage)).toEqual(["order_placed", "kyc_verified"]); // newest first
    // The KYC case now points to its order; paying again is refused with the same order.
    expect((await api.get(`/api/kyc/cases/${caseId}`)).body.orderId).toBe(paid.body.orderId);
    expect((await api.post("/api/orders").send({ caseId, method: "card" })).body).toEqual({ error: "already_paid", orderId: paid.body.orderId });
    expect((await api.get(`/api/orders/checkout/${caseId}`)).body).toMatchObject({ canPay: false, block: "already_paid", orderId: paid.body.orderId });
  });

  it("MOCK failure: 402, no order, and paying again works", async () => {
    const { api, orderStore } = setup();
    const q = await acceptQuote(api);
    const caseId = await kycFor(api, "K03", q.quoteId);
    const failed = await api.post("/api/orders").send({ caseId, method: "card", simulateFailure: true });
    expect(failed.status).toBe(402);
    expect(failed.body).toEqual({ error: "payment_failed", mock: true });
    expect(orderStore.forCase(caseId)).toBeUndefined();
    expect((await api.post("/api/orders").send({ caseId, method: "netbanking" })).status).toBe(201);
  });

  it("refuses before KYC is signed, without a quote, and when the quote needs a GSTIN the business does not have", async () => {
    const { api } = setup();
    const q = await acceptQuote(api);
    const unsigned = await kycFor(api, "K03", q.quoteId, false);
    expect((await api.post("/api/orders").send({ caseId: unsigned, method: "upi" })).body).toEqual({ error: "kyc_not_signed" });
    const noQuote = await kycFor(api, "K03", null);
    expect((await api.post("/api/orders").send({ caseId: noQuote, method: "upi" })).body).toEqual({ error: "no_quote" });

    // A business with no GSTIN (its Udyam number ties the bill to it) passes KYC, but a quote made as if it had a GSTIN cannot be paid.
    const caseId = (await api.post("/api/kyc/cases").send({ consent: { accepted: true, version: CONSENT_VERSION }, lang: "en", quoteId: (await acceptQuote(api, { ...MICRO, include: ["P15"] })).quoteId })).body.caseId;
    await api.put(`/api/kyc/cases/${caseId}/business`).send({ applicantName: "Joseph Singh", gstin: null, hasUdyam: true, udyamNumber: "UDYAM-MH-00-9516696" });
    for (const d of ["signatory_id", "address_proof"] as const) await api.put(`/api/kyc/cases/${caseId}/documents/${d}`).set("content-type", "image/png").send(sampleImage("K03", d));
    expect((await api.post(`/api/kyc/cases/${caseId}/submit`)).body.result.status).toBe("pass");
    const start = await api.post(`/api/kyc/cases/${caseId}/esign/start`);
    await api.post(`/api/kyc/cases/${caseId}/esign/verify`).send({ otp: start.body.otp });
    const co = await api.get(`/api/orders/checkout/${caseId}`);
    expect(co.body).toMatchObject({ canPay: false, block: "quote_needs_active_gstin", blockedProducts: [{ productId: "P15", name: "WhatsApp Business API Starter" }] });
    expect((await api.post("/api/orders").send({ caseId, method: "upi" })).status).toBe(409);
  });

  it("validates the request", async () => {
    const { api } = setup();
    expect((await api.post("/api/orders").send({ caseId: "KYC-00000000", method: "cash" })).status).toBe(400);
    expect((await api.post("/api/orders").send({ caseId: "KYC-00000000", method: "upi", simulateFailure: "yes" })).status).toBe(400);
    expect((await api.post("/api/orders").send({ caseId: "KYC-00000000", method: "upi" })).status).toBe(404);
    expect((await api.get("/api/orders/checkout/KYC-00000000")).status).toBe(404);
  });
});

describe("tracker", () => {
  it("status without calling: stages, dates and updates; MOCK advance to activated", async () => {
    const { api, logLines } = setup();
    const q = await acceptQuote(api, { segment: "prof", variant: "standard", profile: { cityTier: 1, employees: 5, sites: 1, gstin: "active" }, exclude: [], include: [] });
    const caseId = await kycFor(api, "K03", q.quoteId);
    const { orderId } = (await api.post("/api/orders").send({ caseId, method: "card" })).body;

    const view = (await api.get(`/api/orders/${orderId}`)).body;
    expect(view.readyOn).toBe("2026-07-20"); // fibre: 5 days
    expect(view.stages.map((s: { stage: string; expectedOn: string; doneOn: string | null }) => [s.stage, s.expectedOn, s.doneOn])).toEqual([
      ["kyc_verified", "2026-07-15", "2026-07-15"],
      ["order_placed", "2026-07-15", "2026-07-15"],
      ["installation_scheduled", "2026-07-16", null],
      ["installed", "2026-07-20", null],
      ["activated", "2026-07-20", null],
    ]);

    for (const stage of ["installation_scheduled", "installed", "activated"]) {
      const r = await api.post(`/api/orders/${orderId}/advance`);
      expect(r.status).toBe(200);
      expect(r.body.currentStage).toBe(stage);
      expect(r.body.notifications[0].stage).toBe(stage);
    }
    const done = (await api.get(`/api/orders/${orderId}`)).body;
    expect(done).toMatchObject({ activated: true, nextStage: null, currentStage: "activated" });
    expect(done.notifications).toHaveLength(5);
    expect((await api.post(`/api/orders/${orderId}/advance`)).body).toEqual({ error: "already_activated" });

    // The tracker holds no personal data, and the log has no names or identifiers.
    const text = JSON.stringify(done);
    for (const secret of ["Joseph", "Ganesh", "27XUIXG0767D1ZP", caseId]) expect(text).not.toContain(secret);
    expect(logLines.join("\n")).not.toMatch(/Joseph|27XUIXG0767D1ZP/);
  });

  it("404 for unknown or malformed order references", async () => {
    const { api } = setup();
    expect((await api.get("/api/orders/ORD-00000000")).status).toBe(404);
    expect((await api.get("/api/orders/whatever")).status).toBe(404);
    expect((await api.post("/api/orders/ORD-00000000/advance")).status).toBe(404);
  });
});
