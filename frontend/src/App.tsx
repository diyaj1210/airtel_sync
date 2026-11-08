import { useEffect, useState, type FormEvent } from "react";
import type { AcceptedQuote, BusinessProfile, QuoteRequest, Segment } from "./api/quote";
import { AcceptedView } from "./components/AcceptedView";
import { AdvisorChat } from "./components/AdvisorChat";
import { BusinessForm, EMPTY_FORM, type FormValues } from "./components/BusinessForm";
import { KycFlow } from "./components/kyc/KycFlow";
import { CheckoutView } from "./components/orders/CheckoutView";
import { TrackerView } from "./components/orders/TrackerView";
import { cleanOrderId, type Order } from "./api/orders";
import { cleanCaseId, rememberedApplication } from "./api/kyc";
import { LanguageSwitch } from "./components/LanguageSwitch";
import { QuoteView } from "./components/QuoteView";
import { SystemStatus } from "./components/SystemStatus";
import { WhatsAppSim } from "./components/whatsapp/WhatsAppSim";
import { useI18n } from "./i18n/I18nProvider";
import { checkReferral, pendingReferralCode, setReferral, type Referral } from "./referral";

type Screen =
  | { name: "home" }
  | { name: "advisor" }
  | { name: "whatsapp" }
  | { name: "form" }
  | { name: "quote"; request: QuoteRequest; from: "form" | "advisor"; key: number }
  | { name: "accepted"; accepted: AcceptedQuote }
  | { name: "kyc"; quoteId: string | null; key: number; resumeCaseId?: string }
  | { name: "checkout"; caseId: string }
  | { name: "order"; orderId: string; initial?: Order };

