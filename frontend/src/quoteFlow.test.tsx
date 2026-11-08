import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { App } from "./App";
import { QuoteView } from "./components/QuoteView";
import { hi } from "./i18n/hi";
import { I18nProvider } from "./i18n/I18nProvider";
import { startBackend, type LiveBackend } from "./test/liveBackend";

let backend: LiveBackend;
beforeAll(async () => {
  backend = await startBackend();
});
afterAll(async () => {
  await backend.close();
});

const user = () => userEvent.setup();

function renderApp() {
  return render(
    <I18nProvider>
      <App fetchFn={backend.fetchFn} />
    </I18nProvider>,
  );
}

/** Home -> form -> fill -> submit. */
async function getQuote(
  u: ReturnType<typeof user>,
  opts: { segment: RegExp; city: string; employees: string; sites?: string; gstin: RegExp },
) {
  await u.click(screen.getByRole("button", { name: "Get my price" }));
  await u.click(screen.getByRole("radio", { name: opts.segment }));
  const city = await screen.findByRole("combobox", { name: "City" });
  await u.selectOptions(city, opts.city);
  await u.type(screen.getByLabelText(/How many people work there/), opts.employees);
  if (opts.sites) {
    const sites = screen.getByLabelText(/How many locations/);
    await u.clear(sites);
    await u.type(sites, opts.sites);
  }
  await u.click(screen.getByRole("radio", { name: opts.gstin }));
  await u.click(screen.getByRole("button", { name: "Show my bundle" }));
  await screen.findByTestId("monthly-total");
}

const total = () => screen.getByTestId("monthly-total").textContent;
const toggle = (name: string) => screen.getByRole("switch", { name });
const itemOf = (name: string) => toggle(name).closest("li") as HTMLElement;

describe("business form", () => {
  it("shows what is missing instead of submitting", async () => {
    const u = user();
    renderApp();
    await u.click(screen.getByRole("button", { name: "Get my price" }));
    await screen.findByRole("combobox", { name: "City" });
    await u.click(screen.getByRole("button", { name: "Show my bundle" }));
    expect(screen.getAllByText("Please choose an option.")).toHaveLength(3); // type, city, GSTIN
    expect(screen.getByText("Enter a whole number from 1 to 100000.")).toBeInTheDocument();
    expect(screen.queryByTestId("monthly-total")).not.toBeInTheDocument();
  });

  it("lists the 22 cities from the data plus 'not in the list'", async () => {
    const u = user();
    renderApp();
    await u.click(screen.getByRole("button", { name: "Get my price" }));
    const city = await screen.findByRole("combobox", { name: "City" });
    expect(within(city).getAllByRole("option")).toHaveLength(1 + 22 + 1);
    expect(within(city).getByRole("option", { name: "Kochi, Kerala" })).toBeInTheDocument();
  });
});

describe("quote for a clinic (Office Pro)", () => {
  it("shows one monthly price with setup, contract and ready time separately", async () => {
    const u = user();
    renderApp();
    await getQuote(u, { segment: /Office or clinic/, city: "Kochi", employees: "5", gstin: /No GSTIN/ });
    expect(screen.getByRole("heading", { name: "Office Pro" })).toBeInTheDocument();
    expect(total()).toBe("₹4,215/month");
    expect(screen.getByTestId("setup-total")).toHaveTextContent("₹1,500");
    expect(screen.getByTestId("contract")).toHaveTextContent("12 months");
    expect(screen.getByTestId("ready")).toHaveTextContent("about 5 days");
    // plain names and descriptions, never bare product codes
    expect(screen.getByText("Biz Fibre 300")).toBeInTheDocument();
    expect(screen.queryByText(/\bP\d{2}\b/)).not.toBeInTheDocument();
    // the request carried the profile from the form (Kochi is tier 2)
    const sent = backend.requests.filter((r) => r.url === "/api/quote").at(-1)!.body;
    expect(sent).toEqual({
      segment: "prof",
      variant: "standard",
      profile: { cityTier: 2, employees: 5, sites: 1, gstin: "none" },
      exclude: [],
      include: [],
    });
  });

  it("blocks removing fibre while the failover needs it, and explains why", async () => {
    const u = user();
    renderApp();
    await getQuote(u, { segment: /Office or clinic/, city: "Kochi", employees: "5", gstin: /No GSTIN/ });
    expect(toggle("Biz Fibre 300")).toBeDisabled();
    expect(within(itemOf("Biz Fibre 300")).getByText("Can't remove: needed by Backup 4G/5G Failover.")).toBeInTheDocument();

    // remove the failover first; then fibre can be removed and the price drops each time
    await u.click(toggle("Backup 4G/5G Failover"));
    await waitFor(() => expect(total()).toBe("₹3,716/month"));
    expect(toggle("Backup 4G/5G Failover")).not.toBeChecked();
    expect(toggle("Biz Fibre 300")).toBeEnabled();
  });

  it("toggles an add-on and re-prices; an ineligible add-on is greyed out with the reason", async () => {
    const u = user();
    renderApp();
    await getQuote(u, { segment: /Office or clinic/, city: "Kochi", employees: "5", gstin: /No GSTIN/ });
    // Cloud telephony needs a GSTIN
    expect(toggle("Cloud Telephony / SIP")).toBeDisabled();
    expect(within(itemOf("Cloud Telephony / SIP")).getByText("Needs an active GSTIN.")).toBeInTheDocument();
    // Static IP is allowed
    await u.click(toggle("Static IP"));
    await waitFor(() => expect(total()).toBe("₹4,415/month"));
    expect(toggle("Static IP")).toBeChecked();
    await u.click(toggle("Static IP"));
    await waitFor(() => expect(total()).toBe("₹4,215/month"));
  });

  it("accepts the quote and shows the reference and validity", async () => {
    const u = user();
    renderApp();
    await getQuote(u, { segment: /Office or clinic/, city: "Kochi", employees: "5", gstin: /No GSTIN/ });
    await u.click(toggle("Static IP"));
    await waitFor(() => expect(total()).toBe("₹4,415/month"));
    await u.click(screen.getByRole("button", { name: "Accept this quote" }));
    expect(await screen.findByRole("heading", { name: "Quote accepted" })).toBeInTheDocument();
    expect(screen.getByTestId("quote-reference").textContent).toMatch(/^Q-[0-9A-F]{8}$/);
    expect(screen.getByText("Valid until 22 July 2026")).toBeInTheDocument();
    expect(screen.getByText("₹4,415")).toBeInTheDocument();
  });

  it("'Back' returns to the form with the answers kept", async () => {
    const u = user();
    renderApp();
    await getQuote(u, { segment: /Office or clinic/, city: "Kochi", employees: "5", gstin: /No GSTIN/ });
    await u.click(screen.getByRole("button", { name: /Back/ }));
    expect(await screen.findByRole("combobox", { name: "City" })).toHaveValue("Kochi");
    expect(screen.getByLabelText(/How many people work there/)).toHaveValue(5);
    expect(screen.getByRole("radio", { name: /Office or clinic/ })).toBeChecked();
  });
});

