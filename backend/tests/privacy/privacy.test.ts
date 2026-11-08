import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { CONSENT_PURPOSES, CONSENT_VERSION } from "../../src/kyc/store.js";
import { createLogger } from "../../src/logger.js";
import { maskGstin, maskIdentifiers, maskIdNumber, maskPhone, maskUdyam } from "../../src/masking.js";
import { RETENTION } from "../../src/privacy/retention.js";
import { FileVault, parseKey } from "../../src/privacy/vault.js";
import { CONSENT } from "../consent.js";
import { recordedReader, sampleImage, samples } from "../kyc/helpers.js";
import { makeTestApp } from "../testApp.js";

/** Privacy inside the journey (DPDP Act 2023): consent enforced by the server, masking, encryption, deletion. */

type Api = ReturnType<typeof request>;
const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/;

function setup() {
  const t = makeTestApp(undefined, { documentReader: recordedReader() });
  return { ...t, api: request(t.app) };
}

async function k03(api: Api, withQuote = true) {
  const quoteId = withQuote
    ? (await api.post("/api/quotes").send({ segment: "prof", variant: "standard", profile: { cityTier: 1, employees: 5, sites: 1, gstin: "active" }, exclude: [], include: [] })).body.quoteId
    : undefined;
  const caseId = (await api.post("/api/kyc/cases").send({ consent: CONSENT, lang: "en", ...(quoteId ? { quoteId } : {}) })).body.caseId as string;
  await api.put(`/api/kyc/cases/${caseId}/business`).send({ sampleId: "K03" });
  for (const d of samples.get("K03")!.documents) await api.put(`/api/kyc/cases/${caseId}/documents/${d}`).set("content-type", "image/png").send(sampleImage("K03", d));
  await api.post(`/api/kyc/cases/${caseId}/submit`);
  return caseId;
}

