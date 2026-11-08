import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QuoteView } from "./components/QuoteView";
import type { QuoteRequest } from "./api/quote";
import { hi } from "./i18n/hi";
import { I18nProvider, type Lang } from "./i18n/I18nProvider";
import { startBackend, type LiveBackend } from "./test/liveBackend";

/** Time to value on the quote screen (add-on A3), against the real quote engine. */

let backend: LiveBackend;
beforeAll(async () => {
  backend = await startBackend();
});
afterAll(async () => {
  await backend.close();
});

const OFFICE: QuoteRequest = { segment: "prof", variant: "standard", profile: { cityTier: 1, employees: 5, sites: 1, gstin: "active" }, exclude: [], include: [] };
const MICRO: QuoteRequest = { segment: "micro", variant: "standard", profile: { cityTier: 1, employees: 3, sites: 1, gstin: "none" }, exclude: [], include: [] };
const FACTORY: QuoteRequest = { segment: "mfg", variant: "standard", profile: { cityTier: 2, employees: 12, sites: 1, gstin: "active" }, exclude: [], include: [] };

function show(request: QuoteRequest, lang: Lang = "en") {
  return render(
    <I18nProvider initialLang={lang}>
      <QuoteView initialRequest={request} onAccepted={() => undefined} fetchFn={backend.fetchFn} />
    </I18nProvider>,
  );
}

describe("quote: five elements and the value timeline", () => {
  it("Office Pro: name, monthly price, setup, 12-month contract, ready in approximately 5 days (by 20 July 2026), Day 1 services", async () => {
    show(OFFICE);
    const card = await screen.findByTestId("quote-card");
    expect(screen.getByRole("heading", { name: "Office Pro" })).toBeInTheDocument();
    expect(card).toHaveTextContent("₹4,215 per month");
    expect(card).toHaveTextContent("₹1,500 one-time setup");
    expect(card).toHaveTextContent("12-month contract");
    expect(screen.getByTestId("ready-estimate")).toHaveTextContent("Expected ready in approximately 5 days (by 20 July 2026)");
    const tl = screen.getByTestId("value-timeline");
    expect(within(tl).getByText("What you can start using, and when")).toBeInTheDocument();
    expect(screen.getByTestId("day-one-banner")).toHaveTextContent("Start using 4 services from tomorrow while your internet is being installed.");
    expect(tl).toHaveTextContent("Day 1 (16 July 2026)");
    expect(tl).toHaveTextContent("Business Postpaid 299, Cloud Email & Office Suite, Cloud Backup 1 TB, Endpoint Security");
    expect(tl).toHaveTextContent("Day 5 (20 July 2026)");
    expect(tl).toHaveTextContent("Backup 4G/5G Failover (with Biz Fibre 300)");
    expect(screen.getByTestId("ready")).toHaveTextContent("about 5 days");
  });

  it("Micro starter: 12 months because of Secure Wi-Fi; one tap gives a 6-month contract, and price and dates update", async () => {
    const u = userEvent.setup();
    show(MICRO);
    expect(await screen.findByTestId("contract-driver")).toHaveTextContent("The contract is 12 months because of: Secure Wi-Fi with Guest Network.");
    const before = screen.getByTestId("monthly-total").textContent;
    await u.click(screen.getByRole("button", { name: "Remove Secure Wi-Fi with Guest Network for a 6-month contract" }));
    await waitFor(() => expect(screen.getByTestId("quote-card")).toHaveTextContent("6-month contract"));
    expect(screen.getByTestId("monthly-total").textContent).not.toBe(before);
    expect(screen.getByTestId("ready-estimate")).toHaveTextContent("approximately 2 days (by 17 July 2026)");
  });

  it("Factory Connect: a service window with a site survey and partner assistance, instead of a single date", async () => {
    show(FACTORY);
    expect(await screen.findByTestId("ready-estimate")).toHaveTextContent("Expected ready in approximately 21-30 days, site survey required");
    expect(screen.getByTestId("quote-card")).toHaveTextContent("24-month contract");
    expect(screen.getByTestId("quote-card")).toHaveTextContent("Partner assistance recommended");
    expect(screen.getByTestId("ready")).toHaveTextContent("approx. 21-30 days");
  });

  it("in Hindi", async () => {
    show(OFFICE, "hi");
    expect(await screen.findByText(hi["ttv.title"])).toBeInTheDocument();
    expect(screen.getByTestId("ready-estimate")).toHaveTextContent("लगभग 5 दिन में तैयार होने की उम्मीद (20 जुलाई 2026 तक)");
    expect(screen.getByTestId("day-one-banner")).toHaveTextContent("कल से 4 सेवाएँ");
  });
});
