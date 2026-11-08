import { readFileSync } from "node:fs";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { parseCsv } from "../../backend/src/catalogue/csv";
import { DEFAULT_LEADS_PATH } from "../../backend/src/cities";
import type { PropensityApi } from "../../backend/src/propensity/client";
import { recordedReader, sampleImage, samples } from "../../backend/tests/kyc/helpers";
import { CONSENT_VERSION } from "./api/kyc";
import { App } from "./App";
import { BackOffice } from "./components/backoffice/BackOffice";
import { KycResult } from "./components/kyc/KycDocuments";
import type { KycCase } from "./api/kyc";
import { hi } from "./i18n/hi";
import { I18nProvider, type Lang } from "./i18n/I18nProvider";
import { startBackend, type LiveBackend } from "./test/liveBackend";

/**
 * Back-office screens and the partner referral against the real backend. Only the propensity
 * model (Python, ai-service) is replaced: a referred lead scores 90 (high), others 50 (medium);
 * past-quarter leads score their number % 101.
 */

const DATA_IDS = parseCsv(readFileSync(DEFAULT_LEADS_PATH, "utf8")).map((r) => r.lead_id!);
const band = (s: number) => (s >= 80 ? "high" : s >= 40 ? "medium" : "low");
const model: PropensityApi = {
  async call(method, path, body) {
    if (method === "POST" && path === "/propensity/score") {
      const leads = (body as { leads: { id: string; lead: Record<string, unknown> }[] }).leads;
      return {
        status: 200,
        body: {
          scores: leads.map((l) => {
            const score = l.lead.lead_source === "Channel partner" ? 90 : 50;
            return { id: l.id, probability: score / 500, score, band: band(score), reasons: [{ feature: "lead_source", value: String(l.lead.lead_source ?? "?"), effect: "up", weight: 0.4 }] };
          }),
        },
      };
    }
    if (path === "/propensity/leads") {
      return { status: 200, body: { scores: DATA_IDS.map((id) => ({ id, probability: 0.1, score: Number(id.slice(1)) % 101, band: band(Number(id.slice(1)) % 101), reasons: [] })) } };
    }
    return { status: 404, body: {} };
  },
};

let backend: LiveBackend;
beforeAll(async () => {
  backend = await startBackend({ documentReader: recordedReader(), propensity: model });
});
afterAll(async () => {
  await backend.close();
});
afterEach(() => {
  window.history.replaceState({}, "", "/");
});

const user = () => userEvent.setup();

const renderBackOffice = (lang: Lang = "en") =>
  render(
    <I18nProvider initialLang={lang}>
      <BackOffice fetchFn={backend.fetchFn} />
    </I18nProvider>,
  );

async function post(url: string, body: unknown) {
  const res = await backend.fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as Record<string, unknown>;
}

/** An owner leaves a lead in the advisor (as the chat screen would). */
async function leaveLead(opts: { ref?: string; reason: string; phone?: string }) {
  const chat = await post("/api/advisor/sessions", { lang: "en", ...(opts.ref ? { attributionCode: opts.ref } : {}) });
  const id = chat.sessionId as string;
  await post(`/api/advisor/sessions/${id}/messages`, { lang: "en", text: "I run a bakery in Pune with 4 people" });
  await post(`/api/advisor/sessions/${id}/messages`, { lang: "en", text: "1" });
  return (await post(`/api/advisor/sessions/${id}/lead`, { reason: opts.reason, ...(opts.phone ? { phone: opts.phone, callbackConsent: true } : {}) })).leadId as string;
}

async function signInAs(u: ReturnType<typeof user>, name: string) {
  await u.click(await screen.findByRole("button", { name: new RegExp(`Sign in as ${name}`) }));
  await screen.findByText(new RegExp(`Signed in as ${name}`));
}

describe("partner referral", () => {
  it("a ?ref= link shows who referred the owner and sends the code with the chat", async () => {
    window.history.replaceState({}, "", "/?ref=ptr-01");
    const u = user();
    render(
      <I18nProvider>
        <App fetchFn={backend.fetchFn} />
      </I18nProvider>,
    );
    expect(await screen.findByText("Referred by Shree Mobile Point")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Chat with our advisor" }));
    await waitFor(() => expect(backend.requests.some((r) => r.url === "/api/advisor/sessions" && (r.body as { attributionCode?: string }).attributionCode === "PTR-01")).toBe(true));
  });

  it("an unknown code is ignored, and a removed referral is no longer sent", async () => {
    window.history.replaceState({}, "", "/?ref=PTR-99");
    const first = render(
      <I18nProvider>
        <App fetchFn={backend.fetchFn} />
      </I18nProvider>,
    );
    await waitFor(() => expect(backend.requests.some((r) => r.url === "/api/partners/PTR-99")).toBe(true));
    expect(screen.queryByText(/Referred by/)).not.toBeInTheDocument();
    first.unmount();

    window.history.replaceState({}, "", "/?ref=SLS-02");
    const u = user();
    render(
      <I18nProvider>
        <App fetchFn={backend.fetchFn} />
      </I18nProvider>,
    );
    await screen.findByText("Referred by Vikram Joshi (field sales)");
    await u.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText(/Referred by/)).not.toBeInTheDocument();
    const before = backend.requests.length;
    await u.click(screen.getByRole("button", { name: "Chat with our advisor" }));
    await waitFor(() => expect(backend.requests.slice(before).some((r) => r.url === "/api/advisor/sessions")).toBe(true));
    expect(backend.requests.slice(before).find((r) => r.url === "/api/advisor/sessions")!.body).toEqual({ lang: "en" });
  });
});

