import { useState, type ChangeEvent } from "react";
import {
  ACCEPTED_IMAGES,
  DOC_TYPES,
  KycError,
  MAX_IMAGE_BYTES,
  readFileBytes,
  removeDocument,
  submitKyc,
  uploadDocument,
  type DocType,
  type KycCase,
  type KycIssue,
} from "../../api/kyc";
import type { MessageKey } from "../../i18n/en";
import { useI18n } from "../../i18n/I18nProvider";
import { issueText } from "./kycText";
import { formatDate } from "../../format";

const STATE_BADGE = { ok: "ok", problem: "down", rejected: "unknown", not_uploaded: "unknown" } as const;

function uploadError(err: unknown): MessageKey {
  if (err instanceof KycError) {
    if (err.code === "network") return "kyc.network";
    const key = `kyc.upload.${err.code}`;
    if (["too_large", "unsupported_type", "not_an_image", "ocr_unavailable"].includes(err.code)) return key as MessageKey;
  }
  return "kyc.upload.error";
}

function DocSlot({
  kyc,
  doc,
  onChange,
  locked,
  fetchFn,
}: {
  kyc: KycCase;
  doc: DocType;
  onChange: (k: KycCase) => void;
  locked: boolean;
  fetchFn?: typeof fetch;
}) {
  const { t } = useI18n();
  const view = kyc.documents[doc];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const inputId = `kyc-file-${doc}`;

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file can be chosen again
    if (!file) return;
    if (!ACCEPTED_IMAGES.split(",").includes(file.type)) return setError("kyc.upload.unsupported_type");
    if (file.size > MAX_IMAGE_BYTES) return setError("kyc.upload.too_large");
    setBusy(true);
    setError(null);
    try {
      const bytes = await readFileBytes(file);
      onChange(await uploadDocument(kyc.caseId, doc, { bytes, type: file.type }, fetchFn));
    } catch (err) {
      setError(uploadError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      onChange(await removeDocument(kyc.caseId, doc, fetchFn));
    } catch (err) {
      setError(uploadError(err));
    } finally {
      setBusy(false);
    }
  };

  if (view.need === "not_needed" && !view.uploaded) return null;
  return (
    <li className="kyc-doc" data-testid={`kyc-doc-${doc}`}>
      <div className="kyc-doc__head">
        <span className="kyc-doc__name">{t(`kyc.doc.${doc}`)}</span>
        <span className={`status-badge status-badge--${view.uploaded ? STATE_BADGE[view.state] : "unknown"}`}>
          {view.uploaded ? t(`kyc.state.${view.state}`) : t(`kyc.need.${view.need}`)}
        </span>
      </div>
      {view.read && (
        <dl className="kyc-read">
          {Object.entries(view.read).map(([field, value]) => (
            <div key={field}>
              <dt>{t(`kyc.field.${field}` as MessageKey)}</dt>
              <dd>{value ?? t("kyc.field.blank")}</dd>
            </div>
          ))}
        </dl>
      )}
      {busy && (
        <p className="muted small" role="status">
          {t("kyc.reading")}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {t(error)}
        </p>
      )}
      {!locked && (
        <details className="doc-info" data-testid={`doc-info-${doc}`}>
          <summary>{t("docinfo.title")}</summary>
          <dl className="kyc-read">
            <div>
              <dt>{t("docinfo.contains")}</dt>
              <dd>{t(`docinfo.contains.${doc}`)}</dd>
            </div>
            <div>
              <dt>{t("docinfo.why")}</dt>
              <dd>{t(`docinfo.why.${doc}`)}</dd>
            </div>
            <div>
              <dt>{t("docinfo.formats")}</dt>
              <dd>{t("docinfo.formats.value")}</dd>
            </div>
            <div>
              <dt>{t("docinfo.checks")}</dt>
              <dd>{t(`docinfo.checks.${doc}`)}</dd>
            </div>
            <div>
              <dt>{t("docinfo.unreadable")}</dt>
              <dd>{t("docinfo.unreadable.value")}</dd>
            </div>
            <div>
              <dt>{t("docinfo.lookup")}</dt>
              <dd>{t(view.need === "required" ? `docinfo.lookup.${doc}` : "docinfo.lookup.notNeeded")}</dd>
            </div>
          </dl>
        </details>
      )}
      {!locked && (
        <div className="kyc-doc__actions">
          <input id={inputId} type="file" accept={ACCEPTED_IMAGES} className="visually-hidden" disabled={busy} onChange={(e) => void pick(e)} />
          <label htmlFor={inputId} className={`button-secondary button-small${busy ? " is-disabled" : ""}`}>
            {t(view.uploaded ? "kyc.reupload" : "kyc.upload")}
          </label>
          {view.uploaded && (
            <button type="button" className="link-button" disabled={busy} onClick={() => void remove()}>
              {t("kyc.remove")}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function IssueList({ title, issues }: { title: string; issues: KycIssue[] }) {
  const { t, lang } = useI18n();
  if (issues.length === 0) return null;
  return (
    <>
      <p className="kyc-result__list-title">{title}</p>
      <ul className="kyc-issues">
        {issues.map((issue, i) => (
          <li key={`${issue.code}-${issue.doc ?? ""}-${i}`} data-code={issue.code}>
            {issueText(issue, t, lang)}
          </li>
        ))}
      </ul>
    </>
  );
}

export function KycResult({ kyc }: { kyc: KycCase }) {
  const { t, lang } = useI18n();
  const { result } = kyc;
  const fixes = result.issues.filter((i) => i.severity === "fix");
  const reviews = result.issues.filter((i) => i.severity === "review");
  return (
    <section className={`card kyc-result kyc-result--${result.status}`} aria-live="polite" aria-labelledby="kyc-result-title" data-testid="kyc-result">
      <p className="muted small">{t("kyc.result.title")}</p>
      <h3 id="kyc-result-title" className="card__title">
        {t(`kyc.result.${result.status}`)}
      </h3>
      {result.status !== "not_started" && <p>{t(`kyc.result.${result.status}.body` as MessageKey)}</p>}
      {result.review?.decision === "approved" && <p className="kyc-review">{t("kyc.result.approved", { date: formatDate(result.review.on, lang) })}</p>}
      {result.review?.note && <p className="kyc-review">{t("kyc.result.reviewNote", { note: result.review.note })}</p>}
      <IssueList title={t("kyc.result.fixList")} issues={fixes} />
      {/* Once a reviewer approved, the review items are settled; they stay listed for a rejection. */}
      {result.review?.decision !== "approved" && <IssueList title={t("kyc.result.reviewList")} issues={reviews} />}
      {result.blockedProducts.length > 0 && (
        <p className="kyc-blocked">{t("kyc.result.blocked", { products: result.blockedProducts.map((p) => p.name).join(", ") })}</p>
      )}
      {result.warnings.length > 0 && (
        <details className="kyc-warnings">
          <summary>{t("kyc.warnings.title")}</summary>
          <ul>
            {result.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`} data-code={w.code}>
                {issueText(w, t, lang)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function KycDocuments({
  kyc,
  onChange,
  onEdit,
  onSign,
  progress,
  fetchFn,
}: {
  kyc: KycCase;
  onChange: (k: KycCase) => void;
  onEdit: () => void;
  onSign: () => void;
  /** DEMO sample upload in progress: "n of total". */
  progress: { n: number; total: number } | null;
  fetchFn?: typeof fetch;
}) {
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const { gst, udyam } = kyc.registry;
  const busy = checking || progress !== null;

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      onChange(await submitKyc(kyc.caseId, fetchFn));
    } catch (err) {
      setError(err instanceof KycError && err.code === "network" ? "kyc.network" : "kyc.error");
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <section className="card" aria-labelledby="kyc-registry-title">
        <div className="kyc-doc__head">
          <h2 id="kyc-registry-title" className="card__title">
            {gst ? t("kyc.registry.title") : t("kyc.business.title")}
          </h2>
          {gst && <span className="mock-badge">{t("kyc.registry.mock")}</span>}
        </div>
        {gst ? (
          <dl className="kyc-read">
            <div>
              <dt>{t("kyc.registry.gstin")}</dt>
              <dd className="code">{gst.gstin}</dd>
            </div>
            <div>
              <dt>{t("kyc.registry.legalName")}</dt>
              <dd>{gst.legalName}</dd>
            </div>
            <div>
              <dt>{t("kyc.registry.tradeName")}</dt>
              <dd>{gst.tradeName}</dd>
            </div>
            <div>
              <dt>{t("kyc.registry.constitution")}</dt>
              <dd>{gst.constitution}</dd>
            </div>
            <div>
              <dt>{t("kyc.registry.address")}</dt>
              <dd>{gst.address}</dd>
            </div>
            <div>
              <dt>{t("kyc.registry.status")}</dt>
              <dd>
                <span className={`status-badge status-badge--${gst.status === "Active" ? "ok" : "down"}`}>
                  {t(`kyc.gstStatus.${gst.status}` as MessageKey)}
                </span>
              </dd>
            </div>
            {udyam && (
              <div>
                <dt>{t("kyc.registry.udyam")}</dt>
                <dd>
                  <span className="code">{udyam.udyamNumber}</span> · {udyam.enterpriseName}
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="muted">{t(kyc.business?.gstin ? "kyc.registry.notFound" : "kyc.registry.noGstin")}</p>
        )}
        {!busy && (
          <button type="button" className="link-button" onClick={onEdit}>
            {t("kyc.editDetails")}
          </button>
        )}
      </section>

      <section className="card" aria-labelledby="kyc-docs-title">
        <h2 id="kyc-docs-title" className="card__title">
          {t("kyc.docs.title")}
        </h2>
        <p className="muted small">{t("kyc.docs.intro")}</p>
        {progress && (
          <p className="muted" role="status">
            {t("kyc.sample.uploading", { n: progress.n, total: progress.total })}
          </p>
        )}
        <ul className="kyc-docs">
          {DOC_TYPES.map((doc) => (
            <DocSlot key={doc} kyc={kyc} doc={doc} onChange={onChange} locked={busy} fetchFn={fetchFn} />
          ))}
        </ul>
        {error && (
          <p className="field-error" role="alert">
            {t(error)}
          </p>
        )}
        <button type="button" className="button-primary" disabled={busy} onClick={() => void check()}>
          {t(checking ? "kyc.checking" : "kyc.check")}
        </button>
      </section>

      {(kyc.submitted || kyc.result.issues.length > 0) && <KycResult kyc={kyc} />}

      {kyc.submitted && kyc.result.status === "pass" && (
        <button type="button" className="button-primary" onClick={onSign}>
          {t("kyc.result.sign")}
        </button>
      )}
    </>
  );
}
