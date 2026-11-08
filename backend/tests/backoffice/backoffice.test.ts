import { readFileSync } from "node:fs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { STAFF_SESSION_MS } from "../../src/backoffice/auth.js";
import { CRM_PAGE_SIZE } from "../../src/backoffice/routes.js";
import { parseCsv } from "../../src/catalogue/csv.js";
import { DEFAULT_LEADS_PATH } from "../../src/cities.js";
import { CONSENT_VERSION } from "../../src/kyc/store.js";
import type { PropensityApi } from "../../src/propensity/client.js";
import { recordedReader, sampleImage, samples } from "../kyc/helpers.js";
import { makeTestApp } from "../testApp.js";

type Api = ReturnType<typeof request>;

const DATA = parseCsv(readFileSync(DEFAULT_LEADS_PATH, "utf8"));
const DROPPED = DATA.filter((r) => r.outcome === "Dropped");
const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/;
const UDYAM_RE = /UDYAM-[A-Z]{2}-\d{2}-\d{7}/;

/** Stand-in ai-service model: a referred lead scores 90 (high), others 50 (medium); data leads get id % 101. */
function fakeModel(up = true) {
  const sent: Record<string, unknown>[] = [];
  const reasons = [{ feature: "lead_source", value: "Channel partner", effect: "up", weight: 0.4 }];
  const api: PropensityApi = {
    async call(method, path, body) {
      if (!up) return { status: 503, body: { error: "model_unavailable" } };
      if (method === "POST" && path === "/propensity/score") {
        const leads = (body as { leads: { id: string; lead: Record<string, unknown> }[] }).leads;
        sent.push(...leads.map((l) => l.lead));
        return {
          status: 200,
          body: {
            scores: leads.map((l) => {
              const high = l.lead.lead_source === "Channel partner";
              return { id: l.id, probability: high ? 0.2 : 0.07, score: high ? 90 : 50, band: high ? "high" : "medium", reasons: high ? reasons : [] };
            }),
          },
        };
      }
      if (method === "GET" && path === "/propensity/leads") {
        return {
          status: 200,
          body: {
            scores: DATA.map((r) => {
              const score = Number(r.lead_id!.slice(1)) % 101;
              return { id: r.lead_id, probability: score / 1000, score, band: score >= 80 ? "high" : score >= 40 ? "medium" : "low", reasons: [] };
            }),
          },
        };
      }
      return { status: 404, body: { error: "not_found" } };
    },
  };
  return { api, sent };
}

function setup(options: { model?: PropensityApi; nowMs?: () => number } = {}) {
  const t = makeTestApp(undefined, { documentReader: recordedReader(), propensity: options.model ?? fakeModel().api, nowMs: options.nowMs });
  return { ...t, api: request(t.app) };
}

async function signIn(api: Api, staffCode: string): Promise<string> {
  const res = await api.post("/api/backoffice/session").send({ staffCode });
  expect(res.status).toBe(201);
  return res.body.token as string;
}

const as = (token: string) => ({ authorization: `Bearer ${token}` });

/** An owner chats with the advisor, then leaves a lead (optionally referred by a partner / sales code). */
async function advisorLead(api: Api, opts: { ref?: string; reason?: string; text?: string; phone?: string } = {}): Promise<string> {
  const chat = await api.post("/api/advisor/sessions").send({ lang: "en", ...(opts.ref ? { attributionCode: opts.ref } : {}) });
  expect(chat.status).toBe(201);
  const id = chat.body.sessionId as string;
  await api.post(`/api/advisor/sessions/${id}/messages`).send({ lang: "en", text: opts.text ?? "I run a bakery in Pune with 4 people" });
  // The advisor asks for the number of locations next (the segment needs it).
  const sites = await api.post(`/api/advisor/sessions/${id}/messages`).send({ lang: "en", text: "1" });
  expect(sites.status).toBe(200);
  const reason = opts.reason ?? "asked_for_human";
  // A call back needs a phone number (given with consent).
  const phone = opts.phone ?? (reason === "asked_for_human" ? "9123456780" : undefined);
  const lead = await api.post(`/api/advisor/sessions/${id}/lead`).send({ reason, ...(phone ? { phone, callbackConsent: true } : {}) });
  expect(lead.status).toBe(201);
  return lead.body.leadId as string;
}

