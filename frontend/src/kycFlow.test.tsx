import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordedReader, sampleImage } from "../../backend/tests/kyc/helpers";
import { CONSENT_VERSION as SERVER_CONSENT_VERSION } from "../../backend/src/kyc/store";
import { CONSENT_VERSION, gstinProblem, udyamProblem, type DocType } from "./api/kyc";
import { App } from "./App";
import { KycFlow } from "./components/kyc/KycFlow";
import { hi } from "./i18n/hi";
import { I18nProvider, type Lang } from "./i18n/I18nProvider";
import { startBackend, type LiveBackend } from "./test/liveBackend";

/**
 * Smart KYC screens against the real backend (registries, checks, consent, MOCK e-sign).
 * Only the OCR is replaced: the uploads are the real sample PNGs, answered with the recorded OCR
 * reading of each (see backend/tests/kyc/helpers.ts).
 */

let backend: LiveBackend;
let noOcr: LiveBackend;
beforeAll(async () => {
  backend = await startBackend({ documentReader: recordedReader() });
  noOcr = await startBackend();
});
afterAll(async () => {
  await backend.close();
  await noOcr.close();
});

const user = () => userEvent.setup();

function renderApp(b: LiveBackend = backend) {
  return render(
    <I18nProvider>
      <App fetchFn={b.fetchFn} />
    </I18nProvider>,
  );
}

function renderFlow(quoteId: string | null, lang: Lang = "en", b: LiveBackend = backend) {
  return render(
    <I18nProvider initialLang={lang}>
      <KycFlow quoteId={quoteId} onExit={() => undefined} fetchFn={b.fetchFn} />
    </I18nProvider>,
  );
}

async function consent(u: ReturnType<typeof user>) {
  await u.click(await screen.findByRole("checkbox", { name: /I agree that my details and documents/ }));
  await u.click(screen.getByRole("button", { name: "Agree and continue" }));
  await screen.findByRole("heading", { name: "Your business details" });
}

async function enterDetails(u: ReturnType<typeof user>, d: { name: string; gstin?: string; udyam: boolean }) {
  await u.type(screen.getByLabelText("Your full name (as on your ID)"), d.name);
  if (d.gstin) await u.type(screen.getByLabelText("GSTIN"), d.gstin);
  else await u.click(screen.getByRole("checkbox", { name: "My business has no GSTIN" }));
  await u.click(screen.getByRole("radio", { name: d.udyam ? "Yes" : "No" }));
  await u.click(screen.getByRole("button", { name: "Look up my business" }));
}

async function uploadSample(u: ReturnType<typeof user>, sampleId: string, doc: DocType) {
  const slot = await screen.findByTestId(`kyc-doc-${doc}`);
  const input = slot.querySelector("input[type=file]") as HTMLInputElement;
  await u.upload(input, new File([sampleImage(sampleId, doc)], `${doc}.png`, { type: "image/png" }));
  await waitFor(() => expect(within(slot).queryByText("Reading the document…")).not.toBeInTheDocument());
  return slot;
}

const result = () => screen.findByTestId("kyc-result");

describe("KYC: consent comes first", () => {
  it("is reachable from home, needs the box ticked, and 'Not now' collects nothing", async () => {
    const u = user();
    renderApp();
    await u.click(screen.getByRole("button", { name: "Complete your KYC" }));
    expect(screen.getByRole("heading", { name: "Before we verify your business" })).toBeInTheDocument();
    for (const title of ["What we collect", "Why", "How", "How long we keep it", "If you change your mind"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText(/We never ask for your Aadhaar number/)).toBeInTheDocument();
    expect(screen.getByText(/Document photos are read and deleted straight away/)).toBeInTheDocument();
    const before = backend.kycStore.size;
    await u.click(screen.getByRole("button", { name: "Agree and continue" }));
    expect(screen.getByText("Please tick the box to continue.")).toBeInTheDocument();
    expect(backend.kycStore.size).toBe(before); // nothing created without consent
    await u.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.getByRole("button", { name: "Complete your KYC" })).toBeInTheDocument();
  });

  it("app and server agree on the consent notice version", () => {
    expect(CONSENT_VERSION).toBe(SERVER_CONSENT_VERSION);
  });

  it("withdrawing consent deletes the application on the server", async () => {
    const u = user();
    renderFlow(null);
    await consent(u);
    const caseId = screen.getByTestId("kyc-reference").textContent!.replace("KYC reference: ", "");
    expect(backend.kycStore.get(caseId)).toBeDefined();
    await u.click(screen.getByRole("button", { name: "Withdraw consent" }));
    await u.click(screen.getByRole("button", { name: "Yes, withdraw and delete" }));
    expect(await screen.findByText(/Consent withdrawn. Everything you gave us for this KYC has been deleted./)).toBeInTheDocument();
    expect(backend.kycStore.get(caseId)).toBeUndefined();
  });
});