const tmp: string[] = [];
afterAll(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("consent: specific, recorded, enforced by the server", () => {
  it("needs every KYC purpose named; marketing is separate and off unless ticked; the record is kept", async () => {
    const { api } = setup();
    const send = (consent: Record<string, unknown>) => api.post("/api/kyc/cases").send({ consent, lang: "hi" });
    expect((await send({ accepted: true, version: CONSENT_VERSION })).body.error).toBe("consent_purposes");
    expect((await send({ ...CONSENT, purposes: ["identity_verification"] })).body.error).toBe("consent_purposes");
    expect((await send({ ...CONSENT, purposes: [...CONSENT_PURPOSES, "service_improvement"] })).body.error).toBe("consent_purposes");
    expect((await send({ ...CONSENT, marketing: "yes" })).status).toBe(400);
    const res = await send({ accepted: true, version: CONSENT_VERSION, purposes: [...CONSENT_PURPOSES] });
    expect(res.status).toBe(201);
    expect(res.body.consent).toEqual({ id: expect.stringMatching(/^CON-[0-9A-F]{8}$/), version: CONSENT_VERSION, acceptedOn: "2026-07-15", purposes: [...CONSENT_PURPOSES], marketing: false, channel: "app" });
  });

  it("no upload, KYC step or e-sign under a withdrawn consent (403)", async () => {
    const { api } = setup();
    const caseId = await k03(api);
    await api.delete(`/api/kyc/cases/${caseId}`);
    const calls = [
      api.put(`/api/kyc/cases/${caseId}/documents/address_proof`).set("content-type", "image/png").send(sampleImage("K03", "address_proof")),
      api.put(`/api/kyc/cases/${caseId}/business`).send({ sampleId: "K03" }),
      api.post(`/api/kyc/cases/${caseId}/submit`),
      api.post(`/api/kyc/cases/${caseId}/esign/start`),
      api.post(`/api/kyc/cases/${caseId}/alternative`).send({ kind: "requote" }),
      api.post(`/api/kyc/cases/${caseId}/authorisation`),
      api.post(`/api/kyc/cases/${caseId}/documents/delete`),
    ];
    for (const res of await Promise.all(calls)) expect(res.body).toMatchObject({ error: "consent_withdrawn" });
    for (const res of await Promise.all([api.post(`/api/kyc/cases/${caseId}/submit`)])) expect(res.status).toBe(403);
  });
});

describe("lookup first: ask only for what the registries could not confirm", () => {
  it("the consent screen gets just the documents still needed", async () => {
    const { api } = setup();
    const found = (await api.post("/api/kyc/lookup").send({ sampleId: "K03" })).body;
    expect(found.documentsNeeded).toEqual(["signatory_id", "address_proof"]);
    expect(found.documents).toEqual({ gst_certificate: "optional", udyam_certificate: "optional", signatory_id: "required", address_proof: "required" });
    const unknown = (await api.post("/api/kyc/lookup").send({ gstin: "27AAPFU0939F1ZV", hasUdyam: false })).body;
    expect(unknown.documentsNeeded).toEqual(["gst_certificate", "signatory_id", "address_proof"]);
    const none = (await api.post("/api/kyc/lookup").send({ gstin: null, hasUdyam: false })).body;
    expect(none.documentsNeeded).toEqual(["signatory_id", "address_proof"]);
    expect((await api.post("/api/kyc/lookup").send({ gstin: "08YKZXS8189L1ZO", hasUdyam: false })).status).toBe(400);
    expect(JSON.stringify(found)).not.toMatch(GSTIN_RE);
  });
});

describe("masking: one utility, everywhere", () => {
  it("GSTIN first 4 + last 3; Udyam, ID numbers and phones the last 4", () => {
    expect(maskGstin("27XUIXG0767D1ZP")).toBe("27XU********1ZP");
    expect(maskUdyam("UDYAM-MH-00-9516696")).toBe("UDYAM-**-**-***6696");
    expect(maskIdNumber("SYN-ID-447889")).toBe("SYN-ID-**7889");
    expect(maskIdNumber("AB1234")).toBe("**1234");
    expect(maskPhone("9876543210")).toBe("******3210");
  });

  it("the logger redacts GSTIN, Udyam, ID and phone in messages and fields, and never writes documents", () => {
    const lines: string[] = [];
    const log = createLogger({ service: "backend", level: "info", sink: (l) => lines.push(l) });
    log.info("owner 9876543210 sent 27XUIXG0767D1ZP", { udyam: "UDYAM-MH-00-9516696", id: "SYN-ID-447889", image: Buffer.from("PNG"), ocrText: "Joseph Singh" });
    const out = lines.join("\n");
    for (const raw of ["9876543210", "27XUIXG0767D1ZP", "UDYAM-MH-00-9516696", "SYN-ID-447889", "Joseph Singh"]) expect(out).not.toContain(raw);
    expect(out).toContain("27XU********1ZP");
    expect(maskIdentifiers("27XUIXG0767D1ZP / 9876543210")).toBe("27XU********1ZP / ******3210");
  });
});

describe("encrypted document storage", () => {
  it("files are encrypted at rest with the .env key, unreadable with another key, and deleted for real", () => {
    const dir = mkdtempSync(join(tmpdir(), "udyam-vault-"));
    tmp.push(dir);
    const key = parseKey("11".repeat(32))!;
    const vault = new FileVault(dir, key);
    const png = sampleImage("K03", "address_proof");
    const id = vault.put(png);
    const [file] = readdirSync(dir);
    expect(file).toBe(`${id}.bin`);
    const stored = readFileSync(join(dir, file!));
    expect(stored.subarray(0, 4).toString("hex")).not.toBe("89504e47"); // not a readable PNG
    expect(stored.includes(png.subarray(100, 140))).toBe(false);
    expect(vault.get(id)!.equals(png)).toBe(true);
    expect(new FileVault(dir, parseKey("22".repeat(32))!).get(id)).toBeNull();
    expect(vault.delete(id)).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
    expect(vault.get(id)).toBeNull();
    expect(() => parseKey("too-short")).toThrow(/32 bytes/);
    expect(parseKey("")).toBeNull();
  });

  it("only the operations desk can see a stored photo; the view is logged; sales cannot", async () => {
    const { api, logLines } = setup();
    const caseId = await k03(api);
    const admin = (await api.post("/api/backoffice/session").send({ staffCode: "ADM-01" })).body.token;
    const sales = (await api.post("/api/backoffice/session").send({ staffCode: "SLS-01" })).body.token;
    const url = `/api/backoffice/kyc/${caseId}/documents/address_proof`;
    expect((await api.get(url)).status).toBe(401);
    expect((await api.get(url).set("authorization", `Bearer ${sales}`)).status).toBe(403);
    const res = await api.get(url).set("authorization", `Bearer ${admin}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect((res.body as Buffer).equals(sampleImage("K03", "address_proof"))).toBe(true);
    expect(logLines.some((l) => l.includes("kyc document viewed") && l.includes("ADM-01"))).toBe(true);
  });
});

describe("My data, deletion and the retention job", () => {
  it("shows what is held (masked), the purposes, the consent date and each document's deletion countdown", async () => {
    const { api } = setup();
    const caseId = await k03(api);
    const me = (await api.get(`/api/kyc/cases/${caseId}/my-data`)).body;
    expect(me).toMatchObject({ status: "active", consent: { acceptedOn: "2026-07-15", purposes: [...CONSENT_PURPOSES], marketing: false }, retention: { rawDocumentDaysAfterVerification: 30, status: RETENTION.status } });
    expect(me.held).toMatchObject({ applicantName: "Joseph Singh", gstin: "27XU********1ZP", verificationResult: "pass" });
    expect(me.documents).toHaveLength(4);
    expect(me.documents[0]).toMatchObject({ encrypted: true, storedOn: "2026-07-15", deleteDueOn: "2026-08-14", daysLeft: 30, deletedOn: null });
    expect(JSON.stringify(me)).not.toMatch(GSTIN_RE);
  });

  it("delete my documents: the files are gone, the result is kept, 'Deleted on' is shown", async () => {
    const { api, kycStore, vault } = setup();
    const caseId = await k03(api);
    const fileIds = Object.values(kycStore.get(caseId)!.files).map((f) => f!.fileId);
    expect(fileIds.every((id) => vault.has(id))).toBe(true);
    const me = (await api.post(`/api/kyc/cases/${caseId}/documents/delete`)).body;
    expect(fileIds.some((id) => vault.has(id))).toBe(false);
    expect(me.documents.every((d: { deletedOn: string }) => d.deletedOn === "2026-07-15")).toBe(true);
    expect(me.deletionLog).toHaveLength(4);
    expect(me.deletionLog[0]).toEqual({ what: "gst_certificate", deletedOn: "2026-07-15", reason: "owner_request" });
    expect(me.held.verificationResult).toBe("pass");
  });

  it("retention job: deletes photos once their period is over (manual trigger, DEMO date), records why", async () => {
    const { api, kycStore, vault } = setup();
    const caseId = await k03(api);
    const admin = (await api.post("/api/backoffice/session").send({ staffCode: "ADM-01" })).body.token;
    const run = (asOf?: string) => api.post("/api/backoffice/retention/run").set("authorization", `Bearer ${admin}`).send(asOf ? { asOf } : {});
    expect((await run()).body).toEqual({ asOf: "2026-07-15", files: 0, cases: 0 });
    expect((await run("2026-08-13")).body.files).toBe(0);
    expect((await run("2026-08-14")).body).toEqual({ asOf: "2026-08-14", files: 4, cases: 1 });
    expect(Object.values(kycStore.get(caseId)!.files).every((f) => f!.deletedOn === "2026-08-14" && !vault.has(f!.fileId))).toBe(true);
    expect(kycStore.get(caseId)!.deletionLog.every((e) => e.reason === "retention")).toBe(true);
    expect((await run("2026-01-01")).status).toBe(400);
  });

  it("withdrawal deletes everything, stops an order not yet activated, and the tracker says so", async () => {
    const { api, vault, kycStore } = setup();
    const caseId = await k03(api);
    const start = await api.post(`/api/kyc/cases/${caseId}/esign/start`);
    await api.post(`/api/kyc/cases/${caseId}/esign/verify`).send({ otp: start.body.otp });
    const order = (await api.post("/api/orders").send({ caseId, method: "upi" })).body;
    const fileIds = Object.values(kycStore.get(caseId)!.files).map((f) => f!.fileId);
    expect((await api.delete(`/api/kyc/cases/${caseId}`)).body).toMatchObject({ withdrawn: true, orderStopped: true, deletedOn: "2026-07-15" });
    expect(fileIds.some((id) => vault.has(id))).toBe(false);
    const tracker = (await api.get(`/api/orders/${order.orderId}`)).body;
    expect(tracker).toMatchObject({ stopped: { on: "2026-07-15", reason: "consent_withdrawn" }, activated: false });
    expect((await api.post(`/api/orders/${order.orderId}/advance`)).body).toEqual({ error: "consent_withdrawn" });
    const me = (await api.get(`/api/kyc/cases/${caseId}/my-data`)).body;
    expect(me).toMatchObject({ status: "withdrawn", held: null, consent: { withdrawnOn: "2026-07-15" }, orderId: order.orderId });
    expect(me.deletionLog.at(-1)).toEqual({ what: "all_kyc_data", deletedOn: "2026-07-15", reason: "withdrawal" });
  });

  it("an activated order is not undone by a withdrawal (records already completed stay)", async () => {
    const { api } = setup();
    const caseId = await k03(api);
    const start = await api.post(`/api/kyc/cases/${caseId}/esign/start`);
    await api.post(`/api/kyc/cases/${caseId}/esign/verify`).send({ otp: start.body.otp });
    const order = (await api.post("/api/orders").send({ caseId, method: "upi" })).body;
    for (let i = 0; i < 3; i++) await api.post(`/api/orders/${order.orderId}/advance`);
    expect((await api.delete(`/api/kyc/cases/${caseId}?cancel=true`)).body.orderStopped).toBe(false);
    expect((await api.get(`/api/orders/${order.orderId}`)).body).toMatchObject({ activated: true, stopped: null });
    expect((await api.get(`/api/kyc/cases/${caseId}/my-data`)).body.status).toBe("cancelled");
  });

  it("publishes the retention periods (one config, marked proposed) and the purposes", async () => {
    const { api } = setup();
    const res = (await api.get("/api/privacy/retention")).body;
    expect(res.retention.status).toBe("proposed - to be confirmed by legal");
    expect(res.purposes).toEqual([...CONSENT_PURPOSES]);
  });
});
