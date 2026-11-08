import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { honestLlm } from "../../backend/tests/advisor/helpers";
import { App } from "./App";
import { hi } from "./i18n/hi";
import { I18nProvider } from "./i18n/I18nProvider";
import { startBackend, type LiveBackend } from "./test/liveBackend";

/** The advisor screen against the real backend (rules engine, prices, chat API). */

let backend: LiveBackend;
let aiBackend: LiveBackend;
beforeAll(async () => {
  backend = await startBackend();
  aiBackend = await startBackend({ advisorLlm: honestLlm() });
});
afterAll(async () => {
  await backend.close();
  await aiBackend.close();
});

const user = () => userEvent.setup();

function renderApp(b: LiveBackend = backend) {
  return render(
    <I18nProvider>
      <App fetchFn={b.fetchFn} />
    </I18nProvider>,
  );
}

const log = () => screen.getByRole("list", { name: /Advisor|सलाहकार/ });
const lastAdvisorText = () => within(log()).getAllByRole("listitem").at(-1)!.textContent ?? "";

async function openChat(u: ReturnType<typeof user>) {
  await u.click(screen.getByRole("button", { name: "Chat with our advisor" }));
  await screen.findByText(/What kind of business do you run\?/);
}

async function type(u: ReturnType<typeof user>, text: string) {
  const input = screen.getByRole("textbox", { name: /Type your answer|अपना जवाब/ });
  await u.type(input, text);
  await u.click(screen.getByRole("button", { name: /^(Send|भेजें)$/ }));
  await waitFor(() => expect(screen.queryByText(/Advisor is typing|सलाहकार लिख रहा है/)).not.toBeInTheDocument());
}

/** Dental clinic in Kochi, typed and tapped, to a recommendation. */
async function clinicChat(u: ReturnType<typeof user>) {
  await openChat(u);
  await type(u, "I run a dental clinic in Kochi with 5 people");
  await u.click(await screen.findByRole("button", { name: "1" }));
  await u.click(await screen.findByRole("button", { name: "No GSTIN" }));
  await u.click(await screen.findByRole("button", { name: "Mobile hotspot" }));
  await u.click(await screen.findByRole("button", { name: "Business email" }));
  await u.click(screen.getByRole("button", { name: "Done" }));
  return screen.findByTestId("recommendation");
}

