import { useEffect, useState, type FormEvent } from "react";
import { gstinProblem, KycError, listSamples, udyamProblem, type Sample } from "../../api/kyc";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/en";

type Errors = Partial<Record<"gstin" | "udyamNumber" | "form", string>>;

/** The business identifiers looked up first (public registries), before consent and before any name or document. */
export interface Identifiers {
  gstin: string | null;
  hasUdyam: boolean;
  udyamNumber: string | null;
}

/**
 * Step 1 of KYC (lookup first): GSTIN (or "no GSTIN") and Udyam yes/no (+ optional number). These
 * are business identifiers in public registries; the person's name and documents come only after
 * consent. A DEMO box picks one of the 12 sample applicants instead.
 */
export function KycBusiness({
  onSave,
  onSample,
  fetchFn,
}: {
  onSave: (input: Identifiers) => Promise<void>;
  onSample: (sampleId: string) => Promise<void>;
  fetchFn?: typeof fetch;
}) {
  const { t } = useI18n();
  const [gstin, setGstin] = useState("");
  const [noGstin, setNoGstin] = useState(false);
  const [hasUdyam, setHasUdyam] = useState<boolean | null>(null);
  const [udyam, setUdyam] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [sampleId, setSampleId] = useState("");

  useEffect(() => {
    let live = true;
    listSamples(fetchFn).then(
      (list) => live && setSamples(list),
      () => undefined, // the demo box simply stays hidden
    );
    return () => {
      live = false;
    };
  }, [fetchFn]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      if (err instanceof KycError && err.details.length > 0) {
        const next: Errors = {};
        for (const d of err.details) {
          if (d.field === "gstin") next.gstin = t(`kyc.business.gstin.${d.problem}` as MessageKey);
          else if (d.field === "udyamNumber") next.udyamNumber = t("kyc.business.udyam.format");
        }
        setErrors(next);
      } else {
        setErrors({ form: t(err instanceof KycError && err.code === "network" ? "kyc.network" : "kyc.error") });
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    if (!noGstin) {
      const problem = gstinProblem(gstin);
      if (problem) next.gstin = t(`kyc.business.gstin.${problem}`);
    }
    if (hasUdyam === null) next.form = t("form.errorRequired");
    if (hasUdyam && udyam.trim() && udyamProblem(udyam)) next.udyamNumber = t("kyc.business.udyam.format");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    void run(() =>
      onSave({
        gstin: noGstin ? null : gstin.trim(),
        hasUdyam: hasUdyam === true,
        udyamNumber: hasUdyam && udyam.trim() ? udyam.trim() : null,
      }),
    );
  };

  return (
    <>
      <form className="card form" onSubmit={submit} noValidate aria-labelledby="kyc-business-title">
        <h2 id="kyc-business-title" className="card__title">
          {t("kyc.business.title")}
        </h2>
        <p className="muted">{t("kyc.business.intro")}</p>

        <div className="field">
          <label className="field__label" htmlFor="kyc-gstin">
            {t("kyc.business.gstin")}
          </label>
          <input
            id="kyc-gstin"
            className="input input--code"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            disabled={noGstin}
            value={gstin}
            placeholder={t("kyc.business.gstinHint")}
            aria-invalid={errors.gstin ? true : undefined}
            aria-describedby={errors.gstin ? "kyc-gstin-error" : undefined}
            onChange={(e) => setGstin(e.target.value.toUpperCase())}
          />
          {errors.gstin && (
            <p id="kyc-gstin-error" className="field-error">
              {errors.gstin}
            </p>
          )}
          <label className="radio-row">
            <input type="checkbox" checked={noGstin} onChange={(e) => setNoGstin(e.target.checked)} />
            {t("kyc.business.noGstin")}
          </label>
        </div>

        <fieldset className="field">
          <legend className="field__label">{t("kyc.business.hasUdyam")}</legend>
          <div className="choice-row">
            {([true, false] as const).map((v) => (
              <label key={String(v)} className={`choice choice--small${hasUdyam === v ? " choice--on" : ""}`}>
                <input type="radio" name="kyc-has-udyam" checked={hasUdyam === v} onChange={() => setHasUdyam(v)} />
                <span className="choice__title">{t(v ? "kyc.yes" : "kyc.no")}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {hasUdyam && (
          <div className="field">
            <label className="field__label" htmlFor="kyc-udyam">
              {t("kyc.business.udyam")}
            </label>
            <input
              id="kyc-udyam"
              className="input input--code"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={25}
              value={udyam}
              aria-invalid={errors.udyamNumber ? true : undefined}
              aria-describedby="kyc-udyam-hint"
              onChange={(e) => setUdyam(e.target.value.toUpperCase())}
            />
            <p id="kyc-udyam-hint" className="muted small">
              {t("kyc.business.udyamHint")}
            </p>
            {errors.udyamNumber && <p className="field-error">{errors.udyamNumber}</p>}
          </div>
        )}

        {errors.form && (
          <p className="field-error" role="alert">
            {errors.form}
          </p>
        )}
        <button type="submit" className="button-primary" disabled={busy}>
          {t(busy ? "kyc.business.saving" : "kyc.business.save")}
        </button>
      </form>

      {samples.length > 0 && (
        <section className="card card--demo" aria-labelledby="kyc-sample-title">
          <h3 id="kyc-sample-title" className="card__title">
            {t("kyc.sample.title")}
          </h3>
          <p className="muted small">{t("kyc.sample.hint")}</p>
          <label className="visually-hidden" htmlFor="kyc-sample">
            {t("kyc.sample.choose")}
          </label>
          <select id="kyc-sample" className="input" value={sampleId} onChange={(e) => setSampleId(e.target.value)}>
            <option value="">{t("kyc.sample.choose")}</option>
            {samples.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} · {s.businessName}
              </option>
            ))}
          </select>
          <button type="button" className="button-secondary" disabled={!sampleId || busy} onClick={() => void run(() => onSample(sampleId))}>
            {t("kyc.sample.use")}
          </button>
        </section>
      )}
    </>
  );
}
