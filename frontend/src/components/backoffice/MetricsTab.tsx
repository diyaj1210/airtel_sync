import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BackofficeError, metrics, runRetention, type Metrics, type Staff } from "../../api/backoffice";
import { useI18n } from "../../i18n/I18nProvider";
import { LoadError } from "./common";

/** One-Sitting Completion metrics, and (operations desk) the retention job trigger for the demo. */
export function MetricsTab({ token, staff, onExpired, fetchFn }: { token: string; staff: Staff; onExpired: () => void; fetchFn?: typeof fetch }) {
  const { t } = useI18n();
  const [data, setData] = useState<Metrics | null>(null);
  const [failed, setFailed] = useState(false);
  const [asOf, setAsOf] = useState("2026-07-15");
  const [ran, setRan] = useState<{ asOf: string; files: number; cases: number } | null>(null);
  const [runError, setRunError] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setData(await metrics(token, fetchFn));
    } catch (err) {
      if (err instanceof BackofficeError && err.status === 401) onExpired();
      else setFailed(true);
    }
  }, [token, fetchFn, onExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setRunError(false);
    try {
      setRan(await runRetention(token, asOf, fetchFn));
      await load();
    } catch {
      setRunError(true);
    }
  };

  if (failed) return <LoadError onRetry={() => void load()} />;
  if (!data) return <p className="muted">{t("bo.loading")}</p>;
  const tiles: [string, string][] = [
    [t("bo.metrics.oneSitting"), `${data.oneSittingPercent}%`],
    [t("bo.metrics.completed"), t("bo.metrics.completedValue", { done: data.completedInOneSitting, completed: data.completed, journeys: data.journeys })],
    [t("bo.metrics.auto"), `${data.blockers.autoResolvedPercent}%`],
    [t("bo.metrics.autoValue"), t("bo.metrics.autoDetail", { auto: data.blockers.autoResolved, resolved: data.blockers.resolved, total: data.blockers.total })],
    [t("bo.metrics.alternatives"), String(data.alternativesAccepted)],
    [t("bo.metrics.withdrawn"), String(data.withdrawn)],
  ];
  return (
    <section aria-labelledby="bo-metrics-title" className="bo-section">
      <h2 id="bo-metrics-title" className="card__title">
        {t("bo.metrics.title")}
      </h2>
      <dl className="bo-tiles" data-testid="metrics">
        {tiles.map(([label, value]) => (
          <div key={label} className="bo-tile">
            <dt className="small muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="small">
        {t("bo.metrics.states")}{" "}
        {Object.entries(data.states)
          .map(([s, n]) => `${t(`ready.state.${s}` as "ready.state.READY")}: ${n}`)
          .join(" · ") || "-"}
      </p>
      <p className="muted small">{t("bo.metrics.definition")}</p>

      {staff.role === "admin" && (
        <form className="card" onSubmit={(e) => void run(e)} aria-labelledby="bo-retention-title">
          <h3 id="bo-retention-title" className="card__title">
            {t("bo.retention.title")}
          </h3>
          <p className="muted small">{t("bo.retention.hint")}</p>
          <label className="field__label" htmlFor="bo-retention-date">
            <span className="mock-badge">DEMO</span> {t("bo.retention.asOf")}
          </label>
          <input id="bo-retention-date" type="date" className="input" min="2026-07-15" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          <button type="submit" className="button-secondary">
            {t("bo.retention.run")}
          </button>
          {ran && (
            <p role="status" className="small">
              {t("bo.retention.done", { files: ran.files, cases: ran.cases, date: ran.asOf })}
            </p>
          )}
          {runError && (
            <p role="alert" className="field-error">
              {t("bo.error")}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