const MICRO = { segment: "micro", variant: "standard", profile: { cityTier: 1, employees: 4, sites: 1, gstin: "active" }, exclude: [], include: [] as string[] };

/** Consent -> sample applicant -> documents -> submit. */
async function kycCase(api: Api, sampleId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const c = await api.post("/api/kyc/cases").send({ consent: { accepted: true, version: CONSENT_VERSION }, lang: "en", ...extra });
  expect(c.status).toBe(201);
  const caseId = c.body.caseId as string;
  await api.put(`/api/kyc/cases/${caseId}/business`).send({ sampleId });
  for (const d of samples.get(sampleId)!.documents) {
    await api.put(`/api/kyc/cases/${caseId}/documents/${d}`).set("content-type", "image/png").send(sampleImage(sampleId, d));
  }
  await api.post(`/api/kyc/cases/${caseId}/submit`);
  return caseId;
}

async function signAndPay(api: Api, caseId: string) {
  const start = await api.post(`/api/kyc/cases/${caseId}/esign/start`);
  expect(start.status).toBe(200);
  expect((await api.post(`/api/kyc/cases/${caseId}/esign/verify`).send({ otp: start.body.otp })).status).toBe(200);
  const paid = await api.post("/api/orders").send({ caseId, method: "upi" });
  expect(paid.status).toBe(201);
  return paid.body as { orderId: string; bundle: { monthlyInr: number } };
}

describe("MOCK staff sign-in and roles", () => {
  it("lists the MOCK demo accounts and signs in with one", async () => {
    const { api } = setup();
    const accounts = await api.get("/api/backoffice/accounts");
    expect(accounts.body.mock).toBe(true);
    expect(accounts.body.accounts.map((a: { code: string; role: string }) => `${a.code}:${a.role}`)).toEqual([
      "ADM-01:admin",
      "SLS-01:sales",
      "SLS-02:sales",
      "PTR-01:partner",
      "PTR-02:partner",
    ]);
    const token = await signIn(api, "sls-01");
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect((await api.get("/api/backoffice/session").set(as(token))).body.staff).toMatchObject({ code: "SLS-01", role: "sales" });
    expect((await api.post("/api/backoffice/session").send({ staffCode: "XYZ-01" })).status).toBe(401);
    expect((await api.post("/api/backoffice/session").send({})).status).toBe(401);
  });

  it("every back-office list needs a sign-in; roles see only what they may", async () => {
    const { api } = setup();
    for (const path of ["/api/backoffice/leads", "/api/backoffice/crm-leads", "/api/backoffice/kyc", "/api/backoffice/attribution", "/api/backoffice/session"]) {
      expect((await api.get(path)).status).toBe(401);
      expect((await api.get(path).set({ authorization: "Bearer nope" })).status).toBe(401);
    }
    const partner = await signIn(api, "PTR-01");
    const sales = await signIn(api, "SLS-01");
    const admin = await signIn(api, "ADM-01");
    expect((await api.get("/api/backoffice/crm-leads").set(as(partner))).status).toBe(403);
    expect((await api.get("/api/backoffice/kyc").set(as(partner))).status).toBe(403);
    // KYC data is for onboarding / compliance only: the operations desk, not sales.
    expect((await api.get("/api/backoffice/kyc").set(as(sales))).status).toBe(403);
    expect((await api.get("/api/backoffice/kyc").set(as(admin))).status).toBe(200);
    expect((await api.get("/api/backoffice/crm-leads").set(as(sales))).status).toBe(200);
  });

  it("a sign-in lasts 8 hours and ends on sign-out; the token is never logged", async () => {
    let now = 1_000_000;
    const { api, logLines } = setup({ nowMs: () => now });
    const token = await signIn(api, "ADM-01");
    now += STAFF_SESSION_MS - 1;
    expect((await api.get("/api/backoffice/session").set(as(token))).status).toBe(200);
    now += 1;
    expect((await api.get("/api/backoffice/session").set(as(token))).status).toBe(401);
    const again = await signIn(api, "ADM-01");
    expect((await api.delete("/api/backoffice/session").set(as(again))).body).toEqual({ signedOut: true });
    expect((await api.get("/api/backoffice/session").set(as(again))).status).toBe(401);
    expect(logLines.join("\n")).not.toContain(token);
    expect(logLines.join("\n")).not.toContain(again);
  });

  it("referral check: partner and sales codes only", async () => {
    const { api } = setup();
    expect((await api.get("/api/partners/PTR-01")).body).toEqual({ code: "PTR-01", name: "Shree Mobile Point", role: "partner" });
    expect((await api.get("/api/partners/sls-02")).body).toMatchObject({ code: "SLS-02", role: "sales" });
    expect((await api.get("/api/partners/ADM-01")).status).toBe(404);
    expect((await api.get("/api/partners/PTR-99")).status).toBe(404);
  });
});

