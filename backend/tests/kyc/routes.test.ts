import request from "supertest";
import { describe, expect, it } from "vitest";
import { MAX_OTP_ATTEMPTS, OTP_TTL_MS, agreementHash, startEsign, verifyEsign, type Agreement } from "../../src/kyc/esign.js";
import { NO_READER, type DocType } from "../../src/kyc/documents.js";
import { CONSENT_VERSION, KycCaseStore } from "../../src/kyc/store.js";
import { makeTestApp } from "../testApp.js";
import { recordedReader, registries, sampleImage, samples } from "./helpers.js";

const consent = { accepted: true, version: CONSENT_VERSION };

function setup(options: Parameters<typeof makeTestApp>[1] = {}) {
  const reader = recordedReader();
  const t = makeTestApp(undefined, { documentReader: reader, ...options });
  return { ...t, reader, api: request(t.app) };
}

async function startCase(api: ReturnType<typeof request>, body: Record<string, unknown> = {}) {
  const res = await api.post("/api/kyc/cases").send({ consent, lang: "en", ...body });
  expect(res.status).toBe(201);
  return res.body.caseId as string;
}

async function upload(api: ReturnType<typeof request>, caseId: string, sampleId: string, doc: DocType, slot: DocType = doc) {
  return api.put(`/api/kyc/cases/${caseId}/documents/${slot}`).set("content-type", "image/png").send(sampleImage(sampleId, doc));
}

/** Consent -> sample business -> upload every document of the sample -> submit. */
async function runSample(api: ReturnType<typeof request>, sampleId: string, body: Record<string, unknown> = {}) {
  const caseId = await startCase(api, body);
  expect((await api.put(`/api/kyc/cases/${caseId}/business`).send({ sampleId })).status).toBe(200);
  for (const doc of samples.get(sampleId)!.documents) expect((await upload(api, caseId, sampleId, doc)).status).toBe(200);
  const res = await api.post(`/api/kyc/cases/${caseId}/submit`);
  expect(res.status).toBe(200);
  return { caseId, view: res.body };
}

describe("KYC API: consent", () => {
  it("needs explicit consent with the current notice version", async () => {
    const { api } = setup();
    expect((await api.post("/api/kyc/cases").send({ lang: "en" })).body).toEqual({ error: "consent_required" });
    expect((await api.post("/api/kyc/cases").send({ consent: { accepted: false, version: CONSENT_VERSION } })).status).toBe(400);
    const old = await api.post("/api/kyc/cases").send({ consent: { accepted: true, version: "old" } });
    expect(old.body).toEqual({ error: "consent_version", current: CONSENT_VERSION });
    expect((await api.post("/api/kyc/cases").send({ consent, quoteId: "Q-00000000" })).body).toEqual({ error: "quote_not_found" });
    const res = await api.post("/api/kyc/cases").send({ consent, lang: "hi" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ caseId: expect.stringMatching(/^KYC-[0-9A-F]{8}$/), consent: { version: CONSENT_VERSION, acceptedOn: "2026-07-15" } });
    expect(res.body.result.status).toBe("not_started");
  });

  it("withdrawing consent deletes the case and everything in it", async () => {
    const { api, kycStore, logLines } = setup();
    const { caseId } = await runSample(api, "K03");
    expect(kycStore.size).toBe(1);
    expect((await api.delete(`/api/kyc/cases/${caseId}`)).body).toEqual({ withdrawn: true, deleted: true });
    expect(kycStore.size).toBe(0);
    expect((await api.get(`/api/kyc/cases/${caseId}`)).status).toBe(404);
    expect(logLines.some((l) => l.includes("kyc consent withdrawn"))).toBe(true);
  });

  it("answers 404 for unknown or malformed case ids", async () => {
    const { api } = setup();
    expect((await api.get("/api/kyc/cases/KYC-00000000")).status).toBe(404);
    expect((await api.get("/api/kyc/cases/whatever")).status).toBe(404);
  });
});

