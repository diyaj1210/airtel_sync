import { useEffect, useState, type FormEvent } from "react";
import { getCheckout, OrderError, pay, PAYMENT_METHODS, type Checkout, type Order, type PaymentMethod } from "../../api/orders";
import { formatInr } from "../../format";
import type { MessageKey } from "../../i18n/en";
import { useI18n } from "../../i18n/I18nProvider";

/**
 * MOCK payment after KYC: what is due now (setup + first month), a payment method, Pay.
 * No money moves and no card / UPI details are asked for. A MOCK switch makes the payment fail,
 * to show the retry path.
 */
export function CheckoutView({
  caseId,
  onPaid,
  onViewOrder,
  fetchFn,
}: {
  caseId: string;
  onPaid: (order: Order) => void;
  onViewOrder: (orderId: string) => void;
  fetchFn?: typeof fetch;
}) {
  const { t } = useI18n();
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [fail, setFail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoadError(false);
    getCheckout(caseId, fetchFn).then(
      (c) => live && setCheckout(c),
      () => live && setLoadError(true),
    );
    return () => {
      live = false;
    };
  }, [caseId, fetchFn, attempt]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!method) return setError("pay.methodError");
    setBusy(true);
    setError(null);
    try {
      onPaid(await pay(caseId, method, fail, fetchFn));
    } catch (err) {
      if (err instanceof OrderError && err.code === "payment_failed") setError("pay.failed");
      else if (err instanceof OrderError && err.code === "network") setError("kyc.network");
      else {
        setError("pay.error");
        setAttempt((a) => a + 1); // reload: the server may say why it cannot be paid
      }
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <section className="card" role="alert">
        <p>{t("pay.error")}</p>
        <button type="button" className="button-secondary" onClick={() => setAttempt((a) => a + 1)}>
          {t("quote.retry")}
        </button>
      </section>
    );
  }
  if (!checkout) return <p className="muted" role="status">{t("pay.loading")}</p>;

  const months = t(checkout.contractMonths === 1 ? "quote.month.one" : "quote.month.other", { n: checkout.contractMonths });
  return (
    <form className="card form" onSubmit={(e) => void submit(e)} noValidate aria-labelledby="pay-title">
      <div className="kyc-doc__head">
        <h2 id="pay-title" className="card__title">
          {t("pay.title")}
        </h2>
        <span className="mock-badge">{t("pay.mock")}</span>
      </div>
      <p className="muted small">{t("pay.mockNote")}</p>

      {checkout.bundle && (
        <dl className="kyc-read" data-testid="pay-summary">
          <div>
            <dt>{t("pay.bundle")}</dt>
            <dd>{checkout.bundle}</dd>
          </div>
          <div>
            <dt>{t("pay.setup")}</dt>
            <dd>{formatInr(checkout.setupInr)}</dd>
          </div>
          <div>
            <dt>{t("pay.firstMonth")}</dt>
            <dd>{formatInr(checkout.monthlyInr)}</dd>
          </div>
          <div>
            <dt>
              <strong>{t("pay.dueNow")}</strong>
            </dt>
            <dd className="summary__price" data-testid="pay-due">
              {formatInr(checkout.dueNowInr)}
            </dd>
          </div>
        </dl>
      )}
      {checkout.bundle && (
        <p className="muted small">
          {t("pay.afterwards", { amount: formatInr(checkout.monthlyInr), months })}{" "}
          {t(checkout.installDays === 1 ? "pay.ready.one" : "pay.ready.other", { n: checkout.installDays })}
        </p>
      )}

      {checkout.block ? (
        <>
          <p className="field-error" role="alert">
            {t(`pay.block.${checkout.block}`, { products: checkout.blockedProducts.map((p) => p.name).join(", ") })}
          </p>
          {checkout.orderId && (
            <button type="button" className="button-primary" onClick={() => onViewOrder(checkout.orderId!)}>
              {t("pay.viewOrder")}
            </button>
          )}
        </>
      ) : (
        <>
          <fieldset className="field">
            <legend className="field__label">{t("pay.method")}</legend>
            {PAYMENT_METHODS.map((m) => (
              <label key={m} className="radio-row">
                <input type="radio" name="pay-method" checked={method === m} onChange={() => setMethod(m)} />
                {t(`pay.method.${m}`)}
              </label>
            ))}
          </fieldset>
          <label className="radio-row small">
            <input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} />
            {t("pay.simulateFailure")}
          </label>
          {error && (
            <p className="field-error" role="alert">
              {t(error)}
            </p>
          )}
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? t("pay.paying") : t("pay.submit", { amount: formatInr(checkout.dueNowInr) })}
          </button>
        </>
      )}
    </form>
  );
}
