import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { recordedReader, sampleImage, samples } from "../../backend/tests/kyc/helpers";
import { CONSENT_PURPOSES, CONSENT_VERSION } from "./api/kyc";
import { App } from "./App";
import { BackOffice } from "./components/backoffice/BackOffice";
import { hi } from "./i18n/hi";
import { I18nProvider, type Lang } from "./i18n/I18nProvider";
import { startBackend, type LiveBackend } from "./test/liveBackend";

/**
 * Add-on features on the screens, against the real backend: blockers and a stopped order on the
 * tracker, readiness and stored photos in the back-office, the one-sitting metrics and the
 * retention job.
 */

let backend: LiveBackend;
beforeAll(async () => {
  backend = await startBackend({ documentReader: recordedReader() });
  // jsdom has no object URLs; the photo preview only needs one.
  URL.createObjectURL = vi.fn(() => "blob:photo");
  URL.revokeObjectURL = vi.fn();
});
afterAll(async () => {
  await backend.close();
});

const user = () => userEvent.setup();
const OFFICE = { segment: "prof", variant: "standard", profile: { cityTier: 1, employees: 5, sites: 1, gstin: "active" }, exclude: [], include: [] as string[] };

async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await backend.fetchFn(url, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return (await res.json()) as Record<string, any>;
}

/** Quote -> consent -> sample applicant with all documents -> check. */
async function application(sampleId: string, quoteBody: Record<string, unknown> = OFFICE) {
  const { quoteId } = await call("POST", "/api/quotes", quoteBody);
  const { caseId } = await call("POST", "/api/kyc/cases", { consent: { accepted: true, version: CONSENT_VERSION, purposes: [...CONSENT_PURPOSES] }, lang: "en", quoteId });
  await call("PUT", `/api/kyc/cases/${caseId}/business`, { sampleId });
  for (const d of samples.get(sampleId)!.documents) {
    await backend.fetchFn(`/api/kyc/cases/${caseId}/documents/${d}`, { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array(sampleImage(sampleId, d)) });
  }
  await call("POST", `/api/kyc/cases/${caseId}/submit`, {});
  return caseId as string;
}

async function signAndPay(caseId: string): Promise<string> {
  const { otp } = await call("POST", `/api/kyc/cases/${caseId}/esign/start`, {});
  await call("POST", `/api/kyc/cases/${caseId}/esign/verify`, { otp });
  return (await call("POST", "/api/orders", { caseId, method: "upi" })).orderId as string;
}

async function trackOrder(orderId: string, lang: Lang = "en") {
  const u = user();
  render(
    <I18nProvider initialLang={lang}>
      <App fetchFn={backend.fetchFn} />
    </I18nProvider>,
  );
  await u.type(screen.getByLabelText(lang === "hi" ? hi["home.trackLabel"] : "Order reference"), orderId);
  await u.click(screen.getAllByRole("button", { name: lang === "hi" ? hi["home.track"] : "Track my order" }).at(-1)!);
  return u;
}

describe("tracker: the same blockers, and a stopped order", () => {
  it("a 4-site business: the tracker shows the open partner-assistance item", async () => {
    const caseId = await application("K03", { segment: "multi", variant: "standard", profile: { cityTier: 1, employees: 30, sites: 4, gstin: "active" }, exclude: [], include: [] });
    const orderId = await signAndPay(caseId);
    await trackOrder(orderId);
    const open = await screen.findByRole("region", { name: "Still open on your application" });
    expect(open).toHaveTextContent(/Partner assistance recommended: SD-WAN across sites, 4 locations, more than ₹10,000 a month, an installation window of 14 days./);
    expect(open).toHaveTextContent("Ananya Rao (field sales) will contact you");
  });

  it("consent withdrawn before activation: the order is stopped and cannot move on (Hindi too)", async () => {
    const caseId = await application("K03");
    const orderId = await signAndPay(caseId);
    await call("DELETE", `/api/kyc/cases/${caseId}`);
    await trackOrder(orderId);
    expect(await screen.findByTestId("order-stopped")).toHaveTextContent("This order was stopped on 15 July 2026: consent was withdrawn before activation.");
    expect(screen.queryByRole("button", { name: /MOCK: move to the next stage/ })).not.toBeInTheDocument();
  });
});

describe("back-office: readiness, stored photos, metrics, retention", () => {
  it("the KYC queue shows the readiness and blockers with the owner's answer; the operations desk can view a stored photo", async () => {
    const caseId = await application("K07");
    const { readiness } = await call("GET", `/api/kyc/cases/${caseId}`);
    const blocker = readiness.blockers.find((b: { question?: unknown }) => b.question);
    await call("POST", `/api/kyc/cases/${caseId}/answers`, { blockerId: blocker.id, answer: "Old certificate, name changed" });
    const u = user();
    render(
      <I18nProvider>
        <BackOffice fetchFn={backend.fetchFn} />
      </I18nProvider>,
    );
    await u.click(await screen.findByRole("button", { name: /Sign in as Operations desk/ }));
    await u.click(await screen.findByRole("button", { name: "KYC exceptions" }));
    const box = await screen.findByTestId(`bo-readiness-${caseId}`);
    expect(box).toHaveTextContent("One-Sitting Completion: Needs a check by our team · 80%");
    expect(box).toHaveTextContent("the legal name");
    const article = box.closest("article")!;
    fireEvent.click(within(article).getByText(/Stored document photos \(4, encrypted\)/));
    await u.click(within(article).getByRole("button", { name: "View photo: GST registration certificate" }));
    expect(await within(article).findByRole("img", { name: "GST registration certificate" })).toHaveAttribute("src", "blob:photo");
    expect(backend.requests.some((r) => r.url === `/api/backoffice/kyc/${caseId}/documents/gst_certificate`)).toBe(true);
  });

  it("metrics for sales; the operations desk runs the retention job as of a later date (DEMO)", async () => {
    await application("K09");
    const u = user();
    render(
      <I18nProvider>
        <BackOffice fetchFn={backend.fetchFn} />
      </I18nProvider>,
    );
    await u.click(await screen.findByRole("button", { name: /Sign in as Operations desk/ }));
    await u.click(await screen.findByRole("button", { name: "One sitting" }));
    const tiles = await screen.findByTestId("metrics");
    expect(within(tiles).getByText("Journeys completed in one sitting")).toBeInTheDocument();
    expect(within(tiles).getByText("Alternatives accepted")).toBeInTheDocument();
    const date = screen.getByLabelText(/Run as of/);
    fireEvent.change(date, { target: { value: "2026-08-14" } });
    await u.click(screen.getByRole("button", { name: "Run the retention job" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Deleted \d+ photo\(s\) in \d+ application\(s\) as of 2026-08-14\./));
    expect(Number(/Deleted (\d+)/.exec(screen.getByRole("status").textContent!)![1])).toBeGreaterThan(0);
  });
});