describe("advisor chat (no AI key: basic mode)", () => {
  it("opens from the home screen with a greeting, the mode and the first question", async () => {
    const u = user();
    renderApp();
    await openChat(u);
    expect(screen.getByTestId("advisor-mode")).toHaveTextContent("Basic mode (no AI)");
    expect(screen.getByText(/Namaste! I'm the Accel Business advisor/)).toBeInTheDocument();
    for (const name of ["Shop or small service", "Office or clinic", "Several branches", "Factory or workshop"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("recommends a bundle with one monthly price and why each product is there, then opens the same quote", async () => {
    const u = user();
    renderApp();
    const card = await clinicChat(u);
    expect(within(card).getByRole("heading", { name: "Office Pro" })).toBeInTheDocument();
    expect(within(card).getByTestId("rec-monthly")).toHaveTextContent("₹4,215/month");
    expect(within(card).getByText("Biz Fibre 300")).toBeInTheDocument();
    expect(within(card).getByText(/It replaces the mobile hotspot you use today/)).toBeInTheDocument();
    expect(within(card).queryByText(/\bP\d{2}\b/)).not.toBeInTheDocument();

    // the tools multi-select sent one array
    const toolsMsg = backend.requests.filter((r) => r.url.endsWith("/messages")).at(-1)!.body;
    expect(toolsMsg).toEqual({ lang: "en", choice: { slot: "tools", value: ["email"] } });

    await u.click(within(card).getByRole("button", { name: "See my quote" }));
    await waitFor(() => expect(screen.getByTestId("monthly-total")).toHaveTextContent("₹4,215/month"));
    expect(screen.getByRole("heading", { name: "Office Pro" })).toBeInTheDocument();

    // Back returns to the same chat
    await u.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByTestId("recommendation")).toBeInTheDocument();
    expect(screen.getByText("I run a dental clinic in Kochi with 5 people")).toBeInTheDocument();
  });

  it("asks the city with a drop-down of our cities", async () => {
    const u = user();
    renderApp();
    await openChat(u);
    await type(u, "kirana store, 3 people, 1 shop");
    const select = await screen.findByRole("combobox", { name: "City" });
    expect(within(select).getAllByRole("option")).toHaveLength(1 + 22 + 1);
    await u.selectOptions(select, "Jaipur");
    await u.click(screen.getByRole("button", { name: "Use this city" }));
    expect(await screen.findByText("Noted: Jaipur.")).toBeInTheDocument();
    expect(await screen.findByText("Do you have a GSTIN?")).toBeInTheDocument();
  });

  it("answers a question about a product it cannot sell with the reason, using product names", async () => {
    const u = user();
    renderApp();
    await clinicChat(u);
    await type(u, "can I get cloud telephony?");
    const card = await screen.findByTestId("product-P12");
    expect(card).toHaveTextContent("Not available for your business");
    expect(card).toHaveTextContent("Needs an active GSTIN.");
    expect(card).toHaveTextContent("from ₹1,000/month per channel");
  });

  it("works in Hindi", async () => {
    const u = user();
    renderApp();
    await u.click(screen.getByRole("button", { name: "हिंदी" }));
    await u.click(screen.getByRole("button", { name: hi["home.chat"] }));
    await screen.findByText(/आपका व्यवसाय किस तरह का है\?/);
    expect(screen.getByTestId("advisor-mode")).toHaveTextContent(hi["advisor.mode.basic"]);
    await type(u, "जयपुर में किराना दुकान है, 3 लोग");
    expect(await screen.findByText("नोट किया: किराना दुकान, 3 लोग, जयपुर।")).toBeInTheDocument();
    await type(u, "एक");
    await type(u, "नहीं");
    await type(u, "मोबाइल हॉटस्पॉट");
    await u.click(await screen.findByRole("button", { name: "इनमें से कुछ नहीं" }));
    const card = await screen.findByTestId("recommendation");
    expect(within(card).getByText(hi["advisor.rec.title"])).toBeInTheDocument();
    expect(within(card).getByTestId("rec-monthly")).toHaveTextContent("₹2,395/महीना");
    expect(within(card).getByRole("button", { name: hi["advisor.rec.seeQuote"] })).toBeInTheDocument();
  });
});

describe("leads the advisor could not close", () => {
  it("'Talk to a person' checks the number and consent, then saves a call-back lead", async () => {
    const u = user();
    renderApp();
    await openChat(u);
    await type(u, "bakery in Pune");
    await u.click(screen.getByRole("button", { name: "Talk to a person" }));
    const form = screen.getByRole("form", { name: "Get a call back" });
    await u.type(within(form).getByLabelText("Mobile number"), "12345");
    await u.click(within(form).getByRole("button", { name: "Request a call back" }));
    expect(within(form).getByText("Enter a 10-digit mobile number.")).toBeInTheDocument();
    expect(within(form).getByText("Please tick this box so we may call you.")).toBeInTheDocument();

    await u.clear(within(form).getByLabelText("Mobile number"));
    await u.type(within(form).getByLabelText("Mobile number"), "98765 43210");
    await u.click(within(form).getByRole("checkbox"));
    await u.click(within(form).getByRole("button", { name: "Request a call back" }));
    const saved = await screen.findByTestId("lead-saved");
    expect(saved.textContent).toMatch(/^Thank you! A person from our team will call you\. Reference: AL-[0-9A-F]{8}$/);

    const lead = backend.leadStore.list().at(-1)!;
    expect(lead).toMatchObject({ reason: "asked_for_human", phone: "9876543210", callbackConsent: true, business: expect.objectContaining({ city: "Pune" }) });
  });

  it("asking for a person in the chat opens the same form", async () => {
    const u = user();
    renderApp();
    await openChat(u);
    await type(u, "I want to talk to a real person");
    expect(screen.getByRole("form", { name: "Get a call back" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Back to the chat" }));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("'Not for me' asks why and saves the reason without a phone number", async () => {
    const u = user();
    renderApp();
    const card = await clinicChat(u);
    await u.click(within(card).getByRole("button", { name: "Not for me" }));
    const form = screen.getByRole("form", { name: "What made you decide not to go ahead?" });
    await u.click(within(form).getByRole("button", { name: "Send" }));
    expect(within(form).getByText("Please choose a reason.")).toBeInTheDocument();
    await u.click(within(form).getByRole("radio", { name: "The price is too high" }));
    await u.click(within(form).getByRole("button", { name: "Send" }));
    expect(await screen.findByTestId("lead-saved")).toHaveTextContent(/Thank you for telling us\. Reference: AL-/);
    expect(backend.leadStore.list().at(-1)).toMatchObject({
      reason: "price_too_high",
      phone: null,
      recommendation: expect.objectContaining({ name: "Office Pro", monthlyInr: 4215 }),
    });
  });
});

describe("with the AI helper on", () => {
  it("shows that the AI is on and marks the sentences it wrote", async () => {
    const u = user();
    renderApp(aiBackend);
    await openChat(u);
    expect(screen.getByTestId("advisor-mode")).toHaveTextContent("AI helper on");
    await type(u, "I run a dental clinic in Kochi with 5 people");
    const aiBubble = within(log())
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes("Thanks, got it."))!;
    expect(within(aiBubble).getByTitle(/Written by the AI helper \(Gemini\)/)).toHaveTextContent("AI");
    expect(lastAdvisorText()).toContain("How many locations do you have");
  });
});

describe("errors", () => {
  it("offers a retry when the chat cannot start, and recovers", async () => {
    const u = user();
    backend.failNext("/api/advisor/sessions");
    renderApp();
    await u.click(screen.getByRole("button", { name: "Chat with our advisor" }));
    expect(await screen.findByText("Could not start the chat. Please try again.")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/What kind of business do you run\?/)).toBeInTheDocument();
  });

  it("offers a retry when a message cannot be sent, and resends it", async () => {
    const u = user();
    renderApp();
    await openChat(u);
    backend.failNext("/api/advisor/sessions/S-");
    await type(u, "bakery in Pune");
    expect(await screen.findByText("Could not send your message. Please try again.")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Noted: Bakery, Pune.")).toBeInTheDocument();
  });
});
