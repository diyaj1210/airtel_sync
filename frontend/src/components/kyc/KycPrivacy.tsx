import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CONSENT_PURPOSES,
  deleteMyDocuments,
  KycError,
  myData,
  retentionInfo,
  withdrawConsent,
  type DocType,
  type MyData,
  type Retention,
} from "../../api/kyc";
import { formatDate } from "../../format";
import type { MessageKey } from "../../i18n/en";
import { useI18n } from "../../i18n/I18nProvider";

/**
 * Privacy inside the journey (DPDP Act 2023): the consent notice in five short sections, listing
 * only what this journey still needs after the lookup, and the owner's "My data" page.
 */

const errorKey = (err: unknown): MessageKey => (err instanceof KycError && err.code === "network" ? "kyc.network" : "kyc.error");

export function KycConsent({
  documentsNeeded,
  identifiers,
  onAgree,
  onCancel,
  fetchFn,
}: {
  /** Documents still needed after the lookup: only these are listed. */
  documentsNeeded: DocType[];
  identifiers: { gstin: boolean; udyam: boolean };
  onAgree: (marketing: boolean) => Promise<void>;
  onCancel: () => void;
  fetchFn?: typeof fetch;
}) {
  const { t } = useI18n();
  const [agreed, setAgreed] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [retention, setRetention] = useState<Retention | null>(null);

  useEffect(() => {
    let live = true;
    retentionInfo(fetchFn).then(
      (r) => live && setRetention(r.retention),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [fetchFn]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!agreed) return setError("kyc.consent.agreeError");
    setBusy(true);
    setError(null);
    try {
      await onAgree(marketing);
    } catch (err) {
      setError(errorKey(err));
      setBusy(false);
    }
  };

  const days = retention?.rawDocumentDaysAfterVerification ?? 30;
  const years = retention?.verificationResultYearsAfterContract ?? 8;
  return (
    <form className="card form" onSubmit={(e) => void submit(e)} noValidate aria-labelledby="kyc-consent-title">
      <h2 id="kyc-consent-title" className="hero__title">
        {t("kyc.consent.title")}
      </h2>
      <p>{t("kyc.consent.intro")}</p>

      <div className="consent-section" data-testid="consent-what">
        <h3 className="consent-section__title">1. {t("consent.whatTitle")}</h3>
        <p>{t("consent.whatIntro")}</p>
        <ul>
          <li>{t("consent.item.name")}</li>
          {identifiers.gstin && <li>{t("consent.item.gstin")}</li>}
          {identifiers.udyam && <li>{t("consent.item.udyam")}</li>}
          {documentsNeeded.map((d) => (
            <li key={d}>{t("consent.item.photo", { doc: t(`kyc.doc.${d}`) })}</li>
          ))}
        </ul>
        <p className="muted small">{t("consent.item.noAadhaar")}</p>
      </div>

      <div className="consent-section" data-testid="consent-why">
        <h3 className="consent-section__title">2. {t("consent.whyTitle")}</h3>
        <ul>
          {CONSENT_PURPOSES.map((p) => (
            <li key={p}>{t(`consent.purpose.${p}`)}</li>
          ))}
        </ul>
        <p className="muted small">{t("consent.whyNote")}</p>
      </div>

      <div className="consent-section" data-testid="consent-optional">
        <h3 className="consent-section__title">3. {t("consent.optionalTitle")}</h3>
        <ul>
          <li>{t("consent.optional.udyam")}</li>
          <li>{t("consent.optional.aadhaar")}</li>
          <li>{t("consent.optional.id")}</li>
        </ul>
        <label className="radio-row">
          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
          {t("consent.marketing")}
        </label>
      </div>

      <div className="consent-section" data-testid="consent-keep">
        <h3 className="consent-section__title">4. {t("consent.keepTitle")}</h3>
        <ul>
          <li>{t("consent.keep.raw", { days })}</li>
          <li>{t("consent.keep.result", { years })}</li>
          <li>{t("consent.keep.masked")}</li>
          <li>{t("consent.keep.consent", { years: retention?.consentRecordYearsAfterContract ?? years })}</li>
        </ul>
        <p className="muted small">{t("consent.keep.proposed")}</p>
      </div>

      <div className="consent-section" data-testid="consent-withdraw">
        <h3 className="consent-section__title">5. {t("consent.withdrawTitle")}</h3>
        <p>{t("consent.withdraw.points")}</p>
        <p className="muted small">{t("consent.withdraw.effect")}</p>
      </div>

      <p className="muted small">{t("kyc.consent.prototype")}</p>
      <label className="radio-row">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} aria-invalid={error === "kyc.consent.agreeError" ? true : undefined} />
        {t("kyc.consent.agree")}
      </label>
      {error && (
        <p className="field-error" role="alert">
          {t(error)}
        </p>
      )}
      <button type="submit" className="button-primary" disabled={busy}>
        {t("kyc.consent.continue")}
      </button>
      <button type="button" className="link-button" onClick={onCancel}>
        {t("kyc.consent.notNow")}
      </button>
    </form>
  );
}

