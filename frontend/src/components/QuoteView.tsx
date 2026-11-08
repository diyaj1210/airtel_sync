import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptQuote,
  fetchProducts,
  fetchQuote,
  NotAllowedError,
  type AcceptedQuote,
  type Block,
  type Quote,
  type QuoteItem,
  type QuoteRequest,
  type SelectionProblem,
  type Variant,
} from "../api/quote";
import { formatDate, formatInr } from "../format";
import { useI18n, type Translate } from "../i18n/I18nProvider";
import { productDescription, unitLabel } from "../i18n/products";
import { describeBlock } from "../i18n/reasons";

const plural = (t: Translate, base: "quote.month" | "quote.day", n: number) =>
  t(n === 1 ? `${base}.one` : `${base}.other`, { n });

export function QuoteView({
  initialRequest,
  onAccepted,
  fetchFn,
}: {
  initialRequest: QuoteRequest;
  onAccepted: (accepted: AcceptedQuote) => void;
  fetchFn?: typeof fetch;
}) {
  const { t, lang } = useI18n();
  const [request, setRequest] = useState<QuoteRequest>(initialRequest);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [problems, setProblems] = useState<SelectionProblem[] | null>(null);
  const [accepting, setAccepting] = useState(false);
  const latest = useRef(0);

  const load = useCallback(
    (next: QuoteRequest) => {
      const call = ++latest.current;
      setLoading(true);
      setFailed(false);
      fetchQuote(next, fetchFn).then(
        (q) => {
          if (call !== latest.current) return;
          setQuote(q);
          setRequest(next);
          setProblems(null);
          setLoading(false);
        },
        (err: unknown) => {
          if (call !== latest.current) return;
          // A refused change keeps the last valid quote on screen and explains why.
          if (err instanceof NotAllowedError) setProblems(err.problems);
          else setFailed(true);
          setLoading(false);
        },
      );
    },
    [fetchFn],
  );

  useEffect(() => {
    // Names of every catalogue product, for reasons that mention products outside the bundle.
    // If this fails, reasons fall back to the names in the quote itself.
    let active = true;
    fetchProducts(fetchFn).then(
      (products) => active && setNames(new Map(products.map((p) => [p.id, p.name]))),
      () => undefined,
    );
    load(initialRequest);
    return () => {
      active = false;
    };
    // Only on first show; later changes go through toggle() / chooseVariant().
  }, []);

  const productName = (id: string) => names.get(id) ?? quote?.items.find((i) => i.productId === id)?.name ?? id;
  const reason = (b: Block) => describeBlock(b, t, productName);

  const toggle = (item: QuoteItem) => {
    if (!item.canToggle || loading) return;
    const next =
      item.kind === "core"
        ? {
            ...request,
            exclude: item.selected ? [...request.exclude, item.productId] : request.exclude.filter((id) => id !== item.productId),
          }
        : {
            ...request,
            include: item.selected ? request.include.filter((id) => id !== item.productId) : [...request.include, item.productId],
          };
    load(next);
  };

  const chooseVariant = (variant: Variant) => {
    if (variant !== request.variant && !loading) load({ ...request, variant, exclude: [], include: [] });
  };

  const accept = () => {
    setAccepting(true);
    acceptQuote(request, fetchFn).then(onAccepted, (err: unknown) => {
      setAccepting(false);
      if (err instanceof NotAllowedError) setProblems(err.problems);
      else setFailed(true);
    });
  };

  if (!quote) {
    return (
      <section className={`card ${problems ? "card--alert" : ""}`} aria-busy={loading}>
        {problems ? (
          <div role="alert">
            <p>{t("quote.notAllowed")}</p>
            <ul>
              {problems.map((p) => (
                <li key={`${p.action}-${p.productId}`}>
                  {productName(p.productId)}: {p.reasons.map(reason).join(" ")}
                </li>
              ))}
            </ul>
          </div>
        ) : failed ? (
          <>
            <p role="alert">{t("quote.error")}</p>
            <button type="button" className="button-secondary" onClick={() => load(request)}>
              {t("quote.retry")}
            </button>
          </>
        ) : (
          <p className="muted">{t("quote.updating")}</p>
        )}
      </section>
    );
  }

  const core = quote.items.filter((i) => i.kind === "core");
  const addOns = quote.items.filter((i) => i.kind === "addon");

  const renderItem = (item: QuoteItem) => {
    const reasonId = `reason-${item.productId}`;
    const blocked = !item.canToggle;
    return (
      <li key={item.productId} className={`quote-item ${item.selected ? "" : "quote-item--off"}`}>
        <div className="quote-item__main">
          <label className="quote-item__name" htmlFor={`toggle-${item.productId}`}>
            {item.name}
          </label>
          <p className="quote-item__desc">{productDescription(item.productId, item.description, lang)}</p>
          <p className="quote-item__price">
            {item.qty} × {formatInr(item.unitPriceInr)} {unitLabel(item.unit, lang)} ={" "}
            <strong>
              {formatInr(item.monthlyInr)}
              {t("quote.perMonth")}
            </strong>
            {item.setupInr > 0 && <span className="muted"> {t("quote.setupFee", { amount: formatInr(item.setupInr) })}</span>}
          </p>
          {blocked && (
            <p id={reasonId} className="quote-item__reason">
              {item.blockedBy.map(reason).join(" ")}
            </p>
          )}
        </div>
        <input
          id={`toggle-${item.productId}`}
          className="switch"
          type="checkbox"
          role="switch"
          checked={item.selected}
          disabled={blocked || loading}
          aria-describedby={blocked ? reasonId : undefined}
          onChange={() => toggle(item)}
        />
      </li>
    );
  };

  return (
    <div className="quote" aria-busy={loading}>
      <section className="card">
        <h2 className="hero__title">{quote.name}</h2>
        <p className="muted">
          {t("quote.forBusiness", { employees: quote.profile.employees, sites: quote.profile.sites })}
        </p>

        {/* The five elements of every quote, then the time to value. */}
        <div className="quote-card" data-testid="quote-card">
          <p className="quote-card__price">{t("ttv.perMonth", { price: formatInr(quote.totals.monthlyInr) })}</p>
          <p>{t("ttv.setup", { price: formatInr(quote.totals.setupInr) })}</p>
          <p>{t("ttv.contract", { months: quote.contract.months })}</p>
          {quote.timeline.window ? (
            <p data-testid="ready-estimate">{t("ttv.window", { from: quote.timeline.window.from, to: quote.timeline.window.to })}</p>
          ) : (
            <p data-testid="ready-estimate">{t("ttv.ready", { days: quote.timeline.readyDays, date: formatDate(quote.timeline.readyOn, lang) })}</p>
          )}
          <p className="small muted" data-testid="contract-driver">
            {t("ttv.contractBecause", { months: quote.contract.months, products: quote.contract.drivers.map((d) => productName(d.productId)).join(", ") })}
          </p>
          {quote.contract.shorter && (
            <button
              type="button"
              className="button-secondary button-small"
              disabled={loading}
              onClick={() => {
                const item = quote.items.find((i) => i.productId === quote.contract.shorter!.remove);
                if (item) toggle(item);
              }}
            >
              {t("ttv.shorter", { product: productName(quote.contract.shorter.remove), months: quote.contract.shorter.months })}
            </button>
          )}
          {quote.timeline.window && <p className="small">{t("ttv.partner")}</p>}
        </div>

        {quote.variants.length > 1 && (
          <fieldset className="field">
            <legend className="field__label">{t("quote.planLength")}</legend>
            {quote.variants.map((v) => (
              <label key={v} className="radio-row">
                <input
                  type="radio"
                  name="variant"
                  value={v}
                  checked={request.variant === v}
                  disabled={loading}
                  onChange={() => chooseVariant(v)}
                />
                <span>{t(v === "lite" ? "variant.lite" : "variant.standard")}</span>
              </label>
            ))}
          </fieldset>
        )}
      </section>

      {problems && (
        <section className="card card--alert" role="alert">
          <p>{t("quote.notAllowed")}</p>
          <ul>
            {problems.map((p) => (
              <li key={`${p.action}-${p.productId}`}>
                {productName(p.productId)}: {p.reasons.map(reason).join(" ")}
              </li>
            ))}
          </ul>
        </section>
      )}
      {failed && (
        <section className="card card--alert" role="alert">
          <p>{t("quote.error")}</p>
        </section>
      )}

      <section className="card" aria-labelledby="ttv-title" data-testid="value-timeline">
        <h3 id="ttv-title" className="card__title">
          {t("ttv.title")}
        </h3>
        {quote.timeline.dayOne.length > 0 && quote.timeline.readyDays > 1 && (
          <p className="ttv-banner" data-testid="day-one-banner">
            {t("ttv.dayOneBanner", { n: quote.timeline.dayOne.length })}
          </p>
        )}
        <ol className="ttv">
          {quote.timeline.groups.map((g) => (
            <li key={g.days} className="ttv__day">
              <span className="ttv__when">{t("ttv.day", { day: g.days, date: formatDate(g.readyOn, lang) })}</span>
              <span>
                {g.productIds
                  .map((id) => {
                    const line = quote.timeline.lines.find((l) => l.productId === id)!;
                    return line.waitsFor ? t("ttv.waits", { product: productName(id), base: productName(line.waitsFor) }) : productName(id);
                  })
                  .join(", ")}
              </span>
            </li>
          ))}
        </ol>
        <p className="muted small">{t("ttv.estimate")}</p>
      </section>

      <section className="card">
        <h3 className="card__title">{t("quote.included")}</h3>
        <ul className="quote-list">{core.map(renderItem)}</ul>
      </section>

      {addOns.length > 0 && (
        <section className="card">
          <h3 className="card__title">{t("quote.addOns")}</h3>
          <ul className="quote-list">{addOns.map(renderItem)}</ul>
        </section>
      )}

      {quote.unavailable.length > 0 && (
        <section className="card">
          <h3 className="card__title">{t("quote.unavailable")}</h3>
          <ul className="quote-list">
            {quote.unavailable.map((u) => (
              <li key={u.productId} className="quote-item quote-item--off">
                <div className="quote-item__main">
                  <p className="quote-item__name">{u.name}</p>
                  <p className="quote-item__reason">{u.violations.map(reason).join(" ")}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="summary" aria-label={t("quote.monthlyTotal")}>
        <dl className="summary__grid">
          <div>
            <dt>{t("quote.monthlyTotal")}</dt>
            <dd className="summary__price" data-testid="monthly-total">
              {formatInr(quote.totals.monthlyInr)}
              <span className="summary__per">{t("quote.perMonth")}</span>
            </dd>
          </div>
          <div>
            <dt>{t("quote.setupTotal")}</dt>
            <dd data-testid="setup-total">{formatInr(quote.totals.setupInr)}</dd>
          </div>
          <div>
            <dt>{t("quote.contract")}</dt>
            <dd data-testid="contract">{plural(t, "quote.month", quote.totals.contractMonths)}</dd>
          </div>
          <div>
            <dt>{t("quote.ready")}</dt>
            <dd data-testid="ready">
              {quote.timeline.window
                ? t("ttv.windowShort", { from: quote.timeline.window.from, to: quote.timeline.window.to })
                : plural(t, "quote.day", quote.timeline.readyDays)}
            </dd>
          </div>
        </dl>
        <p className="summary__note">{loading ? t("quote.updating") : t("quote.priceNote")}</p>
        <button type="button" className="button-primary" onClick={accept} disabled={loading || accepting}>
          {accepting ? t("quote.accepting") : t("quote.accept")}
        </button>
      </section>
    </div>
  );
}
