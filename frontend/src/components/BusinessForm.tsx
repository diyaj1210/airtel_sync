import { useEffect, useState, type FormEvent } from "react";
import { fetchCities, type BusinessProfile, type City, type GstinStatus, type Segment } from "../api/quote";
import type { MessageKey } from "../i18n/en";
import { useI18n } from "../i18n/I18nProvider";

export const OTHER_CITY = "__other__";
const SEGMENTS: Segment[] = ["micro", "prof", "multi", "mfg"];
const GSTIN_OPTIONS: GstinStatus[] = ["active", "inactive", "none"];
const LIMITS = { employees: { min: 1, max: 100_000 }, sites: { min: 1, max: 1_000 } };

export interface FormValues {
  segment: Segment | "";
  city: string;
  employees: string;
  sites: string;
  gstin: GstinStatus | "";
}

export const EMPTY_FORM: FormValues = { segment: "", city: "", employees: "", sites: "1", gstin: "" };

type Errors = Partial<Record<keyof FormValues, string>>;

function parseWhole(raw: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= min && n <= max ? n : null;
}

/**
 * The facts the rules engine needs. A city not in the list is treated as tier 2: tier-2 rules
 * are the stricter set, so the quote can never contain a product the business cannot buy.
 */
export function toProfile(values: FormValues, cities: City[]): BusinessProfile | null {
  const employees = parseWhole(values.employees, LIMITS.employees.min, LIMITS.employees.max);
  const sites = parseWhole(values.sites, LIMITS.sites.min, LIMITS.sites.max);
  const city = cities.find((c) => c.name === values.city);
  if (!values.gstin || employees === null || sites === null || (!city && values.city !== OTHER_CITY)) return null;
  return { cityTier: city ? city.tier : 2, employees, sites, gstin: values.gstin };
}

export function BusinessForm({
  initial,
  onSubmit,
  fetchFn,
}: {
  initial: FormValues;
  onSubmit: (values: FormValues, segment: Segment, profile: BusinessProfile) => void;
  fetchFn?: typeof fetch;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [cities, setCities] = useState<City[] | null>(null);
  const [citiesFailed, setCitiesFailed] = useState(false);

  const loadCities = () => {
    setCitiesFailed(false);
    fetchCities(fetchFn).then(setCities, () => setCitiesFailed(true));
  };
  // Load once per fetch function (loadCities only uses fetchFn).
  useEffect(loadCities, [fetchFn]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!cities) return;
    const next: Errors = {};
    if (!values.segment) next.segment = t("form.errorRequired");
    if (!values.city) next.city = t("form.errorRequired");
    if (!values.gstin) next.gstin = t("form.errorRequired");
    if (parseWhole(values.employees, LIMITS.employees.min, LIMITS.employees.max) === null) {
      next.employees = t("form.errorNumber", LIMITS.employees);
    }
    if (parseWhole(values.sites, LIMITS.sites.min, LIMITS.sites.max) === null) {
      next.sites = t("form.errorNumber", LIMITS.sites);
    }
    setErrors(next);
    const profile = toProfile(values, cities);
    if (Object.keys(next).length === 0 && profile && values.segment) onSubmit(values, values.segment, profile);
  };

  const errorId = (key: keyof FormValues) => (errors[key] ? `${key}-error` : undefined);
  const errorText = (field: keyof FormValues) =>
    errors[field] ? (
      <p id={`${field}-error`} className="field-error" role="alert">
        {errors[field]}
      </p>
    ) : null;

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h2 className="card__title">{t("form.title")}</h2>

      <fieldset className="field" aria-describedby={errorId("segment")}>
        <legend className="field__label">{t("form.segment")}</legend>
        <div className="choice-grid">
          {SEGMENTS.map((s) => (
            <label key={s} className={`choice ${values.segment === s ? "choice--on" : ""}`}>
              <input type="radio" name="segment" value={s} checked={values.segment === s} onChange={() => set("segment", s)} />
              <span className="choice__title">{t(`segment.${s}` as MessageKey)}</span>
              <span className="choice__hint">{t(`segment.${s}.hint` as MessageKey)}</span>
            </label>
          ))}
        </div>
        {errorText("segment")}
      </fieldset>

      <div className="field">
        <label className="field__label" htmlFor="city">
          {t("form.city")}
        </label>
        {cities ? (
          <select
            id="city"
            className="input"
            value={values.city}
            onChange={(e) => set("city", e.target.value)}
            aria-describedby={errorId("city")}
          >
            <option value="">{t("form.cityPlaceholder")}</option>
            {cities.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}, {c.state}
              </option>
            ))}
            <option value={OTHER_CITY}>{t("form.cityOther")}</option>
          </select>
        ) : citiesFailed ? (
          <p className="field-error" role="alert">
            {t("form.errorCities")}{" "}
            <button type="button" className="link-button" onClick={loadCities}>
              {t("quote.retry")}
            </button>
          </p>
        ) : (
          <p className="muted">{t("form.loadingCities")}</p>
        )}
        {values.city === OTHER_CITY && <p className="muted">{t("form.cityOtherNote")}</p>}
        {errorText("city")}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="employees">
          {t("form.employees")}
        </label>
        <input
          id="employees"
          className="input"
          type="number"
          inputMode="numeric"
          min={LIMITS.employees.min}
          max={LIMITS.employees.max}
          value={values.employees}
          onChange={(e) => set("employees", e.target.value)}
          aria-describedby={errorId("employees")}
          aria-invalid={Boolean(errors.employees)}
        />
        {errorText("employees")}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="sites">
          {t("form.sites")}
        </label>
        <input
          id="sites"
          className="input"
          type="number"
          inputMode="numeric"
          min={LIMITS.sites.min}
          max={LIMITS.sites.max}
          value={values.sites}
          onChange={(e) => set("sites", e.target.value)}
          aria-describedby={errorId("sites")}
          aria-invalid={Boolean(errors.sites)}
        />
        {errorText("sites")}
      </div>

      <fieldset className="field" aria-describedby={errorId("gstin")}>
        <legend className="field__label">{t("form.gstin")}</legend>
        {GSTIN_OPTIONS.map((g) => (
          <label key={g} className="radio-row">
            <input type="radio" name="gstin" value={g} checked={values.gstin === g} onChange={() => set("gstin", g)} />
            <span>{t(`gstin.${g}` as MessageKey)}</span>
          </label>
        ))}
        <p className="muted">{t("form.gstinNote")}</p>
        {errorText("gstin")}
      </fieldset>

      <button type="submit" className="button-primary" disabled={!cities}>
        {t("form.submit")}
      </button>
    </form>
  );
}