describe("KYC API: business details and lookups", () => {
  it("validates GSTIN (format, state, PAN type, checksum), Udyam and the name", async () => {
    const { api } = setup();
    const caseId = await startCase(api);
    const res = await api.put(`/api/kyc/cases/${caseId}/business`).send({
      applicantName: "1",
      gstin: "08YKZXS8189L1ZO",
      hasUdyam: false,
      udyamNumber: "UDYAM-MH-00-9516696",
    });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([
      { field: "applicantName", problem: "invalid" },
      { field: "gstin", problem: "checksum" },
      { field: "udyamNumber", problem: "not_registered" },
    ]);
    const bad = await api.put(`/api/kyc/cases/${caseId}/business`).send({ applicantName: "Joseph Singh", gstin: 5, hasUdyam: "yes" });
    expect(bad.body.details).toEqual([
      { field: "gstin", problem: "format" },
      { field: "hasUdyam", problem: "invalid" },
    ]);
  });

  it("looks the GSTIN up and fills the business details (MOCK registry), masking the number", async () => {
    const { api } = setup();
    const caseId = await startCase(api);
    const res = await api
      .put(`/api/kyc/cases/${caseId}/business`)
      .send({ applicantName: "  Joseph   Singh ", gstin: "27xuixg0767d1zp", hasUdyam: true, udyamNumber: "udyam-mh-00-9516696" });
    expect(res.status).toBe(200);
    expect(res.body.business).toEqual({ applicantName: "Joseph Singh", gstin: "27XUIX******1ZP", hasUdyam: true, udyamNumber: "UDYAM-MH-00-****696" });
    expect(res.body.registry.gst).toEqual({
      gstin: "27XUIX******1ZP",
      legalName: "Joseph Singh (Prop. Ganesh Woodcraft)",
      tradeName: "Ganesh Woodcraft",
      constitution: "Proprietorship",
      address: "Shop/Unit 80, Civil Lines, Nagpur, Maharashtra - 411231",
      state: "Maharashtra",
      status: "Active",
    });
    expect(res.body.registry.udyam.enterpriseName).toBe("Ganesh Woodcraft");
    expect(res.body.documents.gst_certificate.need).toBe("optional"); // lookup worked: no upload needed
    expect(JSON.stringify(res.body)).not.toContain("27XUIXG0767D1ZP");
    expect(JSON.stringify(res.body)).not.toContain("9516696");
  });

  it("MOCK lookup APIs: found (masked), not found, invalid", async () => {
    const { api } = setup();
    const g = await api.get("/api/lookup/gstin/37IHKXV5167L1ZS");
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ mock: true, found: true, gstin: "37IHKX******1ZS", status: "Cancelled", tradeName: "Vindhya Tours & Travels" });
    expect((await api.get("/api/lookup/gstin/27AAPFU0939F1ZV")).body).toEqual({ mock: true, found: false });
    expect((await api.get("/api/lookup/gstin/27XUIXG0767D1ZQ")).body).toEqual({ error: "invalid_gstin", problem: "checksum" });
    const u = await api.get("/api/lookup/udyam/UDYAM-KL-00-5521886");
    expect(u.body).toMatchObject({ mock: true, found: true, udyamNumber: "UDYAM-KL-00-****886", enterpriseName: "Balaji Realty LLP" });
    expect((await api.get("/api/lookup/udyam/UDYAM-KL-00-0000000")).status).toBe(404);
    expect((await api.get("/api/lookup/udyam/nope")).status).toBe(400);
  });
});

