import { useCallback, useEffect, useState } from "react";
import { BackofficeError, FOLLOW_UP_STATUSES, listLeads, updateLead, type AdvisorLead, type FollowUpStatus, type LeadList, type Staff } from "../../api/backoffice";
import { formatDate, formatInr } from "../../format";
import { useI18n } from "../../i18n/I18nProvider";
import { FilterBar, LoadError, ScoreCell, type StaffNames } from "./common";

/** Leads the advisor could not close, with the reason, the propensity score and the follow-up. */
export function LeadsTab({ token, staff, names, onExpired, fetchFn }: { token: string; staff: Staff; names: StaffNames; onExpired: () => void; fetchFn?: typeof fetch }) {
  const { t, lang } = useI18n();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [data, setData] = useState<LeadList | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<{ leadId: string; state: "saved" | "error" } | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setData(await listLeads(token, filters, fetchFn));
    } catch (err) {
      if (err instanceof BackofficeError && err.status === 401) onExpired();
      else setFailed(true);
    }
  }, [token, filters, fetchFn, onExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = async (lead: AdvisorLead, patch: { status?: FollowUpStatus; assignedTo?: string | null }) => {
    try {
      const { followUp } = await updateLead(token, lead.leadId, patch, fetchFn);
      setData((d) => d && { ...d, leads: d.leads.map((l) => (l.leadId === lead.leadId ? { ...l, followUp } : l)) });
      setSaving({ leadId: lead.leadId, state: "saved" });
    } catch (err) {
      if (err instanceof BackofficeError && err.status === 401) return onExpired();
      setSaving({ leadId: lead.leadId, state: "error" });
    }
  };

  if (failed) return <LoadError onRetry={() => void load()} />;
  if (!data) return <p className="muted">{t("bo.loading")}</p>;

  const f = data.facets;
  return (
    <section aria-labelledby="bo-leads-title" className="bo-section">
      <h2 id="bo-leads-title" className="card__title">
        {t("bo.tab.leads")}
      </h2>
      <FilterBar
        idPrefix="leads"
        names={names}
        value={filters}
        onChange={setFilters}
        filters={[
          { name: "band", label: "bo.filter.band", values: ["high", "medium", "low"].filter((b) => f.band.includes(b)) },
          { name: "reason", label: "bo.filter.reason", values: f.reason },
          { name: "segment", label: "bo.filter.segment", values: f.segment },
          { name: "city", label: "bo.filter.city", values: f.city },
          ...(staff.role === "partner" ? [] : [{ name: "attribution", label: "bo.filter.attribution" as const, values: f.attribution }]),
          { name: "status", label: "bo.filter.status", values: f.status },
          ...(staff.role === "partner" ? [] : [{ name: "assignedTo", label: "bo.filter.assignedTo" as const, values: f.assignedTo }]),
        ]}
      />
      {data.scoring === "unavailable" && <p className="card card--alert small">{t("bo.scoringDown")}</p>}
      <p className="muted small" aria-live="polite">
        {t("bo.count", { shown: data.leads.length, total: data.total })}
      </p>
      {data.total === 0 ? (
        <p className="card muted">{t("bo.leads.empty")}</p>
      ) : (
        <table className="bo-table" data-testid="leads-table">
          <thead>
            <tr>
              <th scope="col">{t("bo.filter.band")}</th>
              <th scope="col">{t("bo.feature.business_type")}</th>
              <th scope="col">{t("bo.filter.reason")}</th>
              <th scope="col">{t("bo.filter.attribution")}</th>
              <th scope="col">{t("bo.filter.status")}</th>
            </tr>
          </thead>
          <tbody>
            {data.leads.map((lead) => {
              const b = lead.business;
              const facts = [
                b.type ?? t("bo.leads.unknownType"),
                b.employees !== null ? t("bo.leads.people", { n: b.employees }) : null,
                b.locations !== null ? t("bo.leads.sites", { n: b.locations }) : null,
                b.city,
              ].filter(Boolean);
              return (
                <tr key={lead.leadId} data-lead={lead.leadId}>
                  <td data-label={t("bo.filter.band")}>
                    <ScoreCell score={lead.score} />
                  </td>
                  <td data-label={t("bo.feature.business_type")}>
                    <strong>{facts.join(" · ")}</strong>
                    <div className="muted small">
                      {lead.leadId} · {formatDate(lead.createdOn, lang)}
                      {lead.segment ? ` · ${t(`segment.${lead.segment}`)}` : ""}
                    </div>
                  </td>
                  <td data-label={t("bo.filter.reason")}>
                    <strong>{t(`bo.reason.${lead.reason}` as "bo.reason.other")}</strong>
                    <div className="small">{lead.phoneMasked ? t("bo.leads.phone", { phone: lead.phoneMasked }) : t("bo.leads.noPhone")}</div>
                    {lead.recommendation && (
                      <div className="small muted">{t("bo.leads.recommended", { name: lead.recommendation.name, price: formatInr(lead.recommendation.monthlyInr) })}</div>
                    )}
                    {lead.askedAboutUnavailable.length > 0 && <div className="small muted">{t("bo.leads.unavailable", { count: lead.askedAboutUnavailable.length })}</div>}
                    {lead.note && <div className="small">{t("bo.leads.note", { note: lead.note })}</div>}
                  </td>
                  <td data-label={t("bo.filter.attribution")}>{lead.attribution ? lead.attribution.name : t("bo.none")}</td>
                  <td data-label={t("bo.filter.status")}>
                    <div className="bo-followup">
                      <label className="sr-only" htmlFor={`status-${lead.leadId}`}>
                        {t("bo.filter.status")}
                      </label>
                      <select
                        id={`status-${lead.leadId}`}
                        className="input"
                        value={lead.followUp.status}
                        onChange={(e) => void change(lead, { status: e.target.value as FollowUpStatus })}
                      >
                        {FOLLOW_UP_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {t(`bo.status.${s}`)}
                          </option>
                        ))}
                      </select>
                      {staff.role !== "partner" && (
                        <>
                          <label className="sr-only" htmlFor={`owner-${lead.leadId}`}>
                            {t("bo.filter.assignedTo")}
                          </label>
                          <select
                            id={`owner-${lead.leadId}`}
                            className="input"
                            value={lead.followUp.assignedTo ?? ""}
                            onChange={(e) => void change(lead, { assignedTo: e.target.value || null })}
                          >
                            <option value="">{t("bo.unassigned")}</option>
                            {data.assignable.map((s) => (
                              <option key={s.code} value={s.code}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                      {saving?.leadId === lead.leadId && (
                        <span className={`small ${saving.state === "error" ? "field-error" : "muted"}`} role="status">
                          {t(saving.state === "error" ? "bo.saveError" : "bo.saved")}
                        </span>
                      )}
                      {lead.followUp.updatedOn && lead.followUp.updatedBy && (
                        <span className="small muted">{t("bo.leads.updated", { date: formatDate(lead.followUp.updatedOn, lang), by: names(lead.followUp.updatedBy) })}</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="muted small">{t("bo.scoreNote")}</p>
    </section>
  );
}