describe("KYC: details, documents, result, MOCK e-sign", () => {
  it("checks the GSTIN as it is typed (format and checksum), before anything is sent", async () => {
    const u = user();
    renderFlow(null);
    await consent(u);
    const sent = backend.requests.length;
    await enterDetails(u, { name: "Pooja Shah", gstin: "08YKZXS8189L1ZO", udyam: false }); // K06's certificate number
    expect(screen.getByText(/This GSTIN is not valid: its last character does not match/)).toBeInTheDocument();
    expect(backend.requests.length).toBe(sent);
    expect(gstinProblem("27XUIXG0767D1ZP")).toBeNull();
    expect(gstinProblem("27XUIXG0767D1Z")).toBe("format");
    expect(udyamProblem("UDYAM-MH-00-9516696")).toBeNull();
  });

  it("K03 typed in: registry lookup (MOCK), four uploads, pass, MOCK e-sign with OTP", async () => {
    const u = user();
    const { container } = renderFlow(null);
    await consent(u);
    await enterDetails(u, { name: "Joseph Singh", gstin: "27xuixg0767d1zp", udyam: true });

    expect(await screen.findByRole("heading", { name: "Found in the GST registry" })).toBeInTheDocument();
    expect(screen.getByText("MOCK lookup")).toBeInTheDocument();
    expect(screen.getByText("27XUIX******1ZP")).toBeInTheDocument();
    expect(screen.getByText("Joseph Singh (Prop. Ganesh Woodcraft)")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    // Lookup first: the GST certificate is optional now.
    expect(within(screen.getByTestId("kyc-doc-gst_certificate")).getByText("Optional")).toBeInTheDocument();

    for (const doc of ["gst_certificate", "udyam_certificate", "signatory_id", "address_proof"] as const) {
      const slot = await uploadSample(u, "K03", doc);
      expect(within(slot).getByText("Read")).toBeInTheDocument();
    }
    expect(within(screen.getByTestId("kyc-doc-signatory_id")).getByText("**********889")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Check my documents" }));
    expect(within(await result()).getByRole("heading", { name: "All checks passed" })).toBeInTheDocument();
    // Soft warning only, folded away for the reviewer.
    expect(screen.getByText("Notes for our team (they do not hold up your application)")).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Sign the agreement" }));
    expect(screen.getByText("MOCK e-sign")).toBeInTheDocument();
    expect(screen.getByText(/no SMS is sent and no legal signature is made/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Send me a one-time password (MOCK)" }));
    const otpText = (await screen.findByText(/MOCK one-time password: \d{6}/)).textContent!;
    const otp = otpText.match(/\d{6}/)![0];
    expect(within(screen.getByTestId("kyc-agreement")).getByText("Joseph Singh (Prop. Ganesh Woodcraft)")).toBeInTheDocument();
    await u.type(screen.getByLabelText("Enter the 6-digit one-time password"), otp === "000000" ? "111111" : "000000");
    await u.click(screen.getByRole("button", { name: "Sign" }));
    expect(await screen.findByText("That code is not right. 4 tries left.")).toBeInTheDocument();
    await u.clear(screen.getByLabelText("Enter the 6-digit one-time password"));
    await u.type(screen.getByLabelText("Enter the 6-digit one-time password"), otp);
    await u.click(screen.getByRole("button", { name: "Sign" }));
    expect(await screen.findByRole("heading", { name: "KYC complete" })).toBeInTheDocument();
    expect(screen.getByTestId("esign-reference").textContent).toMatch(/^ES-[0-9A-F]{8}$/);

    // Identifiers are only ever shown masked.
    const text = container.textContent ?? "";
    for (const secret of ["27XUIXG0767D1ZP", "UDYAM-MH-00-9516696", "SYN-ID-447889"]) expect(text).not.toContain(secret);
  });

  it("K11 from the DEMO sample box, in Hindi: the old bill is caught (257 days)", async () => {
    const u = user();
    renderFlow(null, "hi");
    await u.click(await screen.findByRole("checkbox", { name: new RegExp(hi["kyc.consent.agree"].slice(0, 20)) }));
    await u.click(screen.getByRole("button", { name: hi["kyc.consent.continue"] }));
    await u.selectOptions(await screen.findByRole("combobox", { name: hi["kyc.sample.choose"] }), "K11");
    await u.click(screen.getByRole("button", { name: hi["kyc.sample.use"] }));
    const card = await result();
    await waitFor(() => expect(within(card).getByRole("heading", { name: hi["kyc.result.fix_needed"] })).toBeInTheDocument());
    expect(card.textContent).toContain("257 दिन पुराना");
    expect(card.textContent).toContain("31 अक्टूबर 2025");
    expect(within(screen.getByTestId("kyc-doc-address_proof")).getByText(hi["kyc.state.problem"])).toBeInTheDocument();
  });

  it("K01 for an accepted quote: cancelled GSTIN blocks WhatsApp Business API; manual review; blank Udyam certificate not used", async () => {
    const res = await backend.fetchFn("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ segment: "micro", variant: "standard", profile: { cityTier: 1, employees: 4, sites: 1, gstin: "active" }, exclude: [], include: ["P15"] }),
    });
    const { quoteId } = (await res.json()) as { quoteId: string };
    const u = user();
    renderFlow(quoteId);
    await consent(u);
    await u.selectOptions(await screen.findByRole("combobox", { name: "Choose a sample" }), "K01");
    await u.click(screen.getByRole("button", { name: "Use this sample" }));
    const card = await result();
    await waitFor(() => expect(within(card).getByRole("heading", { name: "Our team will check this" })).toBeInTheDocument());
    expect(card.textContent).toContain("Your GSTIN is Cancelled in the GST registry");
    expect(card.textContent).toContain("these products in your quote cannot be activated: WhatsApp Business API Starter");
    expect(card.textContent).toContain("Udyam registration certificate: not used, it has no registration number.");
    expect(screen.queryByRole("button", { name: "Sign the agreement" })).not.toBeInTheDocument();
    expect(within(screen.getByTestId("kyc-doc-udyam_certificate")).getByText("(blank)")).toBeInTheDocument();
  });

  it("K04's blurred certificate asks for a re-upload; a wrong file type is refused before upload", async () => {
    const u = user();
    renderFlow(null);
    await consent(u);
    await enterDetails(u, { name: "Fatima Pillai", gstin: "27PZSXS1936O1ZH", udyam: true });
    const slot = await uploadSample(u, "K04", "gst_certificate");
    expect(within(slot).getByText("Needs attention")).toBeInTheDocument();
    expect((await result()).textContent).toContain("we could not read it clearly");
    const input = slot.querySelector("input[type=file]") as HTMLInputElement;
    await userEvent.setup({ applyAccept: false }).upload(input, new File(["%PDF"], "cert.pdf", { type: "application/pdf" }));
    expect(within(slot).getByText("Please upload a PNG, JPG or WebP image.")).toBeInTheDocument();
  });

  it("tells the owner when documents cannot be read right now (OCR unavailable)", async () => {
    const u = user();
    renderFlow(null, "en", noOcr);
    await consent(u);
    await enterDetails(u, { name: "Joseph Singh", gstin: "27XUIXG0767D1ZP", udyam: false });
    const slot = await uploadSample(u, "K03", "signatory_id");
    expect(within(slot).getByText("We cannot read documents right now. Please try again in a minute.")).toBeInTheDocument();
  });
});

describe("KYC: from an accepted quote in the app", () => {
  it("'Continue to KYC' opens the consent screen", async () => {
    const u = user();
    renderApp();
    await u.click(screen.getByRole("button", { name: "Get my price" }));
    await u.click(screen.getByRole("radio", { name: /Office or clinic/ }));
    await u.selectOptions(await screen.findByRole("combobox", { name: "City" }), "Kochi");
    await u.type(screen.getByLabelText(/How many people work there/), "5");
    await u.click(screen.getByRole("radio", { name: /No GSTIN/ }));
    await u.click(screen.getByRole("button", { name: "Show my bundle" }));
    await screen.findByTestId("monthly-total");
    await u.click(screen.getByRole("button", { name: "Accept this quote" }));
    await u.click(await screen.findByRole("button", { name: "Continue to KYC" }));
    expect(screen.getByRole("heading", { name: "Before we verify your business" })).toBeInTheDocument();
    await consent(u);
    const caseId = screen.getByTestId("kyc-reference").textContent!.replace("KYC reference: ", "");
    expect(backend.kycStore.get(caseId)!.quoteId).toMatch(/^Q-[0-9A-F]{8}$/);
  });
});
