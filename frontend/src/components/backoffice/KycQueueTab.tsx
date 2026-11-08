import { useCallback, useEffect, useState } from "react";
import { BackofficeError, documentPhoto, kycQueue, reviewCase, type KycQueue, type QueueItem } from "../../api/backoffice";
import { BlockerList } from "../kyc/ReadinessCard";
import { DOC_TYPES } from "../../api/kyc";
import { formatDate, formatInr } from "../../format";
import { useI18n } from "../../i18n/I18nProvider";
import { issueText } from "../kyc/kycText";
import { FilterBar, LoadError, type StaffNames } from "./common";

const STATUS_CLASS: Record<QueueItem["queueStatus"], string> = { needs_review: "unknown", waiting_for_owner: "down", approved: "ok", rejected: "down" };

function Decision({ item, token, onDone, onExpired, fetchFn }: { item: QueueItem; token: string; onDone: (i: QueueItem) => void; onExpired: () => void; fetchFn?: typeof fetch }) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const [error, setError] = useState<"bo.kyc.noteRequired" | "bo.kyc.decideError" | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `note-${item.caseId}`;

  const decide = async (decision: "approved" | "rejected") => {
    if (decision === "rejected" && note.trim() === "") return setError("bo.kyc.noteRequired");
    setBusy(true);
    setError(null);
    try {
      onDone(await reviewCase(token, item.caseId, decision, note, fetchFn));
      setNote("");
    } catch (err) {
      if (err instanceof BackofficeError && err.status === 401) return onExpired();
      setError(err instanceof BackofficeError && err.code === "note_required" ? "bo.kyc.noteRequired" : "bo.kyc.decideError");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bo-decision">
      <label className="field__label" htmlFor={id}>
        {t("bo.kyc.note")}
      </label>
      <textarea id={id} className="input" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby={`${id}-hint`} />
      <p id={`${id}-hint`} className="muted small">
        {t("bo.kyc.noteHint")}
      </p>
      {error && (
        <p className="field-error" role="alert">
          {t(error)}
        </p>
      )}
      <div className="bo-decision__buttons">
        <button type="button" className="button-primary" disabled={busy} onClick={() => void decide("approved")}>
          {t("bo.kyc.approve")}
        </button>
        <button type="button" className="button-secondary" disabled={busy} onClick={() => void decide("rejected")}>
          {t("bo.kyc.reject")}
        </button>
      </div>
      <p className="muted small">{t("bo.kyc.gstinRule")}</p>
    </div>
  );
}

/** A stored photo, decrypted for the operations desk on request (never cached by the browser). */
function Photo({ token, caseId, doc, fetchFn }: { token: string; caseId: string; doc: string; fetchFn?: typeof fetch }) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const show = async () => {
    try {
      setUrl(URL.createObjectURL(await documentPhoto(token, caseId, doc, fetchFn)));
    } catch {
      setFailed(true);
    }
  };
  return (
    <li>
      {url ? (
        <img className="bo-photo" src={url} alt={t(`kyc.doc.${doc}` as "kyc.doc.address_proof")} />
      ) : (
        <button type="button" className="link-button" onClick={() => void show()}>
          {t("bo.kyc.viewPhoto", { doc: t(`kyc.doc.${doc}` as "kyc.doc.address_proof") })}
        </button>
      )}
      {failed && <span className="field-error small"> {t("bo.error")}</span>}
    </li>
  );
}

