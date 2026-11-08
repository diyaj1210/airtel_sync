import { LanguageSwitch } from "./components/LanguageSwitch";
import { SystemStatus } from "./components/SystemStatus";
import { useI18n } from "./i18n/I18nProvider";

export function App({ fetchFn }: { fetchFn?: typeof fetch }) {
  const { t } = useI18n();
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
        <section className="card card--hero">
          <h2 className="hero__title">{t("home.title")}</h2>
          <p className="hero__body">{t("home.body")}</p>
        </section>
        <SystemStatus fetchFn={fetchFn} />
      </main>

      <footer className="app-footer">{t("footer.note")}</footer>
    </div>
  );
}
