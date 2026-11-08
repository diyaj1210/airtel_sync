import type { Band, Score, Staff } from "../../api/backoffice";
import { en, type MessageKey } from "../../i18n/en";
import { useI18n, type Translate } from "../../i18n/I18nProvider";

/** Shared pieces of the back-office tabs: filter bar, score badge, value labels. */

export type StaffNames = (code: string) => string;

export function staffNames(accounts: Staff[]): StaffNames {
  const byCode = new Map(accounts.map((a) => [a.code, a.name]));
  return (code) => byCode.get(code) ?? code;
}

/** The translated label for a code, or the code itself when there is no label for it. */
const KNOWN = (t: Translate, prefix: string, value: string) => {
  const key = `${prefix}.${value}`;
  return key in en ? t(key as MessageKey) : value;
};

/** How a filter value is shown (the API sends codes). */
export function valueLabel(filter: string, value: string, t: Translate, names: StaffNames): string {
  switch (filter) {
    case "attribution":
      return value === "none" ? t("bo.none") : names(value);
    case "assignedTo":
      return value === "none" ? t("bo.unassigned") : names(value);
    case "reason":
      return KNOWN(t, "bo.reason", value);
    case "segment":
      return KNOWN(t, "segment", value);
    case "band":
      return KNOWN(t, "bo.band", value);
    case "status":
      return KNOWN(t, "bo.status", value);
    case "queue":
      return KNOWN(t, "bo.kyc.status", value);
    default:
      return value;
  }
}

export interface FilterDef {
  name: string;
  label: MessageKey;
  values: string[];
  /** Which labels its values use, when not the same as the name (see valueLabel). */
  kind?: string;
}

export function FilterBar({
  idPrefix,
  filters,
  value,
  onChange,
  names,
}: {
  idPrefix: string;
  filters: FilterDef[];
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  names: StaffNames;
}) {
  const { t } = useI18n();
  const active = Object.values(value).some((v) => v !== "");
  return (
    <fieldset className="bo-filters">
      <legend className="bo-filters__title">{t("bo.filters")}</legend>
      {filters.map((f) => (
        <label key={f.name} className="bo-filter" htmlFor={`${idPrefix}-${f.name}`}>
          <span className="field__label">{t(f.label)}</span>
          <select
            id={`${idPrefix}-${f.name}`}
            className="input"
            value={value[f.name] ?? ""}
            onChange={(e) => onChange({ ...value, [f.name]: e.target.value })}
          >
            <option value="">{t("bo.filter.all")}</option>
            {f.values.map((v) => (
              <option key={v} value={v}>
                {valueLabel(f.kind ?? f.name, v, t, names)}
              </option>
            ))}
            {/* Keep a chosen value visible even when the current data no longer has it. */}
            {value[f.name] && !f.values.includes(value[f.name]!) && <option value={value[f.name]}>{value[f.name]}</option>}
          </select>
        </label>
      ))}
      {active && (
        <button type="button" className="link-button" onClick={() => onChange({})}>
          {t("bo.filter.clear")}
        </button>
      )}
    </fieldset>
  );
}

const BAND_CLASS: Record<Band, string> = { high: "ok", medium: "unknown", low: "down" };

export function ScoreCell({ score }: { score: Score | null }) {
  const { t } = useI18n();
  if (!score) return <span className="muted small">{t("bo.noScore")}</span>;
  return (
    <div className="bo-score">
      <span className={`status-badge status-badge--${BAND_CLASS[score.band]}`} data-band={score.band}>
        {t("bo.score", { score: score.score })} · {t(`bo.band.${score.band}`)}
      </span>
      <span className="small bo-score__action">{t(`bo.action.${score.nextAction}`)}</span>
      {score.reasons.length > 0 && (
        <details className="bo-score__why">
          <summary className="small">{t("bo.reasons")}</summary>
          <ul className="small">
            {score.reasons.map((r) => (
              <li key={r.feature}>
                {KNOWN(t, "bo.feature", r.feature)}: {r.value} {r.effect === "up" ? "↑" : "↓"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <section className="card card--alert" role="alert">
      <p>{t("bo.error")}</p>
      <button type="button" className="button-secondary" onClick={onRetry}>
        {t("bo.retry")}
      </button>
    </section>
  );
}