describe("quote for a shop (micro)", () => {
  it("offers the 6-month Lite plan and the WhatsApp add-on only with a GSTIN", async () => {
    const u = user();
    renderApp();
    await getQuote(u, { segment: /Shop or small service/, city: "Jaipur", employees: "3", gstin: /No GSTIN/ });
    expect(total()).toBe("₹1,597/month");
    expect(toggle("WhatsApp Business API Starter")).toBeDisabled();
    await u.click(screen.getByRole("radio", { name: "6-month Lite plan" }));
    await waitFor(() => expect(total()).toBe("₹1,198/month"));
    expect(screen.getByTestId("contract")).toHaveTextContent("6 months");
    expect(screen.getByTestId("setup-total")).toHaveTextContent("₹0");
  });
});

describe("tier and size rules reach the screen", () => {
  it("a 2-site chain without GSTIN lists SD-WAN and toll-free as not available, with reasons", async () => {
    const u = user();
    renderApp();
    await getQuote(u, { segment: /Several branches/, city: "Mumbai", employees: "15", sites: "2", gstin: /No GSTIN/ });
    const unavailable = screen.getByRole("heading", { name: "Not available for your business" }).closest("section")!;
    expect(within(unavailable).getByText("Managed SD-WAN")).toBeInTheDocument();
    expect(within(unavailable).getByText("Needs at least 3 locations. Needs an active GSTIN.")).toBeInTheDocument();
    expect(within(unavailable).getByText("Toll-free Number")).toBeInTheDocument();
  });
});

describe("Hindi", () => {
  it("the quote screen, product descriptions and reasons switch to Hindi", async () => {
    const u = user();
    renderApp();
    await getQuote(u, { segment: /Office or clinic/, city: "Kochi", employees: "5", gstin: /No GSTIN/ });
    await u.click(screen.getByRole("button", { name: "हिंदी" }));
    expect(screen.getByText(hi["quote.included"])).toBeInTheDocument();
    expect(screen.getByText("बिज़नेस फ़ाइबर ब्रॉडबैंड, 300 Mbps, अनलिमिटेड डेटा, स्टैटिक IP का विकल्प")).toBeInTheDocument();
    expect(within(itemOf("Biz Fibre 300")).getByText("हटा नहीं सकते: Backup 4G/5G Failover को इसकी ज़रूरत है।")).toBeInTheDocument();
    expect(within(itemOf("Cloud Telephony / SIP")).getByText("इसके लिए सक्रिय GSTIN ज़रूरी है।")).toBeInTheDocument();
    expect(screen.getByTestId("contract")).toHaveTextContent("12 महीने");
    expect(total()).toBe("₹4,215/महीना");
    expect(screen.getByRole("button", { name: hi["quote.accept"] })).toBeInTheDocument();
  });
});

describe("errors", () => {
  it("shows a retry when the quote cannot be loaded, and recovers", async () => {
    const u = user();
    backend.failNext("/api/quote");
    render(
      <I18nProvider>
        <QuoteView
          initialRequest={{ segment: "micro", variant: "standard", profile: { cityTier: 2, employees: 3, sites: 1, gstin: "none" }, exclude: [], include: [] }}
          onAccepted={() => undefined}
          fetchFn={backend.fetchFn}
        />
      </I18nProvider>,
    );
    expect(await screen.findByText("Could not load your quote. Please try again.")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(total()).toBe("₹1,597/month"));
  });

  it("explains a refused selection from the server (rule broken)", async () => {
    render(
      <I18nProvider>
        <QuoteView
          initialRequest={{ segment: "micro", variant: "standard", profile: { cityTier: 2, employees: 3, sites: 1, gstin: "none" }, exclude: [], include: ["P15"] }}
          onAccepted={() => undefined}
          fetchFn={backend.fetchFn}
        />
      </I18nProvider>,
    );
    expect(await screen.findByText("That change is not possible:")).toBeInTheDocument();
    expect(await screen.findByText("WhatsApp Business API Starter: Needs an active GSTIN.")).toBeInTheDocument();
  });
});