export function App({ fetchFn }: { fetchFn?: typeof fetch }) {
  const { t } = useI18n();
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  // Kept when going back from the quote, so the owner does not retype anything.
  const [formValues, setFormValues] = useState<FormValues>(EMPTY_FORM);
  // The chat stays mounted once started, so going to the quote and back keeps the conversation.
  const [chatOpen, setChatOpen] = useState(false);
  const [quoteKey, setQuoteKey] = useState(0);
  const [kycKey, setKycKey] = useState(0);

  // Partner / sales referral from the link (?ref=PTR-01) or remembered on this device.
  const [referral, setReferralState] = useState<Referral | null>(null);
  useEffect(() => {
    const code = pendingReferralCode(window.location.search);
    if (!code) return;
    let live = true;
    void checkReferral(code, fetchFn).then((r) => {
      if (!live) return;
      setReferral(r);
      setReferralState(r);
    });
    return () => {
      live = false;
    };
  }, [fetchFn]);
  const removeReferral = () => {
    setReferral(null);
    setReferralState(null);
  };

  const [trackRef, setTrackRef] = useState("");
  const [trackError, setTrackError] = useState(false);

  const track = (e: FormEvent) => {
    e.preventDefault();
    const orderId = cleanOrderId(trackRef);
    setTrackError(!orderId);
    if (orderId) setScreen({ name: "order", orderId });
  };

  const openKyc = (quoteId: string | null, resumeCaseId?: string) => {
    setKycKey((k) => k + 1);
    setScreen({ name: "kyc", quoteId, key: kycKey + 1, ...(resumeCaseId ? { resumeCaseId } : {}) });
  };

  // Save and return: continue an application with its reference (remembered on this device).
  const [resumeRef, setResumeRef] = useState(() => rememberedApplication() ?? "");
  const [resumeError, setResumeError] = useState(false);
  const resume = (e: FormEvent) => {
    e.preventDefault();
    const caseId = cleanCaseId(resumeRef);
    setResumeError(!caseId);
    if (caseId) openKyc(null, caseId);
  };

  const openQuote = (request: QuoteRequest, from: "form" | "advisor") => {
    setQuoteKey((k) => k + 1);
    setScreen({ name: "quote", request, from, key: quoteKey + 1 });
  };

  const showQuote = (values: FormValues, segment: Segment, profile: BusinessProfile) => {
    setFormValues(values);
    openQuote({ segment, variant: "standard", profile, exclude: [], include: [] }, "form");
  };

  const back: Screen | null =
    screen.name === "form" || screen.name === "advisor" || screen.name === "whatsapp"
      ? { name: "home" }
      : screen.name === "quote"
        ? screen.from === "advisor"
          ? { name: "advisor" }
          : { name: "form" }
        : null;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1 className="app-header__name">{t("app.name")}</h1>
          <p className="app-header__byline">{t("app.byline")}</p>
        </div>
        <LanguageSwitch />
      </header>

      <main className="app-main">
        {back && (
          <button type="button" className="link-button back-button" onClick={() => setScreen(back)}>
            ← {t("nav.back")}
          </button>
        )}

        {screen.name === "home" && (
          <>
            {referral && (
              <section className="card referral" aria-live="polite">
                <p>{t("home.referral", { name: referral.name })}</p>
                <button type="button" className="link-button" onClick={removeReferral}>
                  {t("home.referral.remove")}
                </button>
              </section>
            )}
            <section className="card card--hero">
              <h2 className="hero__title">{t("home.title")}</h2>
              <p className="hero__body">{t("home.body")}</p>
              <button
                type="button"
                className="button-primary"
                onClick={() => {
                  setChatOpen(true);
                  setScreen({ name: "advisor" });
                }}
              >
                {t("home.chat")}
              </button>
              <p className="muted hero__hint">{t("home.chatHint")}</p>
              <button type="button" className="button-secondary" onClick={() => setScreen({ name: "form" })}>
                {t("home.cta")}
              </button>
            </section>
            <section className="card">
              <p className="muted">{t("home.whatsappHint")}</p>
              <button type="button" className="button-secondary" onClick={() => setScreen({ name: "whatsapp" })}>
                {t("home.whatsapp")}
              </button>
            </section>
            <section className="card">
              <p className="muted">{t("home.kycHint")}</p>
              <button type="button" className="button-secondary" onClick={() => openKyc(null)}>
                {t("home.kyc")}
              </button>
            </section>
            <form className="card form" onSubmit={resume} noValidate aria-labelledby="home-resume-title">
              <h2 id="home-resume-title" className="card__title">
                {t("home.resume")}
              </h2>
              <p className="muted small">{t("home.resumeHint")}</p>
              <label className="field__label" htmlFor="home-resume">
                {t("home.resumeLabel")}
              </label>
              <input
                id="home-resume"
                className="input input--code"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={20}
                placeholder="KYC-1A2B3C4D"
                value={resumeRef}
                aria-invalid={resumeError ? true : undefined}
                onChange={(e) => setResumeRef(e.target.value)}
              />
              {resumeError && <p className="field-error">{t("home.resumeError")}</p>}
              <button type="submit" className="button-secondary">
                {t("home.resumeOpen")}
              </button>
            </form>
            <form className="card form" onSubmit={track} noValidate aria-labelledby="home-track-title">
              <h2 id="home-track-title" className="card__title">
                {t("home.track")}
              </h2>
              <p className="muted small">{t("home.trackHint")}</p>
              <label className="field__label" htmlFor="home-track">
                {t("home.trackLabel")}
              </label>
              <input
                id="home-track"
                className="input input--code"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={20}
                placeholder={t("home.trackPlaceholder")}
                value={trackRef}
                aria-invalid={trackError ? true : undefined}
                onChange={(e) => setTrackRef(e.target.value)}
              />
              {trackError && <p className="field-error">{t("home.trackError")}</p>}
              <button type="submit" className="button-secondary">
                {t("home.track")}
              </button>
            </form>
            <SystemStatus fetchFn={fetchFn} />
          </>
        )}

        {chatOpen && (
          <div hidden={screen.name !== "advisor"}>
            <AdvisorChat onSeeQuote={(request) => openQuote(request, "advisor")} fetchFn={fetchFn} />
          </div>
        )}

        {screen.name === "whatsapp" && <WhatsAppSim fetchFn={fetchFn} />}

        {screen.name === "form" && <BusinessForm initial={formValues} onSubmit={showQuote} fetchFn={fetchFn} />}

        {screen.name === "quote" && (
          <QuoteView
            key={screen.key}
            initialRequest={screen.request}
            onAccepted={(accepted) => setScreen({ name: "accepted", accepted })}
            fetchFn={fetchFn}
          />
        )}

        {screen.name === "accepted" && (
          <AcceptedView
            accepted={screen.accepted}
            onKyc={() => openKyc(screen.accepted.quoteId)}
            onNewQuote={() => {
              setFormValues(EMPTY_FORM);
              setScreen({ name: "form" });
            }}
          />
        )}
        {screen.name === "kyc" && (
          <KycFlow
            key={screen.key}
            quoteId={screen.quoteId}
            resumeCaseId={screen.resumeCaseId ?? null}
            onGetQuote={() => setScreen({ name: "form" })}
            onExit={() => setScreen({ name: "home" })}
            onCheckout={(caseId) => setScreen({ name: "checkout", caseId })}
            fetchFn={fetchFn}
          />
        )}
        {screen.name === "checkout" && (
          <CheckoutView
            caseId={screen.caseId}
            onPaid={(order) => setScreen({ name: "order", orderId: order.orderId, initial: order })}
            onViewOrder={(orderId) => setScreen({ name: "order", orderId })}
            fetchFn={fetchFn}
          />
        )}

        {screen.name === "order" && (
          <>
            <TrackerView key={screen.orderId} orderId={screen.orderId} initial={screen.initial} fetchFn={fetchFn} />
            <button type="button" className="link-button" onClick={() => setScreen({ name: "home" })}>
              {t("track.home")}
            </button>
          </>
        )}
      </main>

      <footer className="app-footer">
        <span>{t("footer.note")}</span> · <a href="/backoffice">{t("footer.staff")}</a>
      </footer>
    </div>
  );
}
