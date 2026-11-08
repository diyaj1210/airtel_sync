import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordedReader } from "../../backend/tests/kyc/helpers";
import { App } from "./App";
import { TrackerView } from "./components/orders/TrackerView";
import { cleanOrderId } from "./api/orders";
import { formatInr } from "./format";
import { hi } from "./i18n/hi";
import { I18nProvider } from "./i18n/I18nProvider";
import { startBackend, type LiveBackend } from "./test/liveBackend";

/** Quote -> KYC -> MOCK payment -> tracker, through the whole app against the real backend. */

let backend: LiveBackend;
beforeAll(async () => {
  backend = await startBackend({ documentReader: recordedReader() });
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

/** Form (5-person clinic in Kochi) -> accept -> KYC with sample K03 -> MOCK e-sign -> done screen. */
async function quoteAndKyc(u: ReturnType<typeof user>) {
  await u.click(screen.getByRole("button", { name: "Get my price" }));
  await u.click(screen.getByRole("radio", { name: /Office or clinic/ }));
  await u.selectOptions(await screen.findByRole("combobox", { name: "City" }), "Kochi");
  await u.type(screen.getByLabelText(/How many people work there/), "5");
  await u.click(screen.getByRole("radio", { name: /No GSTIN/ }));
  await u.click(screen.getByRole("button", { name: "Show my bundle" }));
  await screen.findByTestId("monthly-total");
  await u.click(screen.getByRole("button", { name: "Accept this quote" }));
  const quoteId = (await screen.findByTestId("quote-reference")).textContent!;
  await u.click(screen.getByRole("button", { name: "Continue to KYC" }));
  await u.click(await screen.findByRole("checkbox", { name: /I agree that my details and documents/ }));
  await u.click(screen.getByRole("button", { name: "Agree and continue" }));
  await u.selectOptions(await screen.findByRole("combobox", { name: "Choose a sample" }), "K03");
  await u.click(screen.getByRole("button", { name: "Use this sample" }));
  await waitFor(() => expect(within(screen.getByTestId("kyc-result")).getByRole("heading", { name: "All checks passed" })).toBeInTheDocument());
  await u.click(screen.getByRole("button", { name: "Sign the agreement" }));
  await u.click(screen.getByRole("button", { name: "Send me a one-time password (MOCK)" }));
  const otp = (await screen.findByText(/MOCK one-time password: \d{6}/)).textContent!.match(/\d{6}/)![0];
  await u.type(screen.getByLabelText("Enter the 6-digit one-time password"), otp);
  await u.click(screen.getByRole("button", { name: "Sign" }));
  await screen.findByRole("heading", { name: "KYC complete" });
  return quoteId;
}

describe("MOCK payment and tracker", () => {
  it("whole journey: pay (a failed MOCK payment first), then follow the order to 'activated'", async () => {
    const u = user();
    renderApp();
    const quoteId = await quoteAndKyc(u);
    const quote = (await (await backend.fetchFn(`/api/quotes/${quoteId}`)).json()) as { quote: { totals: { monthlyInr: number; setupInr: number } } };
    const { monthlyInr, setupInr } = quote.quote.totals;

    await u.click(screen.getByRole("button", { name: "Pay and place my order" }));
    expect(await screen.findByText("MOCK payment")).toBeInTheDocument();
    expect(screen.getByText(/no money is taken and no payment details are asked for/)).toBeInTheDocument();
    expect(screen.getByTestId("pay-due").textContent).toBe(formatInr(setupInr + monthlyInr));
    expect(screen.getByText(/Ready about 5 days after you pay\./)).toBeInTheDocument();

    const payButton = screen.getByRole("button", { name: `Pay ${formatInr(setupInr + monthlyInr)} (MOCK)` });
    await u.click(payButton);
    expect(screen.getByText("Please choose how to pay.")).toBeInTheDocument();
    await u.click(screen.getByRole("radio", { name: "UPI" }));
    await u.click(screen.getByRole("checkbox", { name: /MOCK: make this payment fail/ }));
    await u.click(payButton);
    expect(await screen.findByText(/The payment did not go through \(MOCK\)\. No money was taken/)).toBeInTheDocument();
    await u.click(screen.getByRole("checkbox", { name: /MOCK: make this payment fail/ }));
    await u.click(payButton);

    // Tracker: dates from typical_install_days, today = 2026-07-15 (fibre 5 days).
    const ref = (await screen.findByTestId("order-reference")).textContent!;
    expect(ref).toMatch(/^ORD-[0-9A-F]{8}$/);
    expect(screen.getByTestId("ready-on").textContent).toBe("20 July 2026");
    expect(screen.getByTestId("track-now").textContent).toBe("Now: Payment received, order placed");
    expect(screen.getByText("Next: Installation scheduled, expected 16 July 2026")).toBeInTheDocument();
    expect(within(screen.getByTestId("stage-order_placed")).getByText("Done 15 July 2026")).toBeInTheDocument();
    expect(within(screen.getByTestId("stage-installed")).getByText("Expected 20 July 2026")).toBeInTheDocument();
    expect(within(screen.getByTestId("line-P07")).getByText("Ready by 16 July 2026")).toBeInTheDocument(); // SIMs: 1 day
    expect(within(screen.getByTestId("line-P02")).getByText("Ready by 20 July 2026")).toBeInTheDocument(); // fibre: 5 days
    expect(within(screen.getByTestId("updates")).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Payment received and order placed. Everything should be ready by 20 July 2026.")).toBeInTheDocument();

    for (const stage of ["Installation scheduled", "Installed", "Activated"]) {
      await u.click(screen.getByRole("button", { name: "MOCK: move to the next stage" }));
      await waitFor(() => expect(screen.getByTestId("track-now").textContent).toBe(`Now: ${stage}`));
    }
    expect(screen.getByText("Active since")).toBeInTheDocument();
    expect(screen.getByText("Your services are active. Welcome to Accel Business!")).toBeInTheDocument();
    expect(within(screen.getByTestId("updates")).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: "MOCK: move to the next stage" })).not.toBeInTheDocument();

    // Later, from Home, by reference: no call needed.
    await u.click(screen.getByRole("button", { name: "Back to home" }));
    await u.type(screen.getByLabelText("Order reference"), ` ${ref.toLowerCase()} `);
    await u.click(screen.getByRole("button", { name: "Track my order" }));
    expect(await screen.findByTestId("order-reference")).toHaveTextContent(ref);
    expect(screen.getByTestId("track-now").textContent).toBe("Now: Activated");
  });

  it("KYC without a quote cannot be paid: the done screen says to accept a quote first", async () => {
    const u = user();
    renderApp();
    await u.click(screen.getByRole("button", { name: "Complete your KYC" }));
    await u.click(screen.getByRole("checkbox", { name: /I agree that my details and documents/ }));
    await u.click(screen.getByRole("button", { name: "Agree and continue" }));
    await u.selectOptions(await screen.findByRole("combobox", { name: "Choose a sample" }), "K08");
    await u.click(screen.getByRole("button", { name: "Use this sample" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign the agreement" })).toBeInTheDocument());
    await u.click(screen.getByRole("button", { name: "Sign the agreement" }));
    await u.click(screen.getByRole("button", { name: "Send me a one-time password (MOCK)" }));
    const otp = (await screen.findByText(/MOCK one-time password: \d{6}/)).textContent!.match(/\d{6}/)![0];
    await u.type(screen.getByLabelText("Enter the 6-digit one-time password"), otp);
    await u.click(screen.getByRole("button", { name: "Sign" }));
    expect(await screen.findByText(/To place an order, accept a quote first/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay and place my order" })).not.toBeInTheDocument();
  });

  it("tracking: a malformed reference is caught, an unknown one is 'not found'", async () => {
    const u = user();
    renderApp();
    await u.type(screen.getByLabelText("Order reference"), "12345");
    await u.click(screen.getByRole("button", { name: "Track my order" }));
    expect(screen.getByText("Enter the reference from your order, like ORD-1A2B3C4D.")).toBeInTheDocument();
    await u.clear(screen.getByLabelText("Order reference"));
    await u.type(screen.getByLabelText("Order reference"), "ORD-00000000");
    await u.click(screen.getByRole("button", { name: "Track my order" }));
    expect(await screen.findByText("We could not find an order with this reference.")).toBeInTheDocument();
    expect(cleanOrderId(" ord-1a2b3c4d ")).toBe("ORD-1A2B3C4D");
    expect(cleanOrderId("ORD-1A2B3C4")).toBeNull();
  });

  it("shows the tracker in Hindi", async () => {
    const order = {
      orderId: "ORD-1A2B3C4D",
      placedOn: "2026-07-15",
      payment: { mock: true as const, reference: "PAY-00000001", method: "upi" as const, paidOn: "2026-07-15", setupInr: 1000, firstMonthInr: 4215, totalInr: 5215 },
      bundle: { name: "Office Pro", monthlyInr: 4215, setupInr: 1000, contractMonths: 12 },
      lines: [{ productId: "P02", name: "Biz Fibre 300", qty: 1, unit: "per site", installDays: 5, expectedOn: "2026-07-20" }],
      stages: [
        { stage: "kyc_verified" as const, expectedOn: "2026-07-15", doneOn: "2026-07-15" },
        { stage: "order_placed" as const, expectedOn: "2026-07-15", doneOn: "2026-07-15" },
        { stage: "installation_scheduled" as const, expectedOn: "2026-07-16", doneOn: null },
        { stage: "installed" as const, expectedOn: "2026-07-20", doneOn: null },
        { stage: "activated" as const, expectedOn: "2026-07-20", doneOn: null },
      ],
      currentStage: "order_placed" as const,
      nextStage: { stage: "installation_scheduled" as const, expectedOn: "2026-07-16" },
      readyOn: "2026-07-20",
      activated: false,
      notifications: [{ id: 2, stage: "order_placed" as const, on: "2026-07-15", params: { readyOn: "2026-07-20" } }],
    };
    render(
      <I18nProvider initialLang="hi">
        <TrackerView orderId={order.orderId} initial={order} fetchFn={backend.fetchFn} />
      </I18nProvider>,
    );
    expect(screen.getByTestId("ready-on").textContent).toBe("20 जुलाई 2026");
    expect(screen.getByTestId("track-now").textContent).toBe(`अभी: ${hi["track.stage.order_placed"]}`);
    expect(screen.getByText("भुगतान मिल गया और ऑर्डर दे दिया गया। सब कुछ 20 जुलाई 2026 तक तैयार हो जाना चाहिए।")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: hi["track.mockAdvance"] })).toBeInTheDocument();
  });
});
