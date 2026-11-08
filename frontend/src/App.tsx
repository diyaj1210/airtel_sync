import { useState } from "react";
import type { AcceptedQuote, BusinessProfile, QuoteRequest, Segment } from "./api/quote";
import { AcceptedView } from "./components/AcceptedView";
import { BusinessForm, EMPTY_FORM, type FormValues } from "./components/BusinessForm";
import { LanguageSwitch } from "./components/LanguageSwitch";
import { QuoteView } from "./components/QuoteView";
import { SystemStatus } from "./components/SystemStatus";
import { useI18n } from "./i18n/I18nProvider";

type Screen =
  | { name: "home" }
  | { name: "form" }
  | { name: "quote"; request: QuoteRequest }
  | { name: "accepted"; accepted: AcceptedQuote };

export function App({ fetchFn }: { fetchFn?: typeof fetch }) {
  const { t } = useI18n();
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  // Kept when going back from the quote, so the owner does not retype anything.
  const [formValues, setFormValues] = useState<FormValues>(EMPTY_FORM);

  const showQuote = (values: FormValues, segment: Segment, profile: BusinessProfile) => {
    setFormValues(values);
    setScreen({ name: "quote", request: { segment, variant: "standard", profile, exclude: [], include: [] } });
  };

  const back = screen.name === "form" ? { name: "home" as const } : screen.name === "quote" ? { name: "form" as const } : null;

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
            <section className="card card--hero">
              <h2 className="hero__title">{t("home.title")}</h2>
              <p className="hero__body">{t("home.body")}</p>
              <button type="button" className="button-primary" onClick={() => setScreen({ name: "form" })}>
                {t("home.cta")}
              </button>
            </section>
            <SystemStatus fetchFn={fetchFn} />
          </>
        )}

        {screen.name === "form" && <BusinessForm initial={formValues} onSubmit={showQuote} fetchFn={fetchFn} />}

        {screen.name === "quote" && (
          <QuoteView
            initialRequest={screen.request}
            onAccepted={(accepted) => setScreen({ name: "accepted", accepted })}
            fetchFn={fetchFn}
          />
        )}

        {screen.name === "accepted" && (
          <AcceptedView
            accepted={screen.accepted}
            onNewQuote={() => {
              setFormValues(EMPTY_FORM);
              setScreen({ name: "form" });
            }}
          />
        )}
      </main>

      <footer className="app-footer">{t("footer.note")}</footer>
    </div>
  );
}