describe("leads the advisor could not close", () => {
  it("lists them with the reason, masked phone, attribution and propensity score, best first", async () => {
    const model = fakeModel();
    const { api } = setup({ model: model.api });
    const direct = await advisorLead(api, { reason: "price_too_high" });
    const referred = await advisorLead(api, { ref: "PTR-01", phone: "+91 98765 43210" });
    const sales = await signIn(api, "SLS-01");
    const res = await api.get("/api/backoffice/leads").set(as(sales));
    expect(res.status).toBe(200);
    expect(res.body.scoring).toBe("ok");
    expect(res.body.leads.map((l: { leadId: string }) => l.leadId)).toEqual([referred, direct]);
    expect(res.body.leads[0]).toMatchObject({
      reason: "asked_for_human",
      phoneMasked: "******3210",
      callbackConsent: true,
      attribution: { code: "PTR-01", name: "Shree Mobile Point", role: "partner" },
      followUp: { status: "new", assignedTo: "PTR-01" },
      score: { score: 90, band: "high", nextAction: "call_within_24h", reasons: [{ feature: "lead_source", effect: "up" }] },
    });
    expect(res.body.leads[1]).toMatchObject({ reason: "price_too_high", attribution: null, score: { band: "medium", nextAction: "whatsapp_nudge" } });
    expect(JSON.stringify(res.body)).not.toContain("9876543210");
    expect(res.body.assignable.map((s: { code: string }) => s.code)).toEqual(["SLS-01", "SLS-02", "PTR-01", "PTR-02"]);
  });

  it("sends the model only what the advisor knows, in the data's own values (the rest counts as average)", async () => {
    const model = fakeModel();
    const { api } = setup({ model: model.api });
    await advisorLead(api, { ref: "SLS-02" });
    await signIn(api, "ADM-01").then((t) => api.get("/api/backoffice/leads").set(as(t)));
    expect(model.sent).toEqual([
      {
        segment: "Micro retail & services",
        business_type: "Bakery",
        lead_source: "Field sales",
        city_tier: "1",
        preferred_language: "English",
        employee_count: 4,
        num_sites: 1,
      },
    ]);
  });

  it("filters by reason, segment, city, partner, band, status and owner; returns the filter values", async () => {
    const { api } = setup();
    await advisorLead(api, { reason: "price_too_high" });
    await advisorLead(api, { ref: "PTR-01" });
    await advisorLead(api, { ref: "PTR-02", text: "We are a CA firm in Jaipur, 12 people", reason: "decided_to_wait" });
    const t = await signIn(api, "ADM-01");
    const list = async (query: string) => (await api.get(`/api/backoffice/leads?${query}`).set(as(t))).body;
    const all = await list("");
    expect(all.total).toBe(3);
    expect(all.facets).toMatchObject({
      reason: ["asked_for_human", "decided_to_wait", "price_too_high"],
      attribution: ["none", "PTR-01", "PTR-02"],
      city: ["Jaipur", "Pune"],
      segment: ["micro", "prof"],
      band: ["high", "medium"],
      status: ["new"],
    });
    expect((await list("reason=price_too_high")).leads).toHaveLength(1);
    expect((await list("attribution=none")).leads).toHaveLength(1);
    expect((await list("attribution=PTR-02&city=Jaipur&segment=prof")).leads).toHaveLength(1);
    expect((await list("attribution=PTR-02&city=Pune")).leads).toHaveLength(0);
    expect((await list("band=high")).leads).toHaveLength(2);
    expect((await list("assignedTo=none")).leads).toHaveLength(1);
    expect((await list("status=contacted")).leads).toHaveLength(0);
  });

  it("a partner sees only the leads referred with their own code", async () => {
    const { api } = setup();
    const mine = await advisorLead(api, { ref: "PTR-01" });
    await advisorLead(api, { ref: "PTR-02" });
    await advisorLead(api);
    const p1 = await signIn(api, "PTR-01");
    const res = await api.get("/api/backoffice/leads").set(as(p1));
    expect(res.body.leads.map((l: { leadId: string }) => l.leadId)).toEqual([mine]);
    expect(res.body.total).toBe(1);
  });

  it("still lists the leads when the model is down (no scores)", async () => {
    const { api } = setup({ model: fakeModel(false).api });
    await advisorLead(api);
    const res = await api.get("/api/backoffice/leads").set(as(await signIn(api, "SLS-01")));
    expect(res.body.scoring).toBe("unavailable");
    expect(res.body.leads[0]).toMatchObject({ reason: "asked_for_human", score: null });
  });

  it("follow-up: sales assigns and sets the status; a partner may only update the status of their own leads", async () => {
    const { api, logLines } = setup();
    const lead = await advisorLead(api, { ref: "PTR-01", phone: "9876543210" });
    const other = await advisorLead(api, { ref: "PTR-02" });
    const sales = await signIn(api, "SLS-01");
    const assigned = await api.patch(`/api/backoffice/leads/${lead}`).set(as(sales)).send({ assignedTo: "SLS-02", status: "contacted" });
    expect(assigned.status).toBe(200);
    expect(assigned.body).toEqual({ leadId: lead, followUp: { status: "contacted", assignedTo: "SLS-02", updatedOn: "2026-07-15", updatedBy: "SLS-01" } });
    expect((await api.get("/api/backoffice/leads?assignedTo=SLS-02").set(as(sales))).body.leads).toHaveLength(1);

    const partner = await signIn(api, "PTR-01");
    expect((await api.patch(`/api/backoffice/leads/${lead}`).set(as(partner)).send({ status: "converted" })).body.followUp.status).toBe("converted");
    expect((await api.patch(`/api/backoffice/leads/${lead}`).set(as(partner)).send({ assignedTo: "PTR-01" })).status).toBe(403);
    expect((await api.patch(`/api/backoffice/leads/${other}`).set(as(partner)).send({ status: "lost" })).status).toBe(404);

    for (const bad of [{}, { status: "won" }, { assignedTo: "ADM-01" }, { assignedTo: "PTR-77" }, { note: "x" }]) {
      expect((await api.patch(`/api/backoffice/leads/${lead}`).set(as(sales)).send(bad)).status).toBe(400);
    }
    expect((await api.patch("/api/backoffice/leads/AL-00000000").set(as(sales)).send({ status: "lost" })).status).toBe(404);
    expect((await api.patch(`/api/backoffice/leads/${lead}`).set(as(sales)).send({ assignedTo: null })).body.followUp.assignedTo).toBeNull();
    expect(logLines.join("\n")).not.toContain("9876543210");
  });
});

