import { useCallback, useEffect, useState } from "react";
import { attribution, BackofficeError, type AttributionSummary, type Staff } from "../../api/backoffice";
import { formatInr } from "../../format";
import { useI18n } from "../../i18n/I18nProvider";
import { LoadError } from "./common";

/** Credit per partner / sales code: leads, quotes, KYC cases and orders that started from their link. */
export function AttributionTab({ token, staff, onExpired, fetchFn }: { token: string; staff: Staff; onExpired: () => void; fetchFn?: typeof fetch }) {
  const { t } = useI18n();
  const [data, setData] = useState<AttributionSummary | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setData(await attribution(token, fetchFn));
    } catch (err) {
      if (err instanceof BackofficeError && err.status === 401) onExpired();
      else setFailed(true);
    }
  }, [token, fetchFn, onExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <LoadError onRetry={() => void load()} />;
  if (!data) return <p className="muted">{t("bo.loading")}</p>;

  const link = `${window.location.origin}/?ref=${staff.code}`;
  const rows = [
    ...data.partners.map((p) => ({ ...p, key: p.code, sub: `${p.code} · ${t(`bo.role.${p.role}`)} · ${p.area}` })),
    ...(data.direct ? [{ key: "direct", name: t("bo.partners.direct"), sub: "", ...data.direct }] : []),
  ];
  return (
    <section aria-labelledby="bo-partners-title" className="bo-section">
      <h2 id="bo-partners-title" className="card__title">
        {t("bo.partners.title")}
      </h2>
      <p className="muted small">{t("bo.partners.hint")}</p>
      {staff.role !== "admin" && (
        <div className="card">
          <p className="field__label">{t("bo.partners.link")}</p>
          <p className="bo-link" data-testid="referral-link">
            {link}
          </p>
          <p className="muted small">{t("bo.partners.linkHint")}</p>
          <a className="button-secondary" href={`/?ref=${staff.code}`} target="_blank" rel="noopener">
            {t("bo.partners.open")}
          </a>
        </div>
      )}
      <table className="bo-table" data-testid="partners-table">
        <thead>
          <tr>
            <th scope="col">{t("bo.tab.partners")}</th>
            <th scope="col">{t("bo.partners.leads")}</th>
            <th scope="col">{t("bo.partners.quotes")}</th>
            <th scope="col">{t("bo.partners.kyc")}</th>
            <th scope="col">{t("bo.partners.orders")}</th>
            <th scope="col">{t("bo.partners.value")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-partner={r.key}>
              <td data-label={t("bo.tab.partners")}>
                <strong>{r.name}</strong>
                {r.sub && <div className="small muted">{r.sub}</div>}
              </td>
              <td data-label={t("bo.partners.leads")}>{r.advisorLeads}</td>
              <td data-label={t("bo.partners.quotes")}>{r.quotes}</td>
              <td data-label={t("bo.partners.kyc")}>{r.kycCases}</td>
              <td data-label={t("bo.partners.orders")}>
                {r.orders}
                {r.orderIds.length > 0 && <div className="small muted">{r.orderIds.join(", ")}</div>}
              </td>
              <td data-label={t("bo.partners.value")}>{formatInr(r.ordersMonthlyInr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
