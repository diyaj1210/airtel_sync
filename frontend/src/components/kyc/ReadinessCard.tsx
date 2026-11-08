import { useState, type FormEvent } from "react";
import {
  answerQuestion,
  chooseAlternative,
  confirmGstin,
  KycError,
  ownerSigns,
  sendOwnerLink,
  type Blocker,
  type DocType,
  type KycCase,
  type Readiness,
} from "../../api/kyc";
import { formatDate, formatInr } from "../../format";
import type { MessageKey } from "../../i18n/en";
import { useI18n } from "../../i18n/I18nProvider";

/**
 * One-Sitting Completion card: where the owner stands, what could stop them and, for every
 * problem, the fix (No Dead Ends). It is a completion check, not an approval or a risk score.
 */

const STATE_CLASS: Record<Readiness["state"], string> = {
  READY: "ok",
  ALMOST_READY: "unknown",
  NEEDS_REVIEW: "unknown",
  PARTNER_ASSISTANCE_RECOMMENDED: "unknown",
  NOT_CURRENTLY_POSSIBLE: "down",
};

const isOpen = (b: Blocker) => b.status === "open" || b.status === "in_progress";

function BlockerActions({
  blocker,
  kyc,
  onChange,
  onUpload,
  onGetQuote,
  fetchFn,
}: {
  blocker: Blocker;
  kyc: KycCase;
  onChange: (k: KycCase) => void;
  onUpload?: (doc: DocType) => void;
  onGetQuote?: () => void;
  fetchFn?: typeof fetch;
}) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [ownerCode, setOwnerCode] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [answer, setAnswer] = useState("");

  const run = async (action: () => Promise<KycCase>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
    } catch (err) {
      setError(err instanceof KycError && err.code === "wrong_otp" ? "ready.wrongCode" : err instanceof KycError && err.code === "network" ? "kyc.network" : "kyc.error");
    } finally {
      setBusy(false);
    }
  };

  const sendLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await sendOwnerLink(kyc.caseId, fetchFn);
      setOwnerCode(r.otp);
      onChange(r.case);
    } catch {
      setError("kyc.error");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    void run(() => ownerSigns(kyc.caseId, codeInput.trim(), fetchFn));
  };
  const submitAnswer = (e: FormEvent) => {
    e.preventDefault();
    if (answer.trim()) void run(() => answerQuestion(kyc.caseId, blocker.id, answer.trim(), fetchFn));
  };

  const id = blocker.id.replace(/[^A-Za-z0-9]/g, "-");
  return (
    <div className="blocker__actions">
      {blocker.actionType === "upload" && blocker.doc && onUpload && (
        <button type="button" className="button-secondary button-small" onClick={() => onUpload(blocker.doc!)}>
          {t("ready.action.upload", { doc: t(`kyc.doc.${blocker.doc}`) })}
        </button>
      )}
      {blocker.actionType === "confirm" && blocker.suggestion && (
        <button type="button" className="button-primary button-small" disabled={busy} onClick={() => void run(() => confirmGstin(kyc.caseId, fetchFn))}>
          {t("ready.action.confirm")}
        </button>
      )}
      {blocker.actionType === "choose_alternative" &&
        (blocker.alternative ? (
          <button type="button" className="button-primary button-small" disabled={busy} onClick={() => void run(() => chooseAlternative(kyc.caseId, blocker.alternative!.kind, fetchFn))}>
            {t("ready.action.alternative", { bundle: blocker.alternative.bundle, price: formatInr(blocker.alternative.monthlyInr) })}
          </button>
        ) : (
          onGetQuote && (
            <button type="button" className="button-secondary button-small" onClick={onGetQuote}>
              {t("ready.action.getQuote")}
            </button>
          )
        ))}
      {blocker.actionType === "send_esign_link" && (
        <>
          {blocker.status === "open" && !ownerCode && (
            <button type="button" className="button-primary button-small" disabled={busy} onClick={() => void sendLink()}>
              {t("ready.action.sendLink")}
            </button>
          )}
          {(ownerCode || blocker.status === "in_progress") && (
            <form className="card--demo blocker__demo" onSubmit={submitCode}>
              <p className="small">
                <span className="mock-badge">MOCK</span> {t("ready.action.ownerSigns")}
              </p>
              {ownerCode && <p className="small">{t("ready.action.ownerCode", { code: ownerCode })}</p>}
              <label className="field__label" htmlFor={`code-${id}`}>
                {t("ready.action.codeLabel")}
              </label>
              <input id={`code-${id}`} className="input input--code" inputMode="numeric" maxLength={6} value={codeInput} onChange={(e) => setCodeInput(e.target.value)} />
              <button type="submit" className="button-secondary button-small" disabled={busy || !/^\d{6}$/.test(codeInput.trim())}>
                {t("ready.action.sign")}
              </button>
            </form>
          )}
        </>
      )}
      {blocker.actionType === "wait_review" && blocker.question && (
        <form className="blocker__question" onSubmit={submitAnswer}>
          <p className="small">
            <strong>{t("ready.question")}</strong> {blocker.question[lang]}
          </p>
          {blocker.answer ? (
            <p className="small">{t("ready.answered", { answer: blocker.answer })}</p>
          ) : (
            <>
              <label className="field__label" htmlFor={`answer-${id}`}>
                {t("ready.answerLabel")}
              </label>
              <textarea id={`answer-${id}`} className="input" rows={2} maxLength={300} value={answer} onChange={(e) => setAnswer(e.target.value)} />
              <button type="submit" className="button-secondary button-small" disabled={busy || !answer.trim()}>
                {t("ready.action.answer")}
              </button>
            </>
          )}
        </form>
      )}
      {error && (
        <p className="field-error" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}

export function BlockerList({
  blockers,
  kyc,
  onChange,
  onUpload,
  onGetQuote,
  fetchFn,
  title,
}: {
  blockers: Blocker[];
  kyc?: KycCase;
  onChange?: (k: KycCase) => void;
  onUpload?: (doc: DocType) => void;
  onGetQuote?: () => void;
  fetchFn?: typeof fetch;
  title?: MessageKey;
}) {
  const { t, lang } = useI18n();
  const open = blockers.filter(isOpen);
  if (open.length === 0) return null;
  return (
    <div className="blockers">
      <p className="kyc-result__list-title">{t(title ?? "ready.blockers")}</p>
      <ul className="blockers__list">
        {open.map((b) => (
          <li key={b.id} className={`blocker blocker--${b.hard ? "hard" : b.responsibleParty}`} data-blocker={b.id}>
            <p className="blocker__message">{b.customerMessage[lang]}</p>
            <p className="blocker__action">
              <strong>{t("ready.whatToDo")}</strong> {b.requiredAction[lang]}
            </p>
            <p className="small muted">
              {t("ready.who", { who: t(`ready.party.${b.responsibleParty}`) })} · {b.expectedResolution[lang]}
            </p>
            {kyc && onChange && <BlockerActions blocker={b} kyc={kyc} onChange={onChange} onUpload={onUpload} onGetQuote={onGetQuote} fetchFn={fetchFn} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReadinessCard({
  readiness,
  kyc,
  onChange,
  onUpload,
  onGetQuote,
  fetchFn,
  preview = false,
}: {
  readiness: Readiness;
  kyc?: KycCase;
  onChange?: (k: KycCase) => void;
  onUpload?: (doc: DocType) => void;
  onGetQuote?: () => void;
  fetchFn?: typeof fetch;
  /** On the lookup screen, before consent: no actions yet. */
  preview?: boolean;
}) {
  const { t, lang } = useI18n();
  const r = readiness;
  const remaining = r.remaining.map((g) => t(`ready.group.${g}`));
  const review = r.blockers.find((b) => isOpen(b) && b.responsibleParty === "accel_ops");
  return (
    <section className={`card readiness readiness--${STATE_CLASS[r.state]}`} aria-labelledby="readiness-title" data-testid="readiness" data-state={r.state}>
      <h2 id="readiness-title" className="card__title">
        {t("ready.title", { state: t(`ready.state.${r.state}`) })}
      </h2>
      <p className="readiness__percent">
        {t("ready.percent", { percent: r.percent, verified: r.verified, total: r.applicable })}{" "}
        {remaining.length === 1 ? t("ready.remainingOne", { item: remaining[0]! }) : remaining.length > 1 ? t("ready.remainingMany", { items: remaining.join(", ") }) : ""}
      </p>
      <div className="readiness__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.percent} aria-label={t("ready.barLabel")}>
        <span style={{ width: `${r.percent}%` }} />
      </div>
      {r.state === "NOT_CURRENTLY_POSSIBLE" && r.alternative && r.bundle && (
        <p className="readiness__alt">{t("ready.notPossibleAlt", { bundle: r.bundle, alt: r.alternative.bundle, state: t(`ready.state.${r.alternative.state}`) })}</p>
      )}
      {r.found.length > 0 && (
        <p className="small">
          <strong>{t("ready.found")}</strong> {r.found.map((f) => `${t(`ready.found.${f.key}`)}: ${f.value}`).join(" · ")}
        </p>
      )}
      {r.documentsToUpload.length > 0 && (
        <p className="small">
          <strong>{t("ready.stillNeeded")}</strong> {r.documentsToUpload.map((d) => t(`kyc.doc.${d}`)).join(", ")}
        </p>
      )}
      {r.optional.includes("udyam") && <p className="small muted">{t("ready.optional.udyam")}</p>}
      <p className="small">{t("ready.time", { minutes: r.expectedMinutes })}</p>
      {r.after && (
        <p className="small">
          {r.after.window
            ? t("ready.afterWindow", { from: r.after.window.from, to: r.after.window.to })
            : t("ready.after", { days: r.after.days, date: formatDate(r.after.readyOn, lang), start: formatDate(r.after.start, lang) })}
        </p>
      )}
      {r.after && r.after.dayOne.length > 0 && <p className="small">{t("ready.dayOne", { products: r.after.dayOne.join(", ") })}</p>}
      {r.feasibility.known && (
        <p className="small muted">
          <span className="mock-badge">MOCK</span> {t(r.feasibility.fibre ? "ready.coverage.ok" : "ready.coverage.no", { city: r.feasibility.city ?? "" })}
        </p>
      )}
      {r.partner && <p className="small">{t("ready.partner", { partner: r.partner.name })}</p>}
      {review && <p className="small">{t("ready.review", { hours: r.reviewWithinHours })}</p>}
      <BlockerList blockers={r.blockers} kyc={preview ? undefined : kyc} onChange={onChange} onUpload={onUpload} onGetQuote={onGetQuote} fetchFn={fetchFn} />
      <p className="muted small">{t("ready.notApproval")}</p>
    </section>
  );
}

/** Problems already sorted out (for the documents screen). */
export function BlockerHistory({ history }: { history: Blocker[] }) {
  const { t, lang } = useI18n();
  if (history.length === 0) return null;
  return (
    <details className="kyc-warnings">
      <summary>{t("ready.history", { n: history.length })}</summary>
      <ul>
        {history.map((b) => (
          <li key={`${b.id}-${b.resolvedOn}`}>
            {b.customerMessage[lang]} · {t(b.resolvedBy === "staff" ? "ready.waived" : "ready.resolved", { date: b.resolvedOn ? formatDate(b.resolvedOn, lang) : "" })}
          </li>
        ))}
      </ul>
    </details>
  );
}
