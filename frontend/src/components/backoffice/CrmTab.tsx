import { useCallback, useEffect, useState } from "react";
import { BackofficeError, listCrmLeads, type CrmList } from "../../api/backoffice";
import { formatDate } from "../../format";
import { useI18n } from "../../i18n/I18nProvider";
import { FilterBar, LoadError, ScoreCell, type StaffNames } from "./common";

/** Past-quarter leads that did not activate (smb_leads.csv), best score first: whom to call back. */
export function CrmTab({ token, names, onExpired, fetchFn }: { token: string; names: StaffNames; onExpired: () => void; fetchFn?: typeof fetch }) {
  const { t, lang } = useI18n();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CrmList | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setData(await listCrmLeads(token, { ...filters, page }, fetchFn));
    } catch (err) {
      if (err instanceof BackofficeError && err.status === 401) onExpired();
      else setFailed(true);
    }
  }, [token, filters, page, fetchFn, onExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <LoadError onRetry={() => void load()} />;
  if (!data) return <p className="muted">{t("bo.loading")}</p>;

  const f = data.facets;
  const pager = (
    <nav className="bo-pager" aria-label={t("bo.crm.page", { page: data.page, pages: data.pages })}>
      <button type="button" className="button-secondary" disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>
        {t("bo.prev")}
      </button>
      <span className="small">{t("bo.crm.page", { page: data.page, pages: data.pages })}</span>
      <button type="button" className="button-secondary" disabled={data.page >= data.pages} onClick={() => setPage((p) => p + 1)}>
        {t("bo.next")}
      </button>
    </nav>
  );
  return (
    <section aria-labelledby="bo-crm-title" className="bo-section">
      <h2 id="bo-crm-title" className="card__title">
        {t("bo.tab.crm")}
      </h2>
      <p className="muted small">{t("bo.crm.source")}</p>
      <FilterBar
        idPrefix="crm"
        names={names}
        value={filters}
        onChange={(next) => {
          setFilters(next);
          setPage(1);
        }}
        filters={[
          { name: "band", label: "bo.filter.band", values: f.band },
          { name: "segment", label: "bo.filter.segment", values: f.segment },
          { name: "city", label: "bo.filter.city", values: f.city },
          { name: "source", label: "bo.filter.source", values: f.source },
          { name: "reason", label: "bo.filter.reason", values: f.reason },
          { name: "stage", label: "bo.filter.stage", values: f.stage },
        ]}
      />
      {data.scoring === "unavailable" && <p className="card card--alert small">{t("bo.scoringDown")}</p>}
      <p className="muted small" aria-live="polite">
        {t("bo.count", { shown: data.leads.length, total: data.total })}
      </p>
      {data.leads.length > 0 && (
        <table className="bo-table" data-testid="crm-table">
          <thead>
            <tr>
              <th scope="col">{t("bo.filter.band")}</th>
              <th scope="col">{t("bo.feature.business_type")}</th>
              <th scope="col">{t("bo.filter.source")}</th>
              <th scope="col">{t("bo.filter.stage")}</th>
            </tr>
          </thead>
          <tbody>
            {data.leads.map((l) => (
              <tr key={l.leadId} data-lead={l.leadId}>
                <td data-label={t("bo.filter.band")}>
                  <ScoreCell score={l.score} />
                </td>
                <td data-label={t("bo.feature.business_type")}>
                  <strong>{l.businessName}</strong>
                  <div className="small">
                    {l.businessType} · {t(`segment.${l.segment}`)} · {l.city}
                  </div>
                  <div className="small muted">
                    {t("bo.leads.people", { n: l.employees })} · {t("bo.leads.sites", { n: l.sites })} · {t(l.hasGstin ? "bo.gstin.yes" : "bo.gstin.no")} ·{" "}
                    {t(l.hasUdyam ? "bo.udyam.yes" : "bo.udyam.no")}
                  </div>
                  <div className="small muted">
                    {l.leadId} · {formatDate(l.createdOn, lang)}
                  </div>
                </td>
                <td data-label={t("bo.filter.source")}>
                  {l.leadSource}
                  <div className="small">{t("bo.crm.contact", { name: l.contactName, role: l.contactRole })}</div>
                  <div className="small muted">
                    {l.preferredLanguage} · {l.currentProvider}
                  </div>
                </td>
                <td data-label={t("bo.filter.stage")}>{t("bo.crm.dropped", { stage: l.stageReached, reason: l.dropReason })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.pages > 1 && pager}
      <p className="muted small">{t("bo.crm.inSample")}</p>
    </section>
  );
}
