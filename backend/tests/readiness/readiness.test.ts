import request from "supertest";
import { describe, expect, it } from "vitest";
import { suggestGstin } from "../../src/kyc/suggest.js";
import type { Blocker } from "../../src/readiness/types.js";
import { CONSENT } from "../consent.js";
import { recordedReader, registries, sampleDocuments, sampleImage, samples } from "../kyc/helpers.js";
import { makeTestApp } from "../testApp.js";

/**
 * One-Sitting Completion + No Dead Ends: K01-K12 each give the expected state, blocker and fix
 * (the documents are what the OCR really reads from data/raw/kyc_documents), through the API.
 * Every sample uses the same simple quote (an office, 5 people, 1 site, tier 1), as an owner
 * would get from the advisor; partner assistance, coverage and expiry have their own tests.
 */

type Api = ReturnType<typeof request>;
const DEVANAGARI = /[ऀ-ॿ]/;
const OFFICE = { segment: "prof", variant: "standard", profile: { cityTier: 1, employees: 5, sites: 1, gstin: "active" }, exclude: [], include: [] as string[] };

function setup() {
  const t = makeTestApp(undefined, { documentReader: recordedReader() });
  return { ...t, api: request(t.app) };
}

async function quote(api: Api, body: Record<string, unknown> = OFFICE): Promise<string> {
  const res = await api.post("/api/quotes").send(body);
  expect(res.status).toBe(201);
  return res.body.quoteId;
}

/** Consent -> sample applicant -> all its documents -> "check my documents". */
async function applicant(api: Api, sampleId: string, quoteBody: Record<string, unknown> = OFFICE) {
  const quoteId = await quote(api, quoteBody);
  const caseId = (await api.post("/api/kyc/cases").send({ consent: CONSENT, lang: "en", quoteId })).body.caseId as string;
  await api.put(`/api/kyc/cases/${caseId}/business`).send({ sampleId });
  for (const d of samples.get(sampleId)!.documents) {
    expect((await api.put(`/api/kyc/cases/${caseId}/documents/${d}`).set("content-type", "image/png").send(sampleImage(sampleId, d))).status).toBe(200);
  }
  const view = (await api.post(`/api/kyc/cases/${caseId}/submit`)).body;
  return { caseId, quoteId, view, readiness: view.readiness as { state: string; percent: number; remaining: string[]; blockers: Blocker[]; optional: string[]; alternative: { bundle: string; state: string } | null } };
}

const open = (r: { blockers: Blocker[] }) => r.blockers.filter((b) => b.status === "open" || b.status === "in_progress");

