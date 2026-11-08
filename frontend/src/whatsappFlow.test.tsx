import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { recordedReader } from "../../backend/tests/kyc/helpers";
import { App } from "./App";
import { formatWa } from "./components/whatsapp/WhatsAppSim";
import { I18nProvider } from "./i18n/I18nProvider";
import { startBackend, type LiveBackend } from "./test/liveBackend";

/**
 * WhatsApp simulator and voice input against the real backend (the bot runs the real advisor,
 * quote, KYC checks, MOCK e-sign, MOCK payment and tracker). Only the OCR is the recorded reading
 * of the sample images, and the browser's speech engine is a stand-in (jsdom has none).
 */

let backend: LiveBackend;
beforeAll(async () => {
  backend = await startBackend({ documentReader: recordedReader() });
});
afterAll(async () => {
  await backend.close();
});

/** Stand-in for the browser's SpeechRecognition: "hears" the next phrase, or fails with an error. */
const heard: { next: string | null; error?: string; langs: string[] } = { next: null, langs: [] };
class FakeRecognition {
  lang = "";
  interimResults = false;
  maxAlternatives = 1;
  continuous = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start() {
    heard.langs.push(this.lang);
    setTimeout(() => {
      if (heard.error) this.onerror?.({ error: heard.error });
      else if (heard.next) this.onresult?.({ results: [[{ transcript: heard.next }]] });
      this.onend?.();
    }, 0);
  }
  stop() {}
  abort() {}
}
const withVoice = () => {
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
};
afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  heard.next = null;
  heard.error = undefined;
  heard.langs = [];
});

const user = () => userEvent.setup();

function renderApp() {
  return render(
    <I18nProvider>
      <App fetchFn={backend.fetchFn} />
    </I18nProvider>,
  );
}

async function openChat(u: ReturnType<typeof user>, number?: string) {
  await u.click(screen.getByRole("button", { name: "Try it on WhatsApp" }));
  expect(screen.getByText(/MOCK WhatsApp Business API: this screen plays your WhatsApp/)).toBeInTheDocument();
  if (number) await u.type(screen.getByLabelText("Your WhatsApp number"), number);
  else await u.click(screen.getByRole("button", { name: "Use a demo number" }));
  await u.click(screen.getByRole("button", { name: "Open the chat" }));
  return screen.getByRole("log");
}

const botMessages = (log: HTMLElement) => [...log.querySelectorAll<HTMLElement>('[data-from="bot"]')];
const lastBot = (log: HTMLElement) => botMessages(log).at(-1)!;

/** Tap a button on the latest bot message (opening its list first if needed). */
async function tapLatest(u: ReturnType<typeof user>, log: HTMLElement, name: string | RegExp) {
  const msg = lastBot(log);
  const list = within(msg).queryByRole("button", { name: /^☰/ });
  if (list && !within(msg).queryByRole("button", { name })) await u.click(list);
  await u.click(within(lastBot(log)).getByRole("button", { name }));
}

async function waitForBot(log: HTMLElement, text: string | RegExp) {
  await waitFor(() => expect(lastBot(log).textContent).toMatch(text), { timeout: 5000 });
}