describe("past-quarter leads (smb_leads.csv)", () => {
  it("lists every dropped lead, best score first, 25 a page, without GSTIN or Udyam numbers", async () => {
    const { api } = setup();
    const t = await signIn(api, "SLS-01");
    const page1 = await api.get("/api/backoffice/crm-leads").set(as(t));
    expect(page1.status).toBe(200);
    expect(page1.body).toMatchObject({ scoring: "ok", total: DROPPED.length, page: 1, pageSize: CRM_PAGE_SIZE, pages: Math.ceil(DROPPED.length / CRM_PAGE_SIZE) });
    expect(DROPPED.length).toBe(4632);
    const scores = page1.body.leads.map((l: { score: { score: number } }) => l.score.score);
    expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a));
    expect(scores[0]).toBe(100);
    const first = page1.body.leads[0];
    const row = DATA.find((r) => r.lead_id === first.leadId)!;
    expect(first).toMatchObject({ businessName: row.business_name, dropReason: row.drop_reason, stageReached: row.stage_reached, hasGstin: row.has_gstin === "Y" });
    expect(first).not.toHaveProperty("gstin");
    const last = await api.get(`/api/backoffice/crm-leads?page=${page1.body.pages}`).set(as(t));
    expect(last.body.leads.length).toBe(DROPPED.length - (page1.body.pages - 1) * CRM_PAGE_SIZE);
    for (const body of [page1.body, last.body]) {
      expect(JSON.stringify(body)).not.toMatch(GSTIN_RE);
      expect(JSON.stringify(body)).not.toMatch(UDYAM_RE);
    }
  });

  it("filters by segment, city, source, drop reason, stage and band, matching the data", async () => {
    const { api } = setup();
    const t = await signIn(api, "ADM-01");
    const count = async (query: string) => (await api.get(`/api/backoffice/crm-leads?${query}`).set(as(t))).body.total as number;
    expect(await count("segment=mfg")).toBe(DROPPED.filter((r) => r.segment === "Small manufacturers").length);
    expect(await count("source=Channel%20partner&city=Pune")).toBe(DROPPED.filter((r) => r.lead_source === "Channel partner" && r.city === "Pune").length);
    expect(await count("reason=Price%20too%20high")).toBe(414);
    expect(await count("stage=KYC%20complete")).toBe(DROPPED.filter((r) => r.stage_reached === "KYC complete").length);
    const high = DROPPED.filter((r) => Number(r.lead_id!.slice(1)) % 101 >= 80).length;
    expect(await count("band=high")).toBe(high);
    const facets = (await api.get("/api/backoffice/crm-leads").set(as(t))).body.facets;
    expect(facets.segment).toEqual(["mfg", "micro", "multi", "prof"]);
    expect(facets.source).toHaveLength(6);
    expect(facets.reason).not.toContain("");
    expect((await api.get("/api/backoffice/crm-leads?page=0").set(as(t))).status).toBe(400);
    expect((await api.get("/api/backoffice/crm-leads?band=hot").set(as(t))).status).toBe(400);
    expect((await api.get("/api/backoffice/crm-leads?page=999").set(as(t))).body.leads).toEqual([]);
  });

  it("without the model the list still works, newest first, without scores", async () => {
    const { api } = setup({ model: fakeModel(false).api });
    const res = await api.get("/api/backoffice/crm-leads").set(as(await signIn(api, "SLS-01")));
    expect(res.body.scoring).toBe("unavailable");
    expect(res.body.total).toBe(4632);
    expect(res.body.leads[0].score).toBeNull();
    const dates = res.body.leads.map((l: { createdOn: string }) => l.createdOn);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

describe("KYC exceptions queue", () => {
  it("lists cases needing review or a fix, with the reasons and masked identifiers", async () => {
    const { api } = setup();
    const k07 = await kycCase(api, "K07"); // name differs from the registry: manual review
    const k11 = await kycCase(api, "K11"); // bill 257 days old: the owner must fix it
    await kycCase(api, "K03"); // passes: not an exception
    const t = await signIn(api, "ADM-01");
    const res = await api.get("/api/backoffice/kyc").set(as(t));
    expect(res.body.counts).toEqual({ needs_review: 1, waiting_for_owner: 1, rejected: 0, approved: 0 });
    expect(res.body.items.map((i: { caseId: string; queueStatus: string }) => [i.caseId, i.queueStatus])).toEqual([
      [k07, "needs_review"],
      [k11, "waiting_for_owner"],
    ]);
    expect(res.body.items[0]).toMatchObject({ canDecide: true, case: { result: { status: "manual_review", issues: [expect.objectContaining({ code: "CERT_DETAILS_MISMATCH" })] } } });
    expect(res.body.items[1]).toMatchObject({ canDecide: false, case: { result: { issues: [expect.objectContaining({ code: "ADDRESS_PROOF_TOO_OLD" })] } } });
    expect(JSON.stringify(res.body)).not.toMatch(GSTIN_RE);
    expect(JSON.stringify(res.body)).not.toMatch(UDYAM_RE);
    expect((await api.get("/api/backoffice/kyc?status=waiting_for_owner").set(as(t))).body.items).toHaveLength(1);
  });

  it("approval lets the owner sign and pay; the partner who referred the quote is credited", async () => {
    const { api } = setup();
    const quote = await api.post("/api/quotes").send({ ...MICRO, attributionCode: "PTR-01" });
    expect(quote.body.attributionCode).toBe("PTR-01");
    const caseId = await kycCase(api, "K07", { quoteId: quote.body.quoteId });
    expect((await api.post(`/api/kyc/cases/${caseId}/esign/start`)).status).toBe(409);
    const t = await signIn(api, "ADM-01");
    const approved = await api.post(`/api/backoffice/kyc/${caseId}/review`).set(as(t)).send({ decision: "approved", note: "Called the owner: Shri is the old trade name" });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ queueStatus: "approved", attribution: { code: "PTR-01" }, canDecide: true });
    const owner = (await api.get(`/api/kyc/cases/${caseId}`)).body;
    expect(owner.result).toMatchObject({ status: "pass", review: { decision: "approved", on: "2026-07-15", note: "Called the owner: Shri is the old trade name" } });
    const order = await signAndPay(api, caseId);
    const queue = (await api.get("/api/backoffice/kyc").set(as(t))).body.items[0];
    expect(queue).toMatchObject({ queueStatus: "approved", canDecide: false, orderId: order.orderId });
    expect((await api.post(`/api/backoffice/kyc/${caseId}/review`).set(as(t)).send({ decision: "rejected", note: "x" })).status).toBe(409);

    const partner = await signIn(api, "PTR-01");
    const credit = (await api.get("/api/backoffice/attribution").set(as(partner))).body;
    expect(credit).toEqual({
      partners: [expect.objectContaining({ code: "PTR-01", quotes: 1, kycCases: 1, orders: 1, ordersMonthlyInr: order.bundle.monthlyInr, orderIds: [order.orderId] })],
    });
    expect(credit).not.toHaveProperty("direct");
  });

  it("approval never unlocks products that need an Active GSTIN (K01: cancelled GSTIN)", async () => {
    const { api } = setup();
    const quote = await api.post("/api/quotes").send({ ...MICRO, include: ["P15"] }); // WhatsApp API needs an Active GSTIN
    const caseId = await kycCase(api, "K01", { quoteId: quote.body.quoteId });
    const t = await signIn(api, "ADM-01");
    expect((await api.post(`/api/backoffice/kyc/${caseId}/review`).set(as(t)).send({ decision: "approved" })).status).toBe(200);
    const owner = (await api.get(`/api/kyc/cases/${caseId}`)).body.result;
    expect(owner).toMatchObject({ status: "pass", gstinProductsAllowed: false });
    expect(owner.blockedProducts.map((p: { productId: string }) => p.productId)).toContain("P15");
    const start = await api.post(`/api/kyc/cases/${caseId}/esign/start`);
    await api.post(`/api/kyc/cases/${caseId}/esign/verify`).send({ otp: start.body.otp });
    expect((await api.post("/api/orders").send({ caseId, method: "upi" })).body).toEqual({ error: "quote_needs_active_gstin" });
  });

  it("rejection needs a note, is shown to the owner and blocks e-sign", async () => {
    const { api, logLines } = setup();
    const caseId = await kycCase(api, "K10"); // signatory is not the owner
    const t = await signIn(api, "ADM-01");
    expect((await api.post(`/api/backoffice/kyc/${caseId}/review`).set(as(t)).send({ decision: "rejected" })).body.error).toBe("note_required");
    const note = "No authorisation letter for the signatory; owner to call 9876543210";
    const rejected = await api.post(`/api/backoffice/kyc/${caseId}/review`).set(as(t)).send({ decision: "rejected", note });
    expect(rejected.body.queueStatus).toBe("rejected");
    const owner = (await api.get(`/api/kyc/cases/${caseId}`)).body.result;
    expect(owner).toMatchObject({ status: "rejected", review: { decision: "rejected" } });
    expect(owner.review.note).not.toContain("9876543210");
    expect((await api.post(`/api/kyc/cases/${caseId}/esign/start`)).body).toMatchObject({ error: "kyc_not_passed", status: "rejected" });
    expect(logLines.join("\n")).not.toContain("authorisation letter");
    // The decision can be changed until the owner signs.
    expect((await api.post(`/api/backoffice/kyc/${caseId}/review`).set(as(t)).send({ decision: "approved" })).body.queueStatus).toBe("approved");
  });

  it("a decision lapses when the owner changes the documents; fixes and passes are not for review", async () => {
    const { api } = setup();
    const caseId = await kycCase(api, "K10");
    const t = await signIn(api, "ADM-01");
    await api.post(`/api/backoffice/kyc/${caseId}/review`).set(as(t)).send({ decision: "approved" });
    expect((await api.delete(`/api/kyc/cases/${caseId}/documents/signatory_id`)).status).toBe(200);
    expect((await api.get(`/api/kyc/cases/${caseId}`)).body.result).toMatchObject({ status: "fix_needed", review: null });
    expect((await api.get("/api/backoffice/kyc").set(as(t))).body.items[0]).toMatchObject({ caseId, queueStatus: "waiting_for_owner" });

    const fix = await kycCase(api, "K11");
    const pass = await kycCase(api, "K03");
    for (const id of [fix, pass]) expect((await api.post(`/api/backoffice/kyc/${id}/review`).set(as(t)).send({ decision: "approved" })).body.error).toBe("not_for_review");
    expect((await api.post("/api/backoffice/kyc/KYC-00000000/review").set(as(t)).send({ decision: "approved" })).status).toBe(404);
    expect((await api.post(`/api/backoffice/kyc/${fix}/review`).set(as(t)).send({ decision: "maybe" })).status).toBe(400);
    expect((await api.post(`/api/backoffice/kyc/${fix}/review`).set(as(t)).send({ decision: "approved", note: "x".repeat(301) })).status).toBe(400);
  });
});

