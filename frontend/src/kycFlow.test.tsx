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
 * Smart KYC screens against the real backend (registries, checks, consent, readiness, MOCK e-sign).
 * Only the OCR is replaced: the uploads are the real sample PNGs, answered with the recorded OCR
 * reading of each (see backend/tests/kyc/helpers.ts).
 *
 * Order (privacy + One-Sitting Completion add-ons): business identifiers -> registry lookup (nothing
 * stored) -> consent listing only what is still needed -> name -> documents with the readiness card.
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
type U = ReturnType<typeof user>;

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

async function identify(u: U, d: { gstin?: string; udyam: boolean }) {
  if (d.gstin) await u.type(await screen.findByLabelText("GSTIN"), d.gstin);
  else await u.click(await screen.findByRole("checkbox", { name: "My business has no GSTIN" }));
  await u.click(screen.getByRole("radio", { name: d.udyam ? "Yes" : "No" }));
  await u.click(screen.getByRole("button", { name: "Look up my business" }));
}

async function agree(u: U) {
  await u.click(await screen.findByRole("checkbox", { name: /I agree that my details and documents/ }));
  await u.click(screen.getByRole("button", { name: "Agree and continue" }));
}

/** Lookup screen -> consent -> (typed details) name. */
async function lookupAndConsent(u: U, name?: string) {
  await u.click(await screen.findByRole("button", { name: "Continue" }));
  await agree(u);
  if (name) {
    await u.type(await screen.findByLabelText("Your full name (as on your ID)"), name);
    await u.click(screen.getByRole("button", { name: "Continue to documents" }));
    await screen.findByTestId("kyc-doc-signatory_id");
  }
}

/** DEMO: a sample applicant all the way to the check result. */
async function demo(u: U, sampleId: string) {
  await u.selectOptions(await screen.findByRole("combobox", { name: "Choose a sample" }), sampleId);
  await u.click(screen.getByRole("button", { name: "Use this sample" }));
  await lookupAndConsent(u);
  await screen.findByTestId("kyc-result", {}, { timeout: 5000 });
}

async function uploadSample(u: U, sampleId: string, doc: DocType) {
  const slot = await screen.findByTestId(`kyc-doc-${doc}`);
  const input = slot.querySelector("input[type=file]") as HTMLInputElement;
  await u.upload(input, new File([sampleImage(sampleId, doc)], `${doc}.png`, { type: "image/png" }));
  await waitFor(() => expect(within(slot).queryByText("Reading the document…")).not.toBeInTheDocument());
  return slot;
}

const readiness = () => screen.findByTestId("readiness");
const caseIdOnScreen = () => /KYC-[0-9A-F]{8}/.exec(screen.getByTestId("kyc-reference").textContent!)![0];

