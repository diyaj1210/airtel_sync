import request from "supertest";
import { describe, expect, it } from "vitest";
import { leadView } from "../../src/advisor/leads.js";
import { makeTestApp } from "../testApp.js";
import { honestLlm } from "./helpers.js";

async function newChat(app: Parameters<typeof request>[0], lang = "en") {
  const res = await request(app).post("/api/advisor/sessions").send({ lang });
  expect(res.status).toBe(201);
  return res.body.sessionId as string;
}

const say = (app: Parameters<typeof request>[0], id: string, body: object) =>
  request(app).post(`/api/advisor/sessions/${id}/messages`).send(body);

describe("advisor API", () => {
  it("starts a chat with a greeting and the first question", async () => {
    const { app } = makeTestApp();
    const res = await request(app).post("/api/advisor/sessions").send({ lang: "hi" });
    expect(res.status).toBe(201);
    expect(res.body.sessionId).toMatch(/^S-[0-9a-f]{16}$/);
    expect(res.body).toMatchObject({ lang: "hi", expecting: "businessKind", mode: "basic", recommendation: null, action: null });
    expect(res.body.messages[0].text).toContain("नमस्ते");
  });

  it("runs a whole chat over HTTP, text and quick replies, to a recommendation", async () => {
    const { app } = makeTestApp();
    const id = await newChat(app);
    for (const body of [
      { text: "dental clinic in Kochi with 5 people" },
      { choice: { slot: "sites", value: 1 } },
      { choice: { slot: "gstin", value: "none" } },
      { text: "mobile hotspot" },
      { choice: { slot: "tools", value: ["email"] } },
    ]) {
      expect((await say(app, id, { lang: "en", ...body })).status).toBe(200);
    }
    const res = await say(app, id, { lang: "en", text: "how much is it?" });
    expect(res.body.recommendation).toMatchObject({
      name: "Office Pro",
      templateId: "office-pro",
      totals: { monthlyInr: 4215, setupInr: 1500, contractMonths: 12, installDays: 5 },
      quoteRequest: { segment: "prof", variant: "standard", profile: { cityTier: 2, employees: 5, sites: 1, gstin: "none" }, exclude: [], include: [] },
    });
    expect(res.body.messages[0].text).toContain("₹4,215/month");
  });

  it("the recommendation's quote request gives the same total on the quote API", async () => {
    const { app } = makeTestApp();
    const id = await newChat(app);
    for (const text of ["kirana store in Jaipur, 3 people", "1", "no", "hotspot", "none"]) await say(app, id, { lang: "en", text });
    const { body } = await say(app, id, { lang: "en", text: "how much?" });
    const quote = await request(app).post("/api/quote").send(body.recommendation.quoteRequest);
    expect(quote.status).toBe(200);
    expect(quote.body.totals).toEqual(body.recommendation.totals);
    expect(body.recommendation.quoteRequest.include).toEqual(["P19", "P23"]);
  });

  it.each([
    [{ lang: "en" }, "send exactly one of text or choice"],
    [{ lang: "en", text: "a", choice: { slot: "sites", value: 1 } }, "send exactly one of text or choice"],
    [{ lang: "en", text: "" }, "text must be 1 to 500 characters"],
    [{ lang: "en", text: "x".repeat(501) }, "text must be 1 to 500 characters"],
    [{ lang: "fr", text: "bonjour" }, "lang must be en or hi"],
    [{ lang: "en", choice: { slot: "price", value: 1 } }, "choice is not valid"],
    [{ lang: "en", choice: { slot: "action", value: "buy" } }, "choice is not valid"],
  ])("rejects a malformed message %j", async (body, detail) => {
    const { app } = makeTestApp();
    const id = await newChat(app);
    const res = await say(app, id, body);
    expect(res.status).toBe(400);
    expect(res.body.details).toContain(detail);
  });

  it("404 for an unknown or malformed chat id", async () => {
    const { app } = makeTestApp();
    expect((await say(app, "S-0000000000000000", { lang: "en", text: "hi" })).status).toBe(404);
    expect((await say(app, "../../etc", { lang: "en", text: "hi" })).status).toBe(404);
  });

  it("refuses an unknown language for a new chat", async () => {
    const { app } = makeTestApp();
    expect((await request(app).post("/api/advisor/sessions").send({ lang: "xx" })).status).toBe(400);
  });

  it("status says basic mode without an LLM and names the model with one (never a key)", async () => {
    expect((await request(makeTestApp().app).get("/api/advisor/status")).body).toEqual({ mode: "basic", reason: "not configured" });
    const on = await request(makeTestApp(undefined, { advisorLlm: honestLlm() }).app).get("/api/advisor/status");
    expect(on.body).toEqual({ mode: "gemini", provider: "fake", model: "fake-1" });
  });
});