describe("back-office", () => {
  it("MOCK sign-in, then the advisor's leads with reason, masked phone, score and next action; filters and follow-up", async () => {
    const referred = await leaveLead({ ref: "PTR-02", reason: "asked_for_human", phone: "9876543210" });
    const direct = await leaveLead({ reason: "price_too_high" });
    const u = user();
    renderBackOffice();
    expect(await screen.findByText(/MOCK sign-in: demo accounts, no password/)).toBeInTheDocument();
    await signInAs(u, "Ananya Rao");

    const table = await screen.findByTestId("leads-table");
    const row = (id: string) => table.querySelector(`[data-lead="${id}"]`) as HTMLElement;
    await waitFor(() => expect(row(referred)).not.toBeNull());
    const top = within(row(referred));
    expect(top.getByText(/Score 90 · High/)).toBeInTheDocument();
    expect(top.getByText("Call within 24 h")).toBeInTheDocument();
    expect(top.getByText("Asked for a person")).toBeInTheDocument();
    expect(top.getByText("Call back: ******3210")).toBeInTheDocument();
    expect(top.getByText("City Computers & Telecom", { selector: "td" })).toBeInTheDocument();
    expect(within(row(direct)).getByText("WhatsApp nudge")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("9876543210");
    // Best score first.
    const order = [...table.querySelectorAll("[data-lead]")].map((r) => r.getAttribute("data-lead"));
    expect(order.indexOf(referred)).toBeLessThan(order.indexOf(direct));

    await u.selectOptions(screen.getByLabelText("Reason", { selector: "select" }), "price_too_high");
    await waitFor(() => expect(table.querySelector(`[data-lead="${referred}"]`)).toBeNull());
    expect(row(direct)).not.toBeNull();
    await u.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(screen.getByTestId("leads-table").querySelector(`[data-lead="${referred}"]`)).not.toBeNull());

    await u.selectOptions(screen.getByLabelText("Follow-up", { selector: `#status-${direct}` }), "contacted");
    expect(await within(row(direct)).findByText("Saved")).toBeInTheDocument();
    expect(backend.leadStore.get(direct)!.followUp).toMatchObject({ status: "contacted", updatedBy: "SLS-01" });
    await u.selectOptions(screen.getByLabelText("Owner", { selector: `#owner-${direct}` }), "SLS-02");
    await waitFor(() => expect(backend.leadStore.get(direct)!.followUp.assignedTo).toBe("SLS-02"));
  });

  it("a partner sees only their referred leads, no past-quarter or KYC tabs, and their referral link", async () => {
    const mine = await leaveLead({ ref: "PTR-01", reason: "decided_to_wait" });
    const other = await leaveLead({ ref: "PTR-02", reason: "decided_to_wait" });
    const u = user();
    renderBackOffice();
    await signInAs(u, "Shree Mobile Point");
    const table = await screen.findByTestId("leads-table");
    await waitFor(() => expect(table.querySelector(`[data-lead="${mine}"]`)).not.toBeNull());
    expect(table.querySelector(`[data-lead="${other}"]`)).toBeNull();
    expect(screen.queryByRole("button", { name: "Past quarter" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "KYC exceptions" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Owner", { selector: `#owner-${mine}` })).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Partners" }));
    expect(await screen.findByTestId("referral-link")).toHaveTextContent("/?ref=PTR-01");
    const rows = screen.getByTestId("partners-table").querySelectorAll("[data-partner]");
    expect([...rows].map((r) => r.getAttribute("data-partner"))).toEqual(["PTR-01"]);
  });

  it("past quarter: 4,632 dropped leads, 25 a page, best score first, filters", async () => {
    const u = user();
    renderBackOffice();
    await signInAs(u, "Operations desk");
    await u.click(screen.getByRole("button", { name: "Past quarter" }));
    const table = await screen.findByTestId("crm-table");
    expect(screen.getByText("Showing 25 of 4632")).toBeInTheDocument();
    expect(within(table).getAllByText(/Score 100 · High/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Page 1 of 186").length).toBeGreaterThan(0);
    await u.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findAllByText("Page 2 of 186")).not.toHaveLength(0);
    await u.selectOptions(screen.getByLabelText("Reason", { selector: "select" }), "Price too high");
    expect(await screen.findByText("Showing 25 of 414")).toBeInTheDocument();
    expect(screen.getAllByText("Page 1 of 17").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/);
  });

  it("KYC exceptions: the operations desk approves a case with a note and the owner can sign; a reject needs a note", async () => {
    const start = async (sampleId: string) => {
      const c = await post("/api/kyc/cases", { consent: { accepted: true, version: CONSENT_VERSION }, lang: "en" });
      const caseId = c.caseId as string;
      await backend.fetchFn(`/api/kyc/cases/${caseId}/business`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ sampleId }) });
      for (const d of samples.get(sampleId)!.documents) {
        await backend.fetchFn(`/api/kyc/cases/${caseId}/documents/${d}`, { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array(sampleImage(sampleId, d)) });
      }
      await post(`/api/kyc/cases/${caseId}/submit`, {});
      return caseId;
    };
    const k07 = await start("K07");
    const k10 = await start("K10");
    const u = user();
    renderBackOffice();
    await signInAs(u, "Operations desk");
    await u.click(screen.getByRole("button", { name: "KYC exceptions" }));
    const card = async (id: string) => (await screen.findByText(new RegExp(id))).closest("article") as HTMLElement;

    const c10 = within(await card(k10));
    await u.click(c10.getByRole("button", { name: "Reject" }));
    expect(c10.getByRole("alert")).toHaveTextContent("Write a note to reject.");

    const c07 = within(await card(k07));
    expect(c07.getByText("Needs review")).toBeInTheDocument();
    expect(c07.getByText(/Registry \(MOCK\)/)).toBeInTheDocument();
    await u.type(c07.getByLabelText("Note to the owner"), "Checked the shop sign: same business");
    await u.click(c07.getByRole("button", { name: "Approve" }));
    await waitFor(async () => expect(within(await card(k07)).getByText(/Approved on/)).toBeInTheDocument());

    const owner = (await (await backend.fetchFn(`/api/kyc/cases/${k07}`)).json()) as { result: { status: string; review: { note: string } } };
    expect(owner.result).toMatchObject({ status: "pass", review: { note: "Checked the shop sign: same business" } });
    expect(document.body.textContent).not.toMatch(/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/);
  });

  it("the owner sees a rejection and the reviewer's note (English and Hindi)", async () => {
    const c = await post("/api/kyc/cases", { consent: { accepted: true, version: CONSENT_VERSION }, lang: "en" });
    const caseId = c.caseId as string;
    await backend.fetchFn(`/api/kyc/cases/${caseId}/business`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ sampleId: "K10" }) });
    for (const d of samples.get("K10")!.documents) {
      await backend.fetchFn(`/api/kyc/cases/${caseId}/documents/${d}`, { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array(sampleImage("K10", d)) });
    }
    await post(`/api/kyc/cases/${caseId}/submit`, {});
    const { token } = (await post("/api/backoffice/session", { staffCode: "ADM-01" })) as { token: string };
    const res = await backend.fetchFn(`/api/backoffice/kyc/${caseId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ decision: "rejected", note: "Please upload a letter that lets Nisha Arora sign for the business." }),
    });
    expect(res.status).toBe(200);
    const kyc = (await (await backend.fetchFn(`/api/kyc/cases/${caseId}`)).json()) as KycCase;
    const view = render(
      <I18nProvider>
        <KycResult kyc={kyc} />
      </I18nProvider>,
    );
    expect(screen.getByRole("heading", { name: "Not approved" })).toBeInTheDocument();
    expect(screen.getByText("Note from our team: Please upload a letter that lets Nisha Arora sign for the business.")).toBeInTheDocument();
    view.unmount();
    render(
      <I18nProvider initialLang="hi">
        <KycResult kyc={kyc} />
      </I18nProvider>,
    );
    expect(screen.getByRole("heading", { name: hi["kyc.result.rejected"] })).toBeInTheDocument();
  });

  it("the sales role has no KYC tab, and the back-office works in Hindi", async () => {
    const u = user();
    renderBackOffice("hi");
    await u.click(await screen.findByRole("button", { name: /Ananya Rao/ }));
    expect(await screen.findByRole("button", { name: hi["bo.tab.leads"] })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: hi["bo.tab.crm"] })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: hi["bo.tab.kyc"] })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: hi["bo.signOut"] })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: hi["bo.signOut"] }));
    expect(await screen.findByRole("heading", { name: hi["bo.signIn.title"] })).toBeInTheDocument();
  });
});