/** KYC exceptions: cases a person must decide, and cases waiting for the owner to fix something. */
export function KycQueueTab({ token, names, onExpired, fetchFn }: { token: string; names: StaffNames; onExpired: () => void; fetchFn?: typeof fetch }) {
  const { t, lang } = useI18n();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [data, setData] = useState<KycQueue | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setData(await kycQueue(token, filters, fetchFn));
    } catch (err) {
      if (err instanceof BackofficeError && err.status === 401) onExpired();
      else setFailed(true);
    }
  }, [token, filters, fetchFn, onExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <LoadError onRetry={() => void load()} />;
  if (!data) return <p className="muted">{t("bo.loading")}</p>;

  return (
    <section aria-labelledby="bo-kyc-title" className="bo-section">
      <h2 id="bo-kyc-title" className="card__title">
        {t("bo.tab.kyc")}
      </h2>
      <ul className="bo-counts">
        {data.facets.status.map((s) => (
          <li key={s}>
            <span className={`status-badge status-badge--${STATUS_CLASS[s]}`}>{t(`bo.kyc.status.${s}`)}</span> {data.counts[s]}
          </li>
        ))}
      </ul>
      <FilterBar
        idPrefix="kyc"
        names={names}
        value={filters}
        onChange={setFilters}
        filters={[
          { name: "status", label: "bo.filter.queue", values: data.facets.status, kind: "queue" },
          { name: "attribution", label: "bo.filter.attribution", values: data.facets.attribution },
        ]}
      />
      {data.total === 0 && <p className="card muted">{t("bo.kyc.empty")}</p>}
      {data.items.map((item) => {
        const c = item.case;
        const gst = c.registry.gst;
        const fixes = c.result.issues.filter((i) => i.severity === "fix");
        const reviews = c.result.issues.filter((i) => i.severity === "review");
        return (
          <article key={item.caseId} className="card bo-case" data-case={item.caseId} aria-labelledby={`case-${item.caseId}`}>
            <header className="bo-case__head">
              <h3 id={`case-${item.caseId}`} className="card__title">
                {gst?.legalName ?? c.registry.udyam?.enterpriseName ?? c.business?.applicantName ?? item.caseId}
              </h3>
              <span className={`status-badge status-badge--${STATUS_CLASS[item.queueStatus]}`}>{t(`bo.kyc.status.${item.queueStatus}`)}</span>
            </header>
            <p className="muted small">
              {item.caseId} · {t("bo.kyc.started", { date: formatDate(item.startedOn, lang) })}
              {c.sampleId ? ` · DEMO ${c.sampleId}` : ""}
              {item.orderId ? ` · ${t("bo.kyc.order", { id: item.orderId })}` : ""}
            </p>
            {c.business && <p className="small">{t("bo.kyc.applicant", { name: c.business.applicantName })}</p>}
            <p className="small">
              {gst ? `${t("bo.kyc.registry", { name: gst.legalName, status: gst.status })} · ${gst.gstin}` : t("bo.kyc.noRegistry")}
            </p>
            <p className="small">
              {item.quote ? t("bo.kyc.quote", { bundle: item.quote.bundle, price: formatInr(item.quote.monthlyInr) }) : t("bo.kyc.noQuote")}
              {item.attribution ? ` · ${t("bo.kyc.attribution", { name: item.attribution.name })}` : ""}
            </p>
            {[...reviews, ...fixes].length > 0 && (
              <>
                <p className="kyc-result__list-title">{t("bo.kyc.issues")}</p>
                <ul className="kyc-issues">
                  {[...reviews, ...fixes].map((issue, i) => (
                    <li key={`${issue.code}-${i}`} data-code={issue.code}>
                      {issueText(issue, t, lang)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {c.result.warnings.length > 0 && (
              <details className="kyc-warnings">
                <summary>{t("bo.kyc.warnings")}</summary>
                <ul>
                  {c.result.warnings.map((w, i) => (
                    <li key={`${w.code}-${i}`}>{issueText(w, t, lang)}</li>
                  ))}
                </ul>
              </details>
            )}
            <details className="kyc-warnings">
              <summary>{t("bo.kyc.documents")}</summary>
              {DOC_TYPES.filter((d) => c.documents[d]?.read).map((d) => (
                <div key={d}>
                  <p className="kyc-result__list-title small">{t(`kyc.doc.${d}`)}</p>
                  <dl className="kyc-read">
                    {Object.entries(c.documents[d]!.read!).map(([field, value]) => (
                      <div key={field}>
                        <dt>{t(`kyc.field.${field}` as "kyc.field.name")}</dt>
                        <dd>{value ?? t("kyc.field.blank")}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </details>
            {item.readiness && (
              <div className="bo-readiness" data-testid={`bo-readiness-${item.caseId}`}>
                <p className="small">
                  <strong>{t("bo.kyc.readiness", { state: t(`ready.state.${item.readiness.state}`), percent: item.readiness.percent })}</strong>
                </p>
                <BlockerList blockers={item.readiness.blockers} />
              </div>
            )}
            {item.documentsStored.length > 0 && (
              <details className="kyc-warnings">
                <summary>{t("bo.kyc.photos", { n: item.documentsStored.length })}</summary>
                <ul className="bo-photos">
                  {item.documentsStored.map((d) => (
                    <Photo key={d} token={token} caseId={item.caseId} doc={d} fetchFn={fetchFn} />
                  ))}
                </ul>
                <p className="muted small">{t("bo.kyc.photosNote")}</p>
              </details>
            )}
            {c.result.review && (
              <p className="small">
                <strong>{t("bo.kyc.decided", { decision: t(`bo.kyc.status.${c.result.review.decision}`), date: formatDate(c.result.review.on, lang) })}</strong>
                {c.result.review.note ? ` · ${c.result.review.note}` : ""}
              </p>
            )}
            {item.queueStatus === "waiting_for_owner" && <p className="muted small">{t("bo.kyc.waiting")}</p>}
            {item.queueStatus !== "waiting_for_owner" && !item.canDecide && <p className="muted small">{t("bo.kyc.signed")}</p>}
            {item.canDecide && (
              <Decision
                item={item}
                token={token}
                onExpired={onExpired}
                fetchFn={fetchFn}
                onDone={() => void load()}
              />
            )}
          </article>
        );
      })}
    </section>
  );
}