describe("One-Sitting Completion: K01-K12 (state + blocker + fix)", () => {
  it("K01 cancelled GSTIN + a GSTIN-only add-on: not possible as chosen, the bundle without it is Ready; Udyam blank is optional", async () => {
    const { api } = setup();
    const { caseId, readiness } = await applicant(api, "K01", { ...OFFICE, include: ["P12"] }); // cloud telephony needs an active GSTIN
    expect(readiness.state).toBe("NOT_CURRENTLY_POSSIBLE");
    const [b] = open(readiness);
    expect(b).toMatchObject({ id: "eligibility:gstin", category: "eligibility", actionType: "choose_alternative", hard: true, alternative: { kind: "without_gstin_products", bundle: "Office Pro", removed: ["Cloud Telephony / SIP"] } });
    expect(b!.customerMessage.en).toContain("Cancelled");
    expect(DEVANAGARI.test(b!.customerMessage.hi)).toBe(true);
    expect(readiness.alternative).toEqual({ kind: "without_gstin_products", bundle: "Office Pro", state: "READY" });
    // No blocker for the blank Udyam certificate: Udyam is optional.
    expect(open(readiness).some((x) => x.id.includes("UDYAM"))).toBe(false);
    // Fix: one tap on the alternative -> a new quote from the rules engine, and the journey is Ready.
    const after = (await api.post(`/api/kyc/cases/${caseId}/alternative`).send({ kind: "without_gstin_products" })).body;
    expect(after.readiness.state).toBe("READY");
    expect(after.result.blockedProducts).toEqual([]);
    expect(after.blockerHistory).toEqual([expect.objectContaining({ id: "eligibility:gstin", status: "resolved", resolvedBy: "auto" })]);
  });

  it.each(["K02", "K03", "K08", "K09", "K12"])("%s: Ready, 100%%, nothing open", async (id) => {
    const { api } = setup();
    const { readiness } = await applicant(api, id);
    expect(readiness.state).toBe("READY");
    expect(readiness.percent).toBe(100);
    expect(open(readiness)).toEqual([]);
  });

  it("K04 blurred certificate: Almost ready, re-upload with photo tips", async () => {
    const { api } = setup();
    const { readiness } = await applicant(api, "K04");
    expect(readiness.state).toBe("ALMOST_READY");
    expect(open(readiness)).toEqual([
      expect.objectContaining({ id: "DOC_UNREADABLE:gst_certificate", actionType: "upload", responsibleParty: "customer", doc: "gst_certificate" }),
    ]);
    expect(open(readiness)[0]!.requiredAction.en).toMatch(/good light.*glare/);
  });

  it("K05 Udyam certificate missing: optional, Ready, the number lookup offered", async () => {
    const { api } = setup();
    const { readiness, view } = await applicant(api, "K05");
    expect(readiness.state).toBe("READY");
    expect(readiness.optional).toEqual(["udyam"]);
    expect(view.result.warnings.map((w: { code: string }) => w.code)).toContain("UDYAM_NOT_PROVIDED");
  });

  it("K06 certificate GSTIN fails the checksum: 'Did you mean ...?' with one-tap confirm, then Ready", async () => {
    const { api, logLines } = setup();
    const { caseId, readiness } = await applicant(api, "K06");
    expect(readiness.state).toBe("ALMOST_READY");
    const [b] = open(readiness);
    expect(b).toMatchObject({ id: "CERT_GSTIN_MISMATCH:gst_certificate", actionType: "confirm", suggestion: { gstinMasked: "08YK********1ZO", legalName: "Pooja Shah (Prop. Saffron Unisex Salon)" } });
    expect(b!.requiredAction.en).toContain("Did you mean 08YK********1ZO");
    const after = (await api.post(`/api/kyc/cases/${caseId}/gstin-suggestion`)).body;
    expect(after.readiness.state).toBe("READY");
    expect(after.result.warnings.map((w: { code: string }) => w.code)).toContain("CERT_GSTIN_CORRECTED");
    expect(JSON.stringify(after) + logLines.join("")).not.toContain("08YKZXS5189L1ZO");
  });

  it("K06 privacy: no suggestion (and no registry data) when the certificate's name does not match the near-miss record", () => {
    const docs = structuredClone(sampleDocuments("K06"));
    expect(suggestGstin(docs.gst_certificate, registries)).toMatchObject({ gstin: "08YKZXS5189L1ZO" });
    docs.gst_certificate!.fields.legalName = { value: "Someone Else (Prop. Other Shop)", confidence: 0.99, labelFound: true };
    docs.gst_certificate!.fields.tradeName = { value: "Other Shop", confidence: 0.99, labelFound: true };
    expect(suggestGstin(docs.gst_certificate, registries)).toBeNull();
  });

  it("K07 legal name differs: Needs review, by whom and when, with a specific question the owner can answer", async () => {
    const { api } = setup();
    const { caseId, readiness } = await applicant(api, "K07");
    expect(readiness.state).toBe("NEEDS_REVIEW");
    const [b] = open(readiness);
    expect(b).toMatchObject({ actionType: "wait_review", responsibleParty: "accel_ops", status: "in_progress", answer: null });
    expect(b!.expectedResolution.en).toContain("4 working hours");
    expect(b!.question!.en).toContain("legal name");
    const answered = (await api.post(`/api/kyc/cases/${caseId}/answers`).send({ blockerId: b!.id, answer: "We renamed the clinic in 2024; call 9876543210" })).body;
    const now = open(answered.readiness)[0]!;
    expect(now.answer).toBe("We renamed the clinic in 2024; call ******3210");
    // The back-office queue shows the same blocker with the answer.
    const token = (await api.post("/api/backoffice/session").send({ staffCode: "ADM-01" })).body.token;
    const queue = (await api.get("/api/backoffice/kyc").set("authorization", `Bearer ${token}`)).body;
    expect(queue.items[0].readiness).toMatchObject({ state: "NEEDS_REVIEW", blockers: [expect.objectContaining({ id: b!.id, answer: now.answer })] });
  });

  it("K10 signatory is not the registered owner: Needs review until the owner signs the MOCK link, then Ready", async () => {
    const { api } = setup();
    const { caseId, readiness } = await applicant(api, "K10");
    expect(readiness.state).toBe("NEEDS_REVIEW");
    expect(open(readiness)[0]).toMatchObject({ category: "signatory", actionType: "send_esign_link", status: "open" });
    const sent = (await api.post(`/api/kyc/cases/${caseId}/authorisation`)).body;
    expect(sent).toMatchObject({ mock: true, sentTo: "Fatima Menon", otp: expect.stringMatching(/^\d{6}$/) });
    expect(open(sent.case.readiness)[0]).toMatchObject({ status: "in_progress" });
    expect((await api.post(`/api/kyc/cases/${caseId}/authorisation/sign`).send({ otp: "000000" })).status).toBe(400);
    const signed = (await api.post(`/api/kyc/cases/${caseId}/authorisation/sign`).send({ otp: sent.otp })).body;
    expect(signed.readiness.state).toBe("READY");
    expect(signed.result.status).toBe("pass");
  });

  it("K11 bill 257 days old: Almost ready, 80% - 4 of 5, 'upload a bill dated on or after 16 April 2026'", async () => {
    const { api } = setup();
    const { readiness } = await applicant(api, "K11");
    expect(readiness).toMatchObject({ state: "ALMOST_READY", percent: 80, remaining: ["address"] });
    expect(open(readiness)).toEqual([expect.objectContaining({ id: "ADDRESS_PROOF_TOO_OLD:address_proof", actionType: "upload", doc: "address_proof" })]);
    expect(open(readiness)[0]!.requiredAction.en).toBe("Upload an electricity bill dated on or after 16 April 2026.");
  });
});