describe("WhatsApp simulator", () => {
  it("does the whole journey in chat: advisor → buy → consent → KYC photos → MOCK e-sign → MOCK UPI → tracker", async () => {
    const u = user();
    renderApp();
    const log = await openChat(u);
    expect(screen.getByLabelText("Message")).toHaveValue("Hi");
    await u.click(screen.getByRole("button", { name: "Send" }));
    await waitForBot(log, /Choose your language/);
    await tapLatest(u, log, "English");
    await waitFor(() => expect(within(log).getAllByText(/What kind of business/).length).toBeGreaterThan(0));

    await u.type(screen.getByLabelText("Message"), "I run a dental clinic in Kochi with 5 people");
    await u.click(screen.getByRole("button", { name: "Send" }));
    // Answer each question with its first option until the bundle card arrives.
    for (let i = 0; i < 12; i++) {
      await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
      const msg = lastBot(log);
      if (within(msg).queryByRole("button", { name: "Buy this" })) break;
      const list = within(msg).queryByRole("button", { name: /^☰/ });
      if (list) await u.click(list);
      const first = within(lastBot(log)).getAllByRole("button").find((b) => !b.textContent?.startsWith("☰"))!;
      await u.click(first);
    }
    expect(lastBot(log).textContent).toMatch(/\/month/);
    await tapLatest(u, log, "Buy this");
    await waitForBot(log, /Do you agree/);
    expect(log.textContent).toContain("never ask for your Aadhaar number");
    await tapLatest(u, log, "I agree");
    await waitForBot(log, /full name/);
    await tapLatest(u, log, /^K03 /);
    await waitForBot(log, /send a clear photo/);
    for (let i = 0; i < 5; i++) {
      const demo = screen.queryByRole("button", { name: /DEMO: send K03's photo/ });
      if (!demo) break;
      await u.click(demo);
      await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument(), { timeout: 5000 });
    }
    await waitForBot(log, /one-time password is/);
    expect(log.textContent).toContain("All checks passed");
    const otp = /one-time password is (\d{6})/.exec(lastBot(log).textContent!)![1]!;
    await u.type(screen.getByLabelText("Message"), otp);
    await u.click(screen.getByRole("button", { name: "Send" }));
    await waitForBot(log, /MOCK payment: no money moves/);
    await tapLatest(u, log, "Pay with UPI (MOCK)");
    await waitForBot(log, /Now: Payment received, order placed/);
    const orderId = /Order (ORD-[0-9A-F]{8})/.exec(lastBot(log).textContent!)![1]!;
    expect(backend.requests.filter((r) => r.url === "/api/channels/whatsapp/photo").length).toBeGreaterThan(0);
    // The order is the same one the app's tracker shows.
    const order = await (await backend.fetchFn(`/api/orders/${orderId}`)).json();
    expect(order.currentStage).toBe("order_placed");
    // Old buttons no longer act.
    expect(within(botMessages(log)[0]!).getByRole("button", { name: "English" })).toBeDisabled();
  });

  it("voice note: the mic sends what was said (Hindi), marked as a voice note", async () => {
    withVoice();
    const u = user();
    renderApp();
    const log = await openChat(u, "98765 43210");
    await u.click(screen.getByRole("button", { name: "Send" }));
    await waitForBot(log, /Choose your language/);
    await tapLatest(u, log, "हिंदी");
    await waitFor(() => expect(lastBot(log).textContent).toMatch(/[ऀ-ॿ]/));
    heard.next = "मेरी पुणे में बेकरी है";
    await u.click(screen.getByRole("button", { name: "Speak your message" }));
    await waitFor(() => expect(within(log).getByLabelText("Voice note")).toBeInTheDocument());
    expect(log.textContent).toContain("मेरी पुणे में बेकरी है");
    await waitFor(() => expect(backend.requests.some((r) => (r.body as { voice?: boolean } | undefined)?.voice === true)).toBe(true));
    // The UI was in English, so the mic listened in English; the chat language is the bot's.
    expect(heard.langs).toEqual(["en-IN"]);
    expect(document.body.textContent).not.toContain("9876543210");
  });

  it("voice errors are explained, and the mic is hidden when the browser has no speech recognition", async () => {
    const u = user();
    const first = renderApp();
    await openChat(u);
    expect(screen.queryByRole("button", { name: "Speak your message" })).not.toBeInTheDocument();
    first.unmount();
    withVoice();
    heard.error = "not-allowed";
    renderApp();
    await openChat(u);
    await u.click(screen.getByRole("button", { name: "Speak your message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The microphone is blocked");
  });

  it("a wrong number is refused before the chat opens", async () => {
    const u = user();
    renderApp();
    await u.click(screen.getByRole("button", { name: "Try it on WhatsApp" }));
    await u.type(screen.getByLabelText("Your WhatsApp number"), "12345");
    await u.click(screen.getByRole("button", { name: "Open the chat" }));
    expect(screen.getByText("Enter a 10-digit mobile number.")).toBeInTheDocument();
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
  });

  it("formats *bold* and _italic_ as elements, never as HTML", () => {
    const { container } = render(<p>{formatWa("*Pay now* _MOCK_ <img src=x onerror=alert(1)>")}</p>);
    expect(container.querySelector("strong")).toHaveTextContent("Pay now");
    expect(container.querySelector("em")).toHaveTextContent("MOCK");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("voice on the advisor chat", () => {
  it("the mic sends what was said as a message", async () => {
    withVoice();
    const u = user();
    renderApp();
    await u.click(screen.getByRole("button", { name: "Chat with our advisor" }));
    await screen.findByRole("button", { name: "Speak your message" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Speak your message" })).toBeEnabled());
    heard.next = "I run a bakery in Pune with 4 people";
    await act(async () => {
      await u.click(screen.getByRole("button", { name: "Speak your message" }));
    });
    await waitFor(() => expect(backend.requests.some((r) => r.url.endsWith("/messages") && (r.body as { text?: string })?.text === "I run a bakery in Pune with 4 people")).toBe(true));
    expect(await screen.findByText("🎤 I run a bakery in Pune with 4 people")).toBeInTheDocument();
  });
});