describe("KYC API: documents", () => {
  it("K03 end to end: upload -> OCR -> checks -> pass, with masked document details", async () => {
    const { api, reader } = setup();
    const { view } = await runSample(api, "K03");
    expect(reader.calls).toBe(4);
    expect(view.result.status).toBe("pass");
    expect(view.result.issues).toEqual([]);
    expect(view.documents.gst_certificate.read).toEqual({ gstin: "27XUIX******1ZP", legalName: "Joseph Singh (Prop. Ganesh Woodcraft)", tradeName: "Ganesh Woodcraft" });
    expect(view.documents.signatory_id.read).toEqual({ name: "Joseph Singh", designation: "Owner", idNumber: "**********889", validTill: "2028-07-04" });
    expect(view.documents.udyam_certificate.read.udyamNumber).toBe("UDYAM-MH-00-****696");
    expect(view.documents.address_proof.read.billDate).toBe("2026-05-30");
  });

  it.each([
    ["K01", "manual_review"],
    ["K02", "pass"],
    ["K03", "pass"],
    ["K04", "fix_needed"],
    ["K05", "fix_needed"],
    ["K06", "fix_needed"],
    ["K07", "manual_review"],
    ["K08", "pass"],
    ["K09", "pass"],
    ["K10", "manual_review"],
    ["K11", "fix_needed"],
    ["K12", "pass"],
  ])("%s through the API -> %s", async (id, status) => {
    const { api } = setup();
    const { view } = await runSample(api, id);
    expect(view.result.status).toBe(status);
  });

  it("before submit, missing documents mean 'in progress'; a re-upload replaces the document", async () => {
    const { api } = setup();
    const caseId = await startCase(api);
    await api.put(`/api/kyc/cases/${caseId}/business`).send({ sampleId: "K11" });
    let res = await upload(api, caseId, "K11", "signatory_id");
    expect(res.body.result.status).toBe("in_progress");
    // K11's old bill, then K11's again in the GST slot: wrong document type.
    res = await upload(api, caseId, "K11", "address_proof", "gst_certificate");
    expect(res.body.result.issues).toContainEqual({ code: "DOC_WRONG_TYPE", severity: "fix", doc: "gst_certificate", params: { detected: "address_proof" } });
    res = await api.delete(`/api/kyc/cases/${caseId}/documents/gst_certificate`);
    expect(res.body.documents.gst_certificate.uploaded).toBe(false);
  });

  it("refuses uploads that are not images, too large, unknown slots, or before the business details", async () => {
    const { api } = setup();
    const caseId = await startCase(api);
    expect((await upload(api, caseId, "K03", "signatory_id")).body).toEqual({ error: "business_details_missing" });
    await api.put(`/api/kyc/cases/${caseId}/business`).send({ sampleId: "K03" });
    const pdf = await api.put(`/api/kyc/cases/${caseId}/documents/signatory_id`).set("content-type", "application/pdf").send(Buffer.from("%PDF"));
    expect(pdf.status).toBe(415);
    const big = await api.put(`/api/kyc/cases/${caseId}/documents/signatory_id`).set("content-type", "image/png").send(Buffer.alloc(8 * 1024 * 1024 + 1));
    expect(big.status).toBe(413);
    expect(big.body).toEqual({ error: "too_large" });
    const junk = await api.put(`/api/kyc/cases/${caseId}/documents/signatory_id`).set("content-type", "image/png").send(Buffer.from("not really a png"));
    expect(junk.status).toBe(422);
    expect((await upload(api, caseId, "K03", "signatory_id", "passport" as DocType)).status).toBe(400);
    const empty = await api.put(`/api/kyc/cases/${caseId}/documents/signatory_id`).set("content-type", "image/png").send(Buffer.alloc(0));
    expect(empty.status).toBe(400);
  });

  it("says OCR is unavailable (503) when the ai-service cannot read", async () => {
    const t = makeTestApp(undefined, { documentReader: NO_READER });
    const api = request(t.app);
    const caseId = await startCase(api);
    await api.put(`/api/kyc/cases/${caseId}/business`).send({ sampleId: "K03" });
    const res = await upload(api, caseId, "K03", "signatory_id");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "ocr_unavailable" });
  });

  it("K01 with a quote: the cancelled GSTIN blocks the quote's GSTIN-only products", async () => {
    const { api } = setup();
    const quote = await api.post("/api/quotes").send({
      segment: "micro",
      variant: "standard",
      profile: { cityTier: 1, employees: 4, sites: 1, gstin: "active" },
      exclude: [],
      include: ["P15"],
    });
    expect(quote.status).toBe(201);
    const { view } = await runSample(api, "K01", { quoteId: quote.body.quoteId });
    expect(view.quoteId).toBe(quote.body.quoteId);
    expect(view.result.gstin).toBe("cancelled");
    expect(view.result.blockedProducts).toEqual([{ productId: "P15", name: "WhatsApp Business API Starter" }]);
    expect(view.documents.udyam_certificate.state).toBe("rejected");
  });
});

