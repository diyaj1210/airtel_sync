import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSystemHealth, type ServiceState, type SystemHealth } from "../api/health";
import type { MessageKey } from "../i18n/en";
import { useI18n } from "../i18n/I18nProvider";

const STATE_LABEL: Record<ServiceState, MessageKey> = {
  ok: "status.ok",
  down: "status.down",
  unknown: "status.unknown",
};

export function SystemStatus({ fetchFn }: { fetchFn?: typeof fetch }) {
  const { t } = useI18n();
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const controller = useRef<AbortController | null>(null);

  const check = useCallback(() => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setHealth(null);
    fetchSystemHealth(fetchFn, ac.signal).then(
      (result) => {
        if (!ac.signal.aborted) setHealth(result);
      },
      () => {
        // Only an aborted request rejects; a newer check (or unmount) replaced it.
      },
    );
  }, [fetchFn]);

  useEffect(() => {
    check();
    return () => controller.current?.abort();
  }, [check]);

  const rows: { key: MessageKey; state: ServiceState | null }[] = [
    { key: "status.backend", state: health?.backend ?? null },
    { key: "status.aiService", state: health?.aiService ?? null },
  ];

  return (
    <section className="card" aria-labelledby="status-title">
      <h2 id="status-title" className="card__title">
        {t("status.title")}
      </h2>
      <ul className="status-list" aria-live="polite">
        {rows.map((row) => (
          <li key={row.key} className="status-row">
            <span>{t(row.key)}</span>
            <span className={`status-badge status-badge--${row.state ?? "checking"}`}>
              {row.state ? t(STATE_LABEL[row.state]) : t("status.checking")}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="button-secondary" onClick={check} disabled={health === null}>
        {t("status.retry")}
      </button>
    </section>
  );
}