describe("partner attribution", () => {
  it("a referral code follows the owner from the chat or the quote to KYC and the order", async () => {
    const { api } = setup();
    await advisorLead(api, { ref: "PTR-02" });
    const q1 = await api.post("/api/quotes").send({ ...MICRO, attributionCode: "ptr-02" });
    expect(q1.body.attributionCode).toBe("PTR-02");
    const c1 = await kycCase(api, "K03", { quoteId: q1.body.quoteId });
    const o1 = await signAndPay(api, c1);
    // KYC started from home with a sales code (no quote yet).
    const c2 = await kycCase(api, "K08", { attributionCode: "SLS-01" });
    // A direct customer: no code anywhere.
    const q3 = await api.post("/api/quotes").send(MICRO);
    expect(q3.body.attributionCode).toBeNull();
    await signAndPay(api, await kycCase(api, "K09", { quoteId: q3.body.quoteId }));

    const t = await signIn(api, "SLS-02");
    const body = (await api.get("/api/backoffice/attribution").set(as(t))).body;
    const by = Object.fromEntries(body.partners.map((p: { code: string }) => [p.code, p]));
    expect(by["PTR-02"]).toMatchObject({ advisorLeads: 1, quotes: 1, kycCases: 1, orders: 1, ordersMonthlyInr: o1.bundle.monthlyInr, orderIds: [o1.orderId] });
    expect(by["SLS-01"]).toMatchObject({ advisorLeads: 0, quotes: 0, kycCases: 1, orders: 0 });
    expect(by["PTR-01"]).toMatchObject({ advisorLeads: 0, quotes: 0, kycCases: 0, orders: 0, ordersMonthlyInr: 0 });
    expect(body.direct).toMatchObject({ quotes: 1, kycCases: 1, orders: 1 });
    expect(c2).toMatch(/^KYC-/);
    // The owner's tracker never shows who was credited.
    expect((await api.get(`/api/orders/${o1.orderId}`)).body).not.toHaveProperty("attributionCode");
  });

  it("refuses codes that are not a partner or sales code", async () => {
    const { api } = setup();
    for (const code of ["ADM-01", "PTR-99", "hello", 42]) {
      expect((await api.post("/api/advisor/sessions").send({ lang: "en", attributionCode: code })).status).toBe(400);
      expect((await api.post("/api/quotes").send({ ...MICRO, attributionCode: code })).status).toBe(400);
      expect((await api.post("/api/kyc/cases").send({ consent: { accepted: true, version: CONSENT_VERSION }, attributionCode: code })).status).toBe(400);
    }
    expect((await api.post("/api/advisor/sessions").send({ lang: "en", attributionCode: null })).status).toBe(201);
  });
});
