import { useState, type FormEvent } from "react";
import type { Lookup } from "../../api/kyc";
import type { MessageKey } from "../../i18n/en";
import { useI18n } from "../../i18n/I18nProvider";
import { ReadinessCard } from "./ReadinessCard";

/**
 * Lookup first (privacy feature): what the public registries already told us, and the documents
 * that are still needed - before the owner is asked to consent to anything or upload anything.
 */
export function KycLookup({ lookup, onContinue, onChange }: { lookup: Lookup; onContinue: () => void; onChange: () => void }) {
  const { t } = useI18n();
  const gst = lookup.registry.gst;
  const udyam = lookup.registry.udyam;
  const needed = lookup.documentsNeeded.map((d) => t(`kyc.doc.${d}`));
  return (
    <>
      <section className="card" aria-labelledby="lookup-title">
        <div className="kyc-doc__head">
          <h2 id="lookup-title" className="card__title">
            {t(gst || udyam ? "lookup.found" : "lookup.notFound")}
          </h2>
          <span className="mock-badge">{t("kyc.registry.mock")}</span>
        </div>
        {gst && (
          <dl className="kyc-read">
            <div>
              <dt>{t("kyc.registry.legalName")}</dt>
              <dd>{gst.legalName}</dd>
            </div>
            <div>
              <dt>{t("kyc.registry.address")}</dt>
              <dd>{gst.address}</dd>
            </div>
            <div>
              <dt>{t("lookup.gstStatus")}</dt>
              <dd>
                <span className={`status-badge status-badge--${gst.status === "Active" ? "ok" : "down"}`}>{t(`kyc.gstStatus.${gst.status}` as MessageKey)}</span>
              </dd>
            </div>
            <div>
              <dt>{t("kyc.registry.gstin")}</dt>
              <dd className="code">{gst.gstin}</dd>
            </div>
          </dl>
        )}
        {!gst && udyam && (
          <p>
            {udyam.enterpriseName} · {udyam.city}, {udyam.state} (<span className="code">{udyam.udyamNumber}</span>)
          </p>
        )}
        <p className="lookup__summary">
          {lookup.documentsNotNeeded > 0 ? t("lookup.notNeeded", { n: lookup.documentsNotNeeded }) : ""}{" "}
          {needed.length === 1 ? t("lookup.onlyOne", { doc: needed[0]! }) : t("lookup.remaining", { docs: needed.join(", ") })}
        </p>
        <button type="button" className="button-primary" onClick={onContinue}>
          {t("lookup.continue")}
        </button>
        <button type="button" className="link-button" onClick={onChange}>
          {t("lookup.change")}
        </button>
      </section>
      {lookup.readiness && <ReadinessCard readiness={lookup.readiness} preview />}
    </>
  );
}

/** After consent: the name of the person applying (as on their ID). */
export function KycName({ onSave }: { onSave: (name: string) => Promise<void> }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[\p{L}][\p{L} .'-]{1,79}$/u.test(name.trim())) return setError("kyc.business.nameError");
    setBusy(true);
    setError(null);
    try {
      await onSave(name.trim());
    } catch {
      setError("kyc.error");
      setBusy(false);
    }
  };
  return (
    <form className="card form" onSubmit={(e) => void submit(e)} noValidate aria-labelledby="kyc-name-title">
      <h2 id="kyc-name-title" className="card__title">
        {t("kyc.name.title")}
      </h2>
      <label className="field__label" htmlFor="kyc-name">
        {t("kyc.business.name")}
      </label>
      <input
        id="kyc-name"
        className="input"
        autoComplete="name"
        maxLength={80}
        value={name}
        aria-invalid={error === "kyc.business.nameError" ? true : undefined}
        onChange={(e) => setName(e.target.value)}
      />
      {error && (
        <p className="field-error" role="alert">
          {t(error)}
        </p>
      )}
      <button type="submit" className="button-primary" disabled={busy}>
        {t(busy ? "kyc.business.saving" : "kyc.name.continue")}
      </button>
    </form>
  );
}