describe("leads the advisor could not close", () => {
  it("saves a call-back request with a masked phone, for the back-office", async () => {
    const { app, logLines, leadStore } = makeTestApp();
    const id = await newChat(app);
    await say(app, id, { lang: "en", text: "I run a bakery in Pune" });
    await say(app, id, { lang: "en", text: "talk to a person please" });
    const res = await request(app)
      .post(`/api/advisor/sessions/${id}/lead`)
      .send({ reason: "asked_for_human", phone: "+91 98765 43210", callbackConsent: true, note: "evenings please" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ leadId: expect.stringMatching(/^AL-[0-9A-F]{8}$/), reason: "asked_for_human", phoneMasked: "******3210" });

    // Listed only in the back-office, behind the staff sign-in (tests/backoffice).
    expect((await request(app).get("/api/advisor/leads")).status).toBe(404);
    const list = { body: { leads: leadStore.list().map(leadView) } };
    expect(list.body.leads).toEqual([
      expect.objectContaining({
        leadId: res.body.leadId,
        reason: "asked_for_human",
        phoneMasked: "******3210",
        callbackConsent: true,
        note: "evenings please",
        business: expect.objectContaining({ type: "Bakery", city: "Pune" }),
        createdOn: "2026-07-15",
      }),
    ]);
    const everything = JSON.stringify(list.body) + logLines.join("\n");
    expect(everything).not.toContain("9876543210");
    expect(everything).not.toContain("98765 43210");
  });

  it("saves a 'not for me' reason without any contact details", async () => {
    const { app, leadStore } = makeTestApp();
    const id = await newChat(app);
    const res = await request(app).post(`/api/advisor/sessions/${id}/lead`).send({ reason: "price_too_high" });
    expect(res.status).toBe(201);
    expect(leadView(leadStore.list()[0]!)).toMatchObject({ reason: "price_too_high", phoneMasked: null });
  });

  it("updates the chat's lead instead of creating a second one", async () => {
    const { app, leadStore } = makeTestApp();
    const id = await newChat(app);
    const first = await request(app).post(`/api/advisor/sessions/${id}/lead`).send({ reason: "decided_to_wait" });
    const second = await request(app).post(`/api/advisor/sessions/${id}/lead`).send({ reason: "other", note: "need a landline" });
    expect(second.status).toBe(200);
    expect(second.body.leadId).toBe(first.body.leadId);
    expect(leadStore.list()).toHaveLength(1);
  });

  it.each([
    [{ reason: "bored" }, "reason must be one of"],
    [{ reason: "asked_for_human" }, "a phone number is needed for a call back"],
    [{ reason: "asked_for_human", phone: "12345", callbackConsent: true }, "phone must be a 10-digit Indian mobile number"],
    [{ reason: "asked_for_human", phone: "9876543210" }, "callbackConsent must be true to leave a phone number"],
    [{ reason: "other", note: "x".repeat(301) }, "note must be text of at most 300 characters"],
    [{ reason: "other", callbackConsent: "yes" }, "callbackConsent must be true or false"],
  ])("rejects %j", async (body, detail) => {
    const { app } = makeTestApp();
    const id = await newChat(app);
    const res = await request(app).post(`/api/advisor/sessions/${id}/lead`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.details.join(" | ")).toContain(detail);
  });
});
