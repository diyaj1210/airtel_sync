import request from "supertest";
import { describe, expect, it } from "vitest";
import type { WaMessage } from "../../src/channels/whatsapp.js";
import { recordedReader, sampleImage } from "../kyc/helpers.js";
import { makeTestApp } from "../testApp.js";

type Api = ReturnType<typeof request>;
const PHONE = "9123456780";
const DEVANAGARI = /[ऀ-ॿ]/;

function setup() {
  const t = makeTestApp(undefined, { documentReader: recordedReader() });
  return { ...t, api: request(t.app) };
}

/** A WhatsApp user: sends texts, taps buttons, sends photos; keeps every reply. */
function phone(api: Api, number = PHONE) {
  const seen: WaMessage[] = [];
  const post = async (body: Record<string, unknown>) => {
    const res = await api.post("/api/channels/whatsapp/messages").set("x-wa-from", number).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.mock).toBe(true);
    seen.push(...res.body.replies);
    return res.body.replies as WaMessage[];
  };
  return {
    seen,
    say: (text: string, voice = false) => post({ text, ...(voice ? { voice } : {}) }),
    tap: (buttonId: string) => post({ buttonId }),
    async photo(sampleId: string, doc: string) {
      const res = await api.post("/api/channels/whatsapp/photo").set("x-wa-from", number).set("content-type", "image/png").send(sampleImage(sampleId, doc as never));
      expect(res.status).toBe(200);
      seen.push(...res.body.replies);
      return res.body.replies as WaMessage[];
    },
  };
}

const last = (m: WaMessage[]) => m[m.length - 1]!;
const ids = (m: WaMessage) => [...(m.buttons ?? []), ...(m.list?.rows ?? [])].map((b) => b.id);
const allText = (m: WaMessage[]) => m.map((x) => x.text).join("\n");

/** Answer the advisor with the first quick reply until it recommends a bundle. */
async function toRecommendation(p: ReturnType<typeof phone>, first: string) {
  let replies = await p.say(first);
  for (let i = 0; i < 12 && !ids(last(replies)).includes("buy"); i++) {
    const qr = ids(last(replies)).find((id) => id.startsWith("qr:"));
    expect(qr, allText(replies)).toBeDefined();
    replies = await p.tap(qr!);
  }
  expect(ids(last(replies))).toEqual(["buy", "human", "notforme"]);
  return replies;
}

/** Send the sample's photo each time the bot asks for one, until it stops asking. */
async function sendPhotos(p: ReturnType<typeof phone>, sampleId: string, replies: WaMessage[]) {
  for (let i = 0; i < 6; i++) {
    const doc = last(replies).expectsPhoto;
    if (!doc) return replies;
    replies = await p.photo(sampleId, doc);
  }
  return replies;
}

