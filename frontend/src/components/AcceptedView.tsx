import type { AcceptedQuote } from "../api/quote";
import { formatDate, formatInr } from "../format";
import { useI18n } from "../i18n/I18nProvider";

export function AcceptedView({ accepted, onNewQuote }: { accepted: AcceptedQuote; onNewQuote: () => void }) {
  const { t, lang } = useI18n();
  const { totals } = accepted.quote;
  return (
    <section className="card" aria-labelledby="accepted-title">
      <h2 id="accepted-title" className="hero__title">
        {t("accepted.title")}
      </h2>
      <p className="muted">{t("accepted.reference")}</p>
      <p className="reference" data-testid="quote-reference">
        {accepted.quoteId}
      </p>
      <p>{t("accepted.validUntil", { date: formatDate(accepted.validUntil, lang) })}</p>
      <dl className="summary__grid">
        <div>
          <dt>{accepted.quote.name}</dt>
          <dd className="summary__price">
            {formatInr(totals.monthlyInr)}
            <span className="summary__per">{t("quote.perMonth")}</span>
          </dd>
        </div>
        <div>
          <dt>{t("quote.setupTotal")}</dt>
          <dd>{formatInr(totals.setupInr)}</dd>
        </div>
      </dl>
      <p>{t("accepted.next")}</p>
      <button type="button" className="button-secondary" onClick={onNewQuote}>
        {t("accepted.newQuote")}
      </button>
    </section>
  );
}