describe("KYC: lookup first, then consent (privacy inside the journey)", () => {
  it("looks the business up before consent, stores nothing, and the consent lists only the documents still needed", async () => {
    const u = user();
    renderApp();
    await u.click(screen.getByRole("button", { name: "Complete your KYC" }));
    const before = backend.kycStore.size;
    await identify(u, { gstin: "27XUIXG0767D1ZP", udyam: false });

    expect(await screen.findByRole("heading", { name: "Business record found" })).toBeInTheDocument();
    expect(screen.getByText("Joseph Singh (Prop. Ganesh Woodcraft)")).toBeInTheDocument();
    expect(screen.getByText(/Shop\/Unit 80, Civil Lines, Nagpur/)).toBeInTheDocument();
    expect(screen.getByText("27XU********1ZP")).toBeInTheDocument();
    expect(screen.getByText(/We found your details - 2 of 4 documents are not needed\. Still needed: ID of the person signing, Electricity bill \(address proof\)\./)).toBeInTheDocument();
    expect(await readiness()).toHaveAttribute("data-state", "ALMOST_READY");
    expect(backend.kycStore.size).toBe(before); // nothing stored before consent

    await u.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Before we verify your business" })).toBeInTheDocument();
    for (const title of ["1. What we collect", "2. Why, for these purposes only", "3. What is optional", "4. How long we keep it", "5. How to withdraw"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    const what = screen.getByTestId("consent-what");
    expect(what).toHaveTextContent("A photo of your ID of the person signing");
    expect(what).toHaveTextContent("A photo of your Electricity bill (address proof)");
    expect(what).not.toHaveTextContent("GST registration certificate");
    expect(what).toHaveTextContent("We never ask for your Aadhaar number.");
    expect(within(screen.getByTestId("consent-why")).getAllByRole("listitem")).toHaveLength(5);
    expect(await within(screen.getByTestId("consent-keep")).findByText(/deleted 30 days after verification/)).toBeInTheDocument();
    expect(screen.getByTestId("consent-keep")).toHaveTextContent("proposed");
    expect(screen.getByRole("checkbox", { name: /send me offers and product news/ })).not.toBeChecked();

    await u.click(screen.getByRole("button", { name: "Agree and continue" }));
    expect(screen.getByText("Please tick the box to continue.")).toBeInTheDocument();
    expect(backend.kycStore.size).toBe(before);
    await u.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.getByRole("button", { name: "Complete your KYC" })).toBeInTheDocument();
  });

  it("has a Back button to Home on the KYC screens", async () => {
    const u = user();
    renderApp();
    await u.click(screen.getByRole("button", { name: "Complete your KYC" }));
    expect(screen.getByRole("heading", { name: "Your business details" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByRole("button", { name: "Complete your KYC" })).toBeInTheDocument();
  });

  it("app and server agree on the consent notice version", () => {
    expect(CONSENT_VERSION).toBe(SERVER_CONSENT_VERSION);
  });

  it("checks the GSTIN as it is typed (format and checksum), before anything is sent", async () => {
    const u = user();
    renderFlow(null);
    const sent = backend.requests.length;
    await identify(u, { gstin: "08YKZXS8189L1ZO", udyam: false }); // K06's certificate number
    expect(screen.getByText(/This GSTIN is not valid: its last character does not match/)).toBeInTheDocument();
    expect(backend.requests.length).toBe(sent);
    expect(gstinProblem("27XUIXG0767D1ZP")).toBeNull();
    expect(gstinProblem("27XUIXG0767D1Z")).toBe("format");
    expect(udyamProblem("UDYAM-MH-00-9516696")).toBeNull();
  });

  it("withdrawing consent deletes the application's data and shows the deletion date", async () => {
    const u = user();
    renderFlow(null);
    await identify(u, { udyam: false });
    await lookupAndConsent(u);
    await screen.findByLabelText("Your full name (as on your ID)");
    const caseId = caseIdOnScreen();
    expect(backend.kycStore.get(caseId)!.consent.purposes).toHaveLength(5);
    await u.click(screen.getByRole("button", { name: "Withdraw consent" }));
    await u.click(screen.getByRole("button", { name: "Yes, withdraw and delete" }));
    expect(await screen.findByText(/Consent withdrawn. Everything you gave us for this KYC has been deleted/)).toBeInTheDocument();
    expect(screen.getByText("Deleted on 15 July 2026.")).toBeInTheDocument();
    expect(backend.kycStore.get(caseId)!.withdrawn).toEqual({ on: "2026-07-15", cancelled: false });
  });
});

describe("KYC: documents, readiness and MOCK e-sign", () => {
  it("K03 typed in: lookup, consent, name, uploads with an info card each, Ready 100%, MOCK e-sign", async () => {
    const u = user();
    const { container } = renderFlow(null);
    await identify(u, { gstin: "27xuixg0767d1zp", udyam: true });
    await lookupAndConsent(u, "Joseph Singh");

    expect(screen.getByRole("heading", { name: "Found in the GST registry" })).toBeInTheDocument();
    expect(within(screen.getByTestId("kyc-doc-gst_certificate")).getByText("Optional")).toBeInTheDocument();
    const info = screen.getByTestId("doc-info-address_proof");
    expect(info).toHaveTextContent("PNG, JPG or WebP, up to 8 MB");
    expect(info).toHaveTextContent("No, the installation address needs a recent bill.");
    expect(screen.getByTestId("doc-info-gst_certificate")).toHaveTextContent("Already covered by the lookup");

    for (const doc of ["gst_certificate", "udyam_certificate", "signatory_id", "address_proof"] as const) {
      const slot = await uploadSample(u, "K03", doc);
      expect(within(slot).getByText("Read")).toBeInTheDocument();
    }
    expect(within(screen.getByTestId("kyc-doc-signatory_id")).getByText("SYN-ID-**7889")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Check my documents" }));
    expect(within(await screen.findByTestId("kyc-result")).getByRole("heading", { name: "All checks passed" })).toBeInTheDocument();
    const card = await readiness();
    await waitFor(() => expect(card).toHaveAttribute("data-state", "READY"));
    expect(card).toHaveTextContent("Journey readiness: 100% - 5 of 5 verified.");
    expect(card).toHaveTextContent("not a KYC approval");

    await u.click(screen.getByRole("button", { name: "Sign the agreement" }));
    await u.click(screen.getByRole("button", { name: "Send me a one-time password (MOCK)" }));
    const otp = (await screen.findByText(/MOCK one-time password: \d{6}/)).textContent!.match(/\d{6}/)![0];
    await u.type(screen.getByLabelText("Enter the 6-digit one-time password"), otp);
    await u.click(screen.getByRole("button", { name: "Sign" }));
    expect(await screen.findByRole("heading", { name: "KYC complete" })).toBeInTheDocument();

    const text = container.textContent ?? "";
    for (const secret of ["27XUIXG0767D1ZP", "UDYAM-MH-00-9516696", "SYN-ID-447889"]) expect(text).not.toContain(secret);
  });

  it("K11 from the DEMO box, in Hindi: the card says Almost ready, 80%, and the fix is a bill from after 16 April", async () => {
    const u = user();
    renderFlow(null, "hi");
    await u.selectOptions(await screen.findByRole("combobox", { name: hi["kyc.sample.choose"] }), "K11");
    await u.click(screen.getByRole("button", { name: hi["kyc.sample.use"] }));
    await u.click(await screen.findByRole("button", { name: hi["lookup.continue"] }));
    expect(screen.getByRole("heading", { name: `1. ${hi["consent.whatTitle"]}` })).toBeInTheDocument();
    await u.click(screen.getByRole("checkbox", { name: new RegExp(hi["kyc.consent.agree"].slice(0, 20)) }));
    await u.click(screen.getByRole("button", { name: hi["kyc.consent.continue"] }));
    await screen.findByTestId("kyc-result", {}, { timeout: 5000 });
    const card = await readiness();
    await waitFor(() => expect(card).toHaveTextContent("80%"));
    expect(card).toHaveAttribute("data-state", "ALMOST_READY");
    expect(card).toHaveTextContent(hi["ready.state.ALMOST_READY"]);
    expect(card).toHaveTextContent("16 अप्रैल 2026");
    expect((await screen.findByTestId("kyc-result")).textContent).toContain("257 दिन पुराना");
  });

  it("K01 for a quote with a GSTIN-only product: not possible as chosen; one tap switches to the bundle without it, then Ready", async () => {
    const res = await backend.fetchFn("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ segment: "micro", variant: "standard", profile: { cityTier: 1, employees: 4, sites: 1, gstin: "active" }, exclude: [], include: ["P15"] }),
    });
    const { quoteId } = (await res.json()) as { quoteId: string };
    const u = user();
    renderFlow(quoteId);
    await demo(u, "K01");
    const card = await readiness();
    await waitFor(() => expect(card).toHaveAttribute("data-state", "NOT_CURRENTLY_POSSIBLE"));
    expect(card).toHaveTextContent("Not possible for Dukaan Digital Starter as chosen - Dukaan Digital Starter is Ready.");
    expect(card).toHaveTextContent("these products cannot be activated: WhatsApp Business API Starter");
    await u.click(within(card).getByRole("button", { name: /Switch to Dukaan Digital Starter/ }));
    await waitFor(() => expect(screen.getByTestId("readiness")).toHaveAttribute("data-state", "READY"));
    expect(screen.getByRole("button", { name: "Sign the agreement" })).toBeInTheDocument();
  });

  it("K06: 'Did you mean ...?' - one tap confirms the registered GSTIN, then Ready", async () => {
    const u = user();
    renderFlow(null);
    await demo(u, "K06");
    const card = await readiness();
    await waitFor(() => expect(card).toHaveAttribute("data-state", "ALMOST_READY"));
    expect(card).toHaveTextContent("Did you mean 08YK********1ZO (Pooja Shah (Prop. Saffron Unisex Salon))?");
    await u.click(within(card).getByRole("button", { name: "Yes, use my registered GSTIN" }));
    await waitFor(() => expect(screen.getByTestId("readiness")).toHaveAttribute("data-state", "READY"));
  });

  it("K10: needs review until the registered owner signs the MOCK link; then Ready", async () => {
    const u = user();
    renderFlow(null);
    await demo(u, "K10");
    const card = await readiness();
    await waitFor(() => expect(card).toHaveAttribute("data-state", "NEEDS_REVIEW"));
    await u.click(within(card).getByRole("button", { name: "Send the signing link (MOCK)" }));
    const code = (await within(screen.getByTestId("readiness")).findByText(/Registered owner's code \(shown only for the demo\): \d{6}/)).textContent!.match(/\d{6}/)![0];
    await u.type(screen.getByLabelText("Registered owner's 6-digit code"), code);
    await u.click(screen.getByRole("button", { name: "Sign as the registered owner" }));
    await waitFor(() => expect(screen.getByTestId("readiness")).toHaveAttribute("data-state", "READY"));
  });

  it("K07: needs review - says who and when, asks a specific question, and keeps the answer", async () => {
    const u = user();
    renderFlow(null);
    await demo(u, "K07");
    const card = await readiness();
    await waitFor(() => expect(card).toHaveAttribute("data-state", "NEEDS_REVIEW"));
    expect(card).toHaveTextContent("our operations team, usually within 4 working hours");
    expect(card).toHaveTextContent("Has your business's legal name changed");
    await u.type(within(card).getByLabelText(/Your answer/), "Shri was our old name");
    await u.click(within(card).getByRole("button", { name: "Send answer" }));
    expect(await within(screen.getByTestId("readiness")).findByText("Your answer: Shri was our old name")).toBeInTheDocument();
  });

  it("K04's blurred certificate: the blocker's upload button and photo tips; a wrong file type is refused before upload", async () => {
    const u = user();
    renderFlow(null);
    await identify(u, { gstin: "27PZSXS1936O1ZH", udyam: true });
    await lookupAndConsent(u, "Fatima Pillai");
    const slot = await uploadSample(u, "K04", "gst_certificate");
    expect(within(slot).getByText("Needs attention")).toBeInTheDocument();
    const card = await readiness();
    expect(card).toHaveTextContent("in good light, avoid glare");
    expect(within(card).getByRole("button", { name: "Upload GST registration certificate" })).toBeInTheDocument();
    const input = slot.querySelector("input[type=file]") as HTMLInputElement;
    await userEvent.setup({ applyAccept: false }).upload(input, new File(["%PDF"], "cert.pdf", { type: "application/pdf" }));
    expect(within(slot).getByText("Please upload a PNG, JPG or WebP image.")).toBeInTheDocument();
  });

  it("tells the owner when documents cannot be read right now (OCR unavailable)", async () => {
    const u = user();
    renderFlow(null, "en", noOcr);
    await identify(u, { gstin: "27XUIXG0767D1ZP", udyam: false });
    await lookupAndConsent(u, "Joseph Singh");
    const slot = await uploadSample(u, "K03", "signatory_id");
    expect(within(slot).getByText("We cannot read documents right now. Please try again in a minute.")).toBeInTheDocument();
  });
});

describe("KYC: My data, and save and return", () => {
  it("My data shows what is held and the deletion countdown; deleting the photos shows 'deleted on'", async () => {
    const u = user();
    renderFlow(null);
    await demo(u, "K03");
    await u.click(screen.getByRole("button", { name: "My data" }));
    const page = await screen.findByRole("region", { name: "My data" });
    expect(page).toHaveTextContent("You gave consent on 15 July 2026 (notice kyc-consent-v2), via the app.");
    expect(page).toHaveTextContent("Offers and product news: no");
    expect(page).toHaveTextContent("27XU********1ZP");
    expect(within(screen.getByTestId("mydata-docs")).getAllByText(/deleted automatically on 14 August 2026 \(30 days left\)/)).toHaveLength(4);
    await u.click(screen.getByRole("button", { name: "Delete my document photos now" }));
    await u.click(screen.getByRole("button", { name: "Yes, withdraw and delete" }));
    await waitFor(() => expect(within(screen.getByTestId("mydata-docs")).getAllByText(/deleted on 15 July 2026/)).toHaveLength(4));
    await u.click(screen.getByRole("button", { name: "Withdraw my consent" }));
    await u.click(screen.getByRole("button", { name: "Yes, withdraw and delete" }));
    expect(await screen.findByText(/Nothing: all KYC data was deleted on 15 July 2026/)).toBeInTheDocument();
    expect(screen.getByText("Consent withdrawn")).toBeInTheDocument();
  });

  it("an owner who leaves can continue the application from Home, with its blockers kept", async () => {
    const u = user();
    const first = renderApp();
    await u.click(screen.getByRole("button", { name: "Complete your KYC" }));
    await demo(u, "K11");
    const caseId = caseIdOnScreen();
    first.unmount();

    renderApp();
    expect(screen.getByLabelText("Application reference")).toHaveValue(caseId); // remembered on this device
    await u.click(screen.getByRole("button", { name: "Continue" }));
    const card = await readiness();
    expect(card).toHaveAttribute("data-state", "ALMOST_READY");
    expect(card).toHaveTextContent("Upload an electricity bill dated on or after 16 April 2026.");
    expect(backend.kycStore.get(caseId)!.journey.resumes).toBe(1);
  });
});

describe("KYC: from an accepted quote in the app", () => {
  it("'Continue to KYC' starts with the business lookup, and the case keeps the quote", async () => {
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
    expect(screen.getByRole("heading", { name: "Your business details" })).toBeInTheDocument();
    await identify(u, { udyam: false });
    await lookupAndConsent(u);
    await screen.findByLabelText("Your full name (as on your ID)");
    expect(backend.kycStore.get(caseIdOnScreen())!.quoteId).toMatch(/^Q-[0-9A-F]{8}$/);
  });
});