/** The owner's "My data" page: what is held (masked), why, since when, and when it is deleted. */
export function MyDataView({ caseId, onBack, onDeleted, fetchFn }: { caseId: string; onBack: () => void; onDeleted: () => void; fetchFn?: typeof fetch }) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<MyData | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [confirm, setConfirm] = useState<"withdraw" | "cancel" | "documents" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await myData(caseId, fetchFn));
      setError(null);
    } catch (err) {
      setError(errorKey(err));
    }
  }, [caseId, fetchFn]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === "documents") setData(await deleteMyDocuments(caseId, fetchFn));
      else {
        await withdrawConsent(caseId, fetchFn, confirm === "cancel");
        await load();
        onDeleted();
      }
      setConfirm(null);
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return error ? (
      <p className="field-error" role="alert">
        {t(error)}
      </p>
    ) : (
      <p className="muted">{t("bo.loading")}</p>
    );
  }
  const active = data.status === "active";
  const storedPhotos = data.documents.filter((d) => !d.deletedOn).length;
  return (
    <section className="card my-data" aria-labelledby="my-data-title">
      <h2 id="my-data-title" className="card__title">
        {t("mydata.title")}
      </h2>
      <p className="muted small">{t("kyc.reference", { id: data.caseId })}</p>
      <p>
        <span className={`status-badge status-badge--${active ? "ok" : "unknown"}`}>{t(`mydata.status.${data.status}`)}</span>
      </p>
      <p className="small">
        {t("mydata.consent", { date: formatDate(data.consent.acceptedOn, lang), version: data.consent.noticeVersion, channel: t(`mydata.channel.${data.consent.channel}`) })}
        {data.consent.withdrawnOn ? ` ${t("mydata.withdrawnOn", { date: formatDate(data.consent.withdrawnOn, lang) })}` : ""}
      </p>
      <p className="kyc-result__list-title">{t("mydata.purposes")}</p>
      <ul className="small">
        {data.consent.purposes.map((p) => (
          <li key={p}>{t(`consent.purpose.${p}`)}</li>
        ))}
        <li>{t(data.consent.marketing ? "mydata.marketing.yes" : "mydata.marketing.no")}</li>
      </ul>

      <p className="kyc-result__list-title">{t("mydata.held")}</p>
      {data.held ? (
        <dl className="kyc-read">
          <div>
            <dt>{t("mydata.name")}</dt>
            <dd>{data.held.applicantName}</dd>
          </div>
          {data.held.gstin && (
            <div>
              <dt>{t("kyc.registry.gstin")}</dt>
              <dd className="code">{data.held.gstin}</dd>
            </div>
          )}
          {data.held.udyamNumber && (
            <div>
              <dt>{t("kyc.registry.udyam")}</dt>
              <dd className="code">{data.held.udyamNumber}</dd>
            </div>
          )}
          {data.held.verificationResult && (
            <div>
              <dt>{t("mydata.result")}</dt>
              <dd>{t(`kyc.result.${data.held.verificationResult}` as MessageKey)}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="small">{t("mydata.nothing", { date: data.consent.withdrawnOn ? formatDate(data.consent.withdrawnOn, lang) : "" })}</p>
      )}

      {data.documents.length > 0 && (
        <>
          <p className="kyc-result__list-title">{t("mydata.docs")}</p>
          <ul className="small" data-testid="mydata-docs">
            {data.documents.map((d) => (
              <li key={d.doc} data-doc={d.doc}>
                {t(`kyc.doc.${d.doc}`)}:{" "}
                {d.deletedOn
                  ? t("mydata.docDeleted", { date: formatDate(d.deletedOn, lang) })
                  : d.deleteDueOn
                    ? t("mydata.docDue", { date: formatDate(d.deleteDueOn, lang), days: d.daysLeft ?? 0 })
                    : t("mydata.docDueLater", { days: data.retention.rawDocumentDaysAfterVerification })}
              </li>
            ))}
          </ul>
        </>
      )}

      {data.deletionLog.length > 0 && (
        <details className="kyc-warnings">
          <summary>{t("mydata.log", { n: data.deletionLog.length })}</summary>
          <ul>
            {data.deletionLog.map((e, i) => (
              <li key={i}>
                {t("mydata.logEntry", {
                  what: e.what === "all_kyc_data" ? t("mydata.all") : t(`kyc.doc.${e.what}`),
                  date: formatDate(e.deletedOn, lang),
                  reason: t(`mydata.reason.${e.reason}`),
                })}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="muted small">{t("consent.keep.proposed")}</p>

      {error && (
        <p className="field-error" role="alert">
          {t(error)}
        </p>
      )}
      {active &&
        (confirm ? (
          <div className="card card--alert" role="alertdialog" aria-labelledby="mydata-confirm">
            <p id="mydata-confirm">{t(confirm === "documents" ? "mydata.confirmDocs" : "mydata.confirm")}</p>
            <button type="button" className="button-primary button-danger" disabled={busy} onClick={() => void act()}>
              {t("kyc.withdraw.yes")}
            </button>
            <button type="button" className="link-button" onClick={() => setConfirm(null)}>
              {t("kyc.withdraw.no")}
            </button>
          </div>
        ) : (
          <div className="my-data__actions">
            {storedPhotos > 0 && (
              <button type="button" className="button-secondary" onClick={() => setConfirm("documents")}>
                {t("mydata.deleteDocs")}
              </button>
            )}
            {!data.orderId && (
              <button type="button" className="button-secondary" onClick={() => setConfirm("cancel")}>
                {t("mydata.cancel")}
              </button>
            )}
            <button type="button" className="button-secondary button-danger" onClick={() => setConfirm("withdraw")}>
              {t("mydata.withdraw")}
            </button>
          </div>
        ))}
      <button type="button" className="link-button" onClick={onBack}>
        ← {t("nav.back")}
      </button>
    </section>
  );
}