describe("One-Sitting Completion: before any upload, partners, coverage, expiry", () => {
  it("lookup first (before consent, nothing stored): the documents still needed and the readiness preview", async () => {
    const { api, kycStore } = setup();
    const quoteId = await quote(api);
    const res = (await api.post("/api/kyc/lookup").send({ sampleId: "K03", quoteId })).body;
    expect(res.documentsNeeded).toEqual(["signatory_id", "address_proof"]);
    expect(res.documentsNotNeeded).toBe(2);
    expect(res.registry.gst).toMatchObject({ gstin: "27XU********1ZP", status: "Active", legalName: "Joseph Singh (Prop. Ganesh Woodcraft)" });
    expect(res.readiness).toMatchObject({ state: "ALMOST_READY", percent: 60, remaining: ["signatory", "address"], expectedMinutes: 6 });
    expect(res.readiness.after).toMatchObject({ bundle: "Office Pro", days: 5, readyOn: "2026-07-20" });
    expect(kycStore.size).toBe(0);
  });

  it("3+ sites or more than Rs 10,000 a month: partner assistance recommended, the owner can still continue", async () => {
    const { api } = setup();
    const multi = { segment: "multi", variant: "standard", profile: { cityTier: 1, employees: 30, sites: 4, gstin: "active" }, exclude: [], include: [] };
    const { caseId, readiness } = await applicant(api, "K03", multi);
    expect(readiness.state).toBe("PARTNER_ASSISTANCE_RECOMMENDED");
    const partner = open(readiness).find((b) => b.id === "installation:partner")!;
    expect(partner).toMatchObject({ actionType: "contact_partner", responsibleParty: "partner", status: "in_progress", hard: false });
    expect(partner.customerMessage.en).toMatch(/4 locations/);
    // Still completable digitally: sign and pay, and the tracker shows the same blocker.
    const start = await api.post(`/api/kyc/cases/${caseId}/esign/start`);
    await api.post(`/api/kyc/cases/${caseId}/esign/verify`).send({ otp: start.body.otp });
    const order = (await api.post("/api/orders").send({ caseId, method: "upi" })).body;
    expect(order.blockers.map((b: Blocker) => b.id)).toEqual(["installation:partner"]);
  });

  it("MOCK coverage: no fibre in Bhopal -> not possible for Office Pro, the 5G AirFiber bundle offered", async () => {
    const { api } = setup();
    const quoteId = await quote(api);
    const res = (await api.post("/api/kyc/lookup").send({ gstin: "23AOUXS7882R1Z1", hasUdyam: false, quoteId })).body;
    expect(res.readiness.state).toBe("NOT_CURRENTLY_POSSIBLE");
    expect(res.readiness.feasibility).toMatchObject({ mock: true, city: "Bhopal", fibre: false });
    expect(res.readiness.blockers[0]).toMatchObject({ id: "feasibility:wired", alternative: { kind: "airfiber", bundle: "Dukaan Digital Starter" } });
    expect(res.readiness.alternative).toMatchObject({ kind: "airfiber", bundle: "Dukaan Digital Starter" });
  });

  it("an expired quote is a hard block with a one-tap re-quote", async () => {
    const { api, quoteStore } = setup();
    const { caseId, quoteId } = await applicant(api, "K03");
    quoteStore.get(quoteId)!.validUntil = "2026-07-10";
    const before = (await api.get(`/api/kyc/cases/${caseId}`)).body.readiness;
    expect(before.state).toBe("NOT_CURRENTLY_POSSIBLE");
    expect(open(before)[0]).toMatchObject({ id: "payment:quote_expired", alternative: { kind: "requote" } });
    const after = (await api.post(`/api/kyc/cases/${caseId}/alternative`).send({ kind: "requote" })).body;
    expect(after.readiness.state).toBe("READY");
    expect(after.quoteId).not.toBe(quoteId);
  });

  it("no next action is ever missing: every blocker of every sample has an action and both languages", async () => {
    const { api } = setup();
    for (const id of samples.keys()) {
      const { readiness } = await applicant(api, id, { ...OFFICE, include: ["P12"] });
      for (const b of readiness.blockers) {
        expect(b.actionType, `${id} ${b.id}`).toBeTruthy();
        expect(b.requiredAction.en.length, `${id} ${b.id}`).toBeGreaterThan(10);
        expect(DEVANAGARI.test(b.requiredAction.hi), `${id} ${b.id}`).toBe(true);
        expect(DEVANAGARI.test(b.customerMessage.hi), `${id} ${b.id}`).toBe(true);
        expect(b.expectedResolution.en, `${id} ${b.id}`).toBeTruthy();
      }
    }
  });

  it("save and return: the application is kept with its blockers; a return is counted", async () => {
    const { api, kycStore } = setup();
    const { caseId } = await applicant(api, "K11");
    const back = (await api.post(`/api/kyc/cases/${caseId}/resume`)).body;
    expect(back.readiness.state).toBe("ALMOST_READY");
    expect(open(back.readiness)[0]!.id).toBe("ADDRESS_PROOF_TOO_OLD:address_proof");
    expect(kycStore.get(caseId)!.journey.resumes).toBe(1);
  });

  it("metrics: journeys completed in one sitting, blockers auto-resolved, alternatives accepted", async () => {
    const { api } = setup();
    // One straight through.
    const k03 = await applicant(api, "K03");
    const s = await api.post(`/api/kyc/cases/${k03.caseId}/esign/start`);
    await api.post(`/api/kyc/cases/${k03.caseId}/esign/verify`).send({ otp: s.body.otp });
    expect((await api.post("/api/orders").send({ caseId: k03.caseId, method: "upi" })).status).toBe(201);
    // One that fixes its own problem: the unreadable, unneeded certificate is removed.
    const k04 = await applicant(api, "K04");
    await api.delete(`/api/kyc/cases/${k04.caseId}/documents/gst_certificate`);
    // One that takes the alternative.
    const k01 = await applicant(api, "K01", { ...OFFICE, include: ["P12"] });
    await api.post(`/api/kyc/cases/${k01.caseId}/alternative`).send({ kind: "without_gstin_products" });

    const token = (await api.post("/api/backoffice/session").send({ staffCode: "SLS-01" })).body.token;
    const m = (await api.get("/api/backoffice/metrics").set("authorization", `Bearer ${token}`)).body;
    expect(m).toMatchObject({ journeys: 3, completed: 1, completedInOneSitting: 1, oneSittingPercent: 33, alternativesAccepted: 1 });
    expect(m.blockers).toMatchObject({ resolved: 2, autoResolved: 2, autoResolvedPercent: 100 });
    expect(m.states).toMatchObject({ READY: 3 });
  });
});
