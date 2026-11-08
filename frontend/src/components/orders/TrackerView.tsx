import { useCallback, useEffect, useState } from "react";
import { advanceOrder, getOrder, OrderError, type Order } from "../../api/orders";
import { formatDate, formatInr } from "../../format";
import type { MessageKey } from "../../i18n/en";
import { useI18n } from "../../i18n/I18nProvider";
import { BlockerList } from "../kyc/ReadinessCard";

/**
 * Order status the owner can check instead of calling: stages with done / expected dates, when
 * each product will be ready (typical_install_days), and the stage updates.
 */
export function TrackerView({ orderId, initial, fetchFn }: { orderId: string; initial?: Order; fetchFn?: typeof fetch }) {
  const { t, lang } = useI18n();
  const [order, setOrder] = useState<Order | null>(initial ?? null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const date = (iso: string) => formatDate(iso, lang);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setOrder(await getOrder(orderId, fetchFn));
    } catch (err) {
      setError(err instanceof OrderError && err.status === 404 ? "track.notFound" : "track.error");
    } finally {
      setBusy(false);
    }
  }, [orderId, fetchFn]);

  useEffect(() => {
    if (!initial) void load();
  }, [initial, load]);

  const advance = async () => {
    setBusy(true);
    setError(null);
    try {
      setOrder(await advanceOrder(orderId, fetchFn));
    } catch {
      setError("track.error");
    } finally {
      setBusy(false);
    }
  };

  if (!order) {
    return error ? (
      <section className="card" role="alert">
        <p>{t(error)}</p>
        {error === "track.error" && (
          <button type="button" className="button-secondary" onClick={() => void load()}>
            {t("quote.retry")}
          </button>
        )}
      </section>
    ) : (
      <p className="muted" role="status">
        {t("track.loading")}
      </p>
    );
  }

  const stageName = (s: Order["currentStage"]) => t(`track.stage.${s}`);
  return (
    <div className="tracker">
      <section className="card" aria-labelledby="track-title">
        <h2 id="track-title" className="hero__title">
          {t("track.title")}
        </h2>
        <p className="muted small">{t("track.reference")}</p>
        <p className="reference" data-testid="order-reference">
          {order.orderId}
        </p>
        <p className="muted small">{order.bundle.name}</p>
        <div className="tracker__ready">
          <span className="muted">{t(order.activated ? "track.activatedOn" : "track.readyBy")}</span>
          <strong data-testid="ready-on">{date(order.readyOn)}</strong>
        </div>
        <p data-testid="track-now">{t("track.now", { stage: stageName(order.currentStage) })}</p>
        {order.nextStage && <p className="muted">{t("track.next", { stage: stageName(order.nextStage.stage), date: date(order.nextStage.expectedOn) })}</p>}
        <p className="muted small">{t("track.noCall")}</p>
        <button type="button" className="link-button" disabled={busy} onClick={() => void load()}>
          {t("track.refresh")}
        </button>
      </section>

      {order.stopped && (
        <section className="card card--alert" role="status" data-testid="order-stopped">
          <p>{t("track.stopped", { date: date(order.stopped.on) })}</p>
        </section>
      )}
      {order.blockers && order.blockers.length > 0 && (
        <section className="card" aria-label={t("track.blockers")}>
          <BlockerList blockers={order.blockers} title="track.blockers" />
        </section>
      )}

      <section className="card" aria-labelledby="track-timeline">
        <h3 id="track-timeline" className="card__title">
          {t("track.timeline")}
        </h3>
        <ol className="timeline">
          {order.stages.map((s) => (
            <li key={s.stage} className={`timeline__step${s.doneOn ? " timeline__step--done" : ""}`} data-testid={`stage-${s.stage}`}>
              <span className="timeline__dot" aria-hidden="true">
                {s.doneOn ? "✓" : ""}
              </span>
              <span className="timeline__name">{stageName(s.stage)}</span>
              <span className="timeline__date muted small">{s.doneOn ? t("track.done", { date: date(s.doneOn) }) : t("track.expected", { date: date(s.expectedOn) })}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card" aria-labelledby="track-products">
        <h3 id="track-products" className="card__title">
          {t("track.products")}
        </h3>
        <ul className="quote-list">
          {order.lines.map((l) => (
            <li key={l.productId} className="quote-item" data-testid={`line-${l.productId}`}>
              <div className="quote-item__main">
                <span className="quote-item__name">
                  {l.name}
                  {l.qty > 1 ? ` × ${l.qty}` : ""}
                </span>
              </div>
              <span className="muted small" data-testid={`line-dates-${l.productId}`}>
                {t("track.planned", { date: date(l.expectedOn) })}
                {" · "}
                {l.doneOn ? t("track.actual", { date: date(l.doneOn) }) : t("track.notYet")}
              </span>
            </li>
          ))}
        </ul>
        <p className="muted small">
          {t("track.paid", { amount: formatInr(order.payment.totalInr), date: date(order.payment.paidOn), ref: order.payment.reference })}
        </p>
      </section>

      <section className="card" aria-labelledby="track-updates">
        <h3 id="track-updates" className="card__title">
          {t("track.updates")}
        </h3>
        <ul className="updates" data-testid="updates">
          {order.notifications.map((n) => (
            <li key={n.id} className="update">
              <span className="muted small">{date(n.on)}</span>
              <span>{t(`track.note.${n.stage}`, { readyOn: date(n.params.readyOn ?? order.readyOn) })}</span>
            </li>
          ))}
        </ul>
      </section>

      {!order.activated && !order.stopped && (
        <section className="card card--demo">
          <span className="mock-badge">MOCK</span>
          <p className="muted small">{t("track.mockNote")}</p>
          <button type="button" className="button-secondary" disabled={busy} onClick={() => void advance()}>
            {t("track.mockAdvance")}
          </button>
        </section>
      )}

      {error && (
        <p className="field-error" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}