describe("WhatsApp channel (MOCK): the whole journey in chat", () => {
  it("Hi → language → advisor → bundle → buy → consent → KYC photos → MOCK e-sign → MOCK UPI → tracker", async () => {
    const { api, quoteStore, kycStore, orderStore, logLines } = setup();
    const p = phone(api);
    const hi = await p.say("Hi PTR-01");
    expect(hi).toHaveLength(1);
    expect(hi[0]!.text).toContain("Shree Mobile Point");
    expect(hi[0]!.text).toContain("MOCK WhatsApp Business API");
    expect(ids(hi[0]!)).toEqual(["lang:en", "lang:hi"]);

    const start = await p.tap("lang:en");
    expect(start[0]!.text).toContain("status");
    const rec = await toRecommendation(p, "I run a dental clinic in Kochi with 5 people");
    expect(last(rec).text).toMatch(/\/month/);

    const buy = await p.tap("buy");
    const quote = quoteStore.list()[0]!;
    expect(quote.attributionCode).toBe("PTR-01");
    expect(buy[0]!.text).toContain(quote.quoteId);
    expect(allText(buy)).toContain("never ask for your Aadhaar number");
    expect(allText(buy)).toContain("type *stop*");
    expect(ids(last(buy))).toEqual(["consent:yes", "consent:no"]);
    // The price on the card is the quote engine's, recomputed on accept.
    const live = await api.post("/api/quote").send(quote.request);
    expect(quote.quote.totals).toEqual(live.body.totals);

    const name = await p.tap("consent:yes");
    expect(kycStore.size).toBe(1);
    expect(ids(last(name))).toContain("sample:K03");
    let replies = await p.tap("sample:K03");
    expect(replies[0]!.text).toMatch(/MOCK registry lookup: \*.+\*, GSTIN \d{2}[A-Z0-9]{4}\*{6}[A-Z0-9]{3}, status \*Active\*/);
    replies = await sendPhotos(p, "K03", replies);
    expect(allText(replies)).toContain("All checks passed");
    const otp = /\*(\d{6})\*/.exec(last(replies).text)?.[1];
    expect(last(replies).text).toContain("MOCK");
    expect(otp).toBeDefined();

    expect(last(await p.say("000000")).text).toMatch(/not right\. 4 tries left/);
    const signed = await p.say(otp!);
    expect(signed[0]!.text).toMatch(/^Signed ✅ Reference ES-/);
    expect(last(signed).text).toContain("MOCK payment: no money moves");
    expect(ids(last(signed))).toEqual(["pay"]);

    const paid = await p.tap("pay");
    const order = orderStore.list()[0]!;
    expect(order.attributionCode).toBe("PTR-01");
    expect(paid[0]!.text).toContain(order.orderId);
    expect(last(paid).text).toContain("Now: Payment received, order placed");
    expect(ids(last(paid))).toEqual(["status", "advance"]);

    let track = paid;
    for (let i = 0; i < 3; i++) track = await p.tap("advance");
    expect(last(track).text).toContain("All done");
    expect(ids(last(track))).toEqual(["status"]);
    expect(last(await p.say("status")).text).toContain(order.orderId);

    // Same data as the app: the owner's tracker shows the order placed in WhatsApp.
    expect((await api.get(`/api/orders/${order.orderId}`)).body.activated).toBe(true);
    const log = logLines.join("\n");
    expect(log).not.toContain(PHONE);
    expect(log).not.toContain(otp!);
    expect(log).not.toContain("dental clinic");
    expect(JSON.stringify(p.seen)).not.toContain(PHONE);
  });

  it("manual review: the team decides in the back-office, the owner types status and signs", async () => {
    const { api } = setup();
    const p = phone(api);
    await p.say("hello");
    await p.tap("lang:en");
    await toRecommendation(p, "We are a physiotherapy clinic in Delhi with 6 people");
    await p.tap("buy");
    await p.tap("consent:yes");
    // K10: the person signing is not the applicant (the ID is always asked for).
    let replies = await sendPhotos(p, "K10", await p.tap("sample:K10"));
    expect(allText(replies)).toContain("Our team will check this");
    expect(allText(replies)).toContain("*Our team will look at:*");
    expect(last(await p.say("status")).text).toContain("Our team will check this");

    const token = (await api.post("/api/backoffice/session").send({ staffCode: "ADM-01" })).body.token;
    const queue = (await api.get("/api/backoffice/kyc").set("authorization", `Bearer ${token}`)).body;
    await api.post(`/api/backoffice/kyc/${queue.items[0].caseId}/review`).set("authorization", `Bearer ${token}`).send({ decision: "approved" });
    replies = await p.say("status");
    expect(allText(replies)).toContain("All checks passed");
    expect(last(replies).text).toMatch(/one-time password is \*\d{6}\*/);
  });

  it("fix needed: says what to do in the owner's language and waits for the right photo", async () => {
    const { api } = setup();
    const p = phone(api);
    await p.say("namaste");
    await p.tap("lang:hi");
    await toRecommendation(p, "मेरी पुणे में बेकरी है, 8 लोग काम करते हैं");
    await p.tap("buy");
    await p.tap("consent:yes");
    const replies = await sendPhotos(p, "K11", await p.tap("sample:K11"));
    const fix = last(replies);
    expect(DEVANAGARI.test(fix.text)).toBe(true);
    expect(fix.text).toContain("257");
    expect(fix.expectsPhoto).toBe("address_proof");
    expect(ids(fix)).toEqual(["check"]);
  });

  it("typing the details: name, a GSTIN with a typo is refused, then no GSTIN and no Udyam", async () => {
    const { api, kycStore } = setup();
    const p = phone(api);
    await p.say("hi");
    await p.tap("lang:en");
    await toRecommendation(p, "I have a kirana store in Jaipur with 2 people");
    await p.tap("buy");
    await p.tap("consent:yes");
    expect(last(await p.say("1234")).text).toContain("full name");
    expect(last(await p.say("Asha Verma")).text).toContain("GSTIN");
    const bad = await p.say("27AAACX1234A1Z0");
    expect(last(bad).text).toMatch(/does not look right/);
    await p.tap("gstin:none");
    const docs = await p.tap("udyam:no");
    expect(docs[0]!.text).toContain("not found");
    expect(last(docs).expectsPhoto).toBe("signatory_id");
    expect(kycStore.list()[0]!.business).toEqual({ applicantName: "Asha Verma", gstin: null, hasUdyam: false, udyamNumber: null });
    // Not having a document: the checks say it is missing.
    const missing = await p.tap("nodoc");
    expect(allText(missing)).toMatch(/missing/);
  });

  it("a call back uses the WhatsApp number only with a yes; 'not for me' records the reason", async () => {
    const { api, leadStore } = setup();
    const p = phone(api);
    await p.say("hi");
    await p.tap("lang:en");
    expect(ids(last(await p.say("person")))).toEqual(["handoff:yes", "handoff:no"]);
    expect(last(await p.tap("handoff:no")).text).toContain("no call");
    expect(leadStore.list()).toHaveLength(0);
    await p.say("talk to a human");
    const done = await p.tap("handoff:yes");
    expect(done[0]!.text).toMatch(/Reference: AL-/);
    expect(leadStore.list()[0]).toMatchObject({ reason: "asked_for_human", phone: PHONE, callbackConsent: true });

    const q = phone(api, "9988776655");
    await q.say("hi");
    await q.tap("lang:en");
    await toRecommendation(q, "I run a salon in Pune with 3 people");
    expect(ids(last(await q.tap("notforme")))).toContain("why:price_too_high");
    await q.tap("why:price_too_high");
    expect(leadStore.list().find((l) => l.reason === "price_too_high")).toMatchObject({ phone: null, callbackConsent: false });
  });

  it("stop withdraws consent: the KYC case and the chat are deleted", async () => {
    const { api, kycStore } = setup();
    const p = phone(api);
    await p.say("hi");
    await p.tap("lang:en");
    await toRecommendation(p, "I run a pharmacy in Pune with 4 people");
    await p.tap("buy");
    await p.tap("consent:yes");
    expect(kycStore.size).toBe(1);
    expect((await p.say("STOP"))[0]!.text).toContain("deleted");
    expect(kycStore.size).toBe(0);
    // A new message starts from the beginning.
    expect(ids((await p.say("hi"))[0]!)).toEqual(["lang:en", "lang:hi"]);
  });

  it("help, language switch, voice notes, unexpected answers and photos", async () => {
    const { api } = setup();
    const p = phone(api);
    await p.say("hi");
    await p.tap("lang:hi");
    expect((await p.say("help"))[0]!.text).toContain("*स्थिति*");
    expect((await p.say("English"))[0]!.text).toBe("OK, we will continue in English.");
    const voice = await p.say("I run a bakery in Pune with 4 people", true);
    expect(voice.length).toBeGreaterThan(0);
    expect((await api.post("/api/channels/whatsapp/photo").set("x-wa-from", PHONE).set("content-type", "image/png").send(sampleImage("K03", "signatory_id"))).body.replies[0].text).toContain(
      "do not need a photo",
    );
    await toRecommendation(p, "1");
    await p.tap("buy");
    const unclear = await p.say("maybe later?");
    expect(unclear[0]!.text).toContain("did not get that");
    expect(ids(unclear[0]!)).toEqual(["consent:yes", "consent:no"]);
    expect(last(await p.tap("pay")).text).toBeTruthy(); // a button from another step is answered, not obeyed
  });

  it("rejects bad requests", async () => {
    const { api } = setup();
    const send = (from: string | null, body: unknown) => {
      const r = api.post("/api/channels/whatsapp/messages");
      return (from ? r.set("x-wa-from", from) : r).send(body as object);
    };
    expect((await send(null, { text: "hi" })).status).toBe(400);
    expect((await send("12345", { text: "hi" })).status).toBe(400);
    expect((await send(PHONE, {})).status).toBe(400);
    expect((await send(PHONE, { text: "hi", buttonId: "lang:en" })).status).toBe(400);
    expect((await send(PHONE, { text: "x".repeat(501) })).status).toBe(400);
    expect((await send(PHONE, { buttonId: "<script>" })).status).toBe(400);
    expect((await send(PHONE, { text: "hi", voice: "yes" })).status).toBe(400);
    expect((await api.post("/api/channels/whatsapp/photo").set("x-wa-from", PHONE).set("content-type", "text/plain").send("hello")).status).toBe(415);
  });
});