describe("KYC API: MOCK e-sign", () => {
  it("only after a pass; wrong code counts down; right code signs and locks the case", async () => {
    let now = 1_000_000;
    const { api } = setup({ nowMs: () => now });
    const k11 = await runSample(api, "K11");
    expect((await api.post(`/api/kyc/cases/${k11.caseId}/esign/start`)).body).toEqual({ error: "kyc_not_passed", status: "fix_needed" });

    const { caseId } = await runSample(api, "K03");
    expect((await api.post(`/api/kyc/cases/${caseId}/esign/verify`).send({ otp: "123456" })).body).toEqual({ error: "esign_not_started" });
    const start = await api.post(`/api/kyc/cases/${caseId}/esign/start`);
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ mock: true, otp: expect.stringMatching(/^\d{6}$/) });
    expect(start.body.agreement).toMatchObject({ caseId, business: "Joseph Singh (Prop. Ganesh Woodcraft)", gstin: "27XUIX******1ZP", signatory: "Joseph Singh", date: "2026-07-15" });
    const otp: string = start.body.otp;
    const wrong = otp === "000000" ? "111111" : "000000";
    expect((await api.post(`/api/kyc/cases/${caseId}/esign/verify`).send({ otp: wrong })).body).toEqual({ error: "wrong_otp", attemptsLeft: 4 });
    now += 60_000;
    const ok = await api.post(`/api/kyc/cases/${caseId}/esign/verify`).send({ otp });
    expect(ok.status).toBe(200);
    expect(ok.body.esign.signed).toMatchObject({ reference: expect.stringMatching(/^ES-[0-9A-F]{8}$/), signedOn: "2026-07-15", documentHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(ok.body.esign.signed.documentHash).toBe(agreementHash(start.body.agreement));
    // Signed: no more changes.
    expect((await upload(api, caseId, "K03", "signatory_id")).body).toEqual({ error: "case_signed" });
    expect((await api.put(`/api/kyc/cases/${caseId}/business`).send({ sampleId: "K02" })).status).toBe(409);
    expect((await api.post(`/api/kyc/cases/${caseId}/esign/verify`).send({ otp })).body.error).toBe("already_signed");
  });

  it("OTP expiry and attempt limit", () => {
    const agreement: Agreement = { caseId: "KYC-1", business: "b", gstin: null, signatory: "s", quote: null, consentVersion: "v", date: "2026-07-15" };
    const state = startEsign(0, () => "123456");
    expect(verifyEsign(state, "123456", agreement, OTP_TTL_MS + 1, "2026-07-15")).toEqual({ ok: false, error: "otp_expired", attemptsLeft: MAX_OTP_ATTEMPTS });
    const s2 = startEsign(0, () => "123456");
    for (let i = 1; i < MAX_OTP_ATTEMPTS; i++) expect(verifyEsign(s2, "999999", agreement, 0, "2026-07-15")).toMatchObject({ error: "wrong_otp" });
    expect(verifyEsign(s2, "999999", agreement, 0, "2026-07-15")).toEqual({ ok: false, error: "too_many_attempts", attemptsLeft: 0 });
    expect(verifyEsign(s2, "123456", agreement, 0, "2026-07-15")).toEqual({ ok: false, error: "too_many_attempts", attemptsLeft: 0 });
    expect(verifyEsign(startEsign(0, () => "123456"), "12345", agreement, 0, "2026-07-15")).toMatchObject({ error: "wrong_otp" });
  });
});

describe("KYC API: privacy and demo samples", () => {
  it("never sends or logs a full identifier, and never logs document contents", async () => {
    const { api, logLines } = setup();
    const bodies: string[] = [];
    for (const id of ["K02", "K06", "K10"]) bodies.push(JSON.stringify((await runSample(api, id)).view));
    await api.get("/api/lookup/gstin/19EOGXH4115Y1ZL");
    const log = logLines.join("\n");
    const secrets = ["19EOGXH4115Y1ZL", "08YKZXS5189L1ZO", "08YKZXS8189L1Z0", "27QHJXK0658U1ZL", "UDYAM-WB-00-5053330", "SYN-ID-816907", "9790713533"];
    for (const secret of secrets) {
      for (const body of bodies) expect(body).not.toContain(secret);
      expect(log).not.toContain(secret);
    }
    // Names and addresses read from documents stay out of the log too.
    for (const text of ["Joseph Shah", "Nisha Arora", "Station Road"]) expect(log).not.toContain(text);
    expect(log).toContain("19EOGX******1ZL"); // the lookup path, masked by the logger
  });

  it("lists the 12 sample applicants without identifiers and serves their images", async () => {
    const { api } = setup();
    const list = await api.get("/api/kyc/samples");
    expect(list.body.samples).toHaveLength(12);
    expect(list.body.samples[0]).toEqual({ id: "K01", businessName: "Vindhya Tours & Travels", documents: ["gst_certificate", "udyam_certificate", "signatory_id", "address_proof"] });
    expect(JSON.stringify(list.body)).not.toMatch(/\d{2}[A-Z]{5}\d{4}/);
    const img = await api.get("/api/kyc/samples/K02/documents/gst_certificate");
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(img.body as Buffer, sampleImage("K02", "gst_certificate"))).toBe(0);
    expect((await api.get("/api/kyc/samples/K05/documents/udyam_certificate")).status).toBe(404);
    expect((await api.get("/api/kyc/samples/K13/documents/gst_certificate")).status).toBe(404);
    expect((await api.get("/api/kyc/samples/..%2F..%2Fsecret/documents/gst_certificate")).status).toBe(404);
    expect((await api.put(`/api/kyc/cases/${await startCase(api)}/business`).send({ sampleId: "K99" })).status).toBe(400);
  });

  it("keeps at most the configured number of cases (oldest out)", () => {
    let n = 0;
    const store = new KycCaseStore(() => "2026-07-15", () => `KYC-${String(++n).padStart(8, "0")}`, 2);
    const a = store.create("en", null);
    store.create("en", null);
    store.create("hi", null);
    expect(store.size).toBe(2);
    expect(store.get(a.caseId)).toBeUndefined();
    expect(registries.gst.size).toBeGreaterThan(0);
  });
});
