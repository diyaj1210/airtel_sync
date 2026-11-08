import { useState, type FormEvent } from "react";
import { isIndianMobile, LEAD_REASONS, saveLead, type NotInterestedReason } from "../api/advisor";
import { useI18n } from "../i18n/I18nProvider";

/**
 * "Talk to a person" (call back) and "Not for me" (why not). Both save a lead for the back-office.
 * A phone number is asked only for a call back, with explicit consent, and is shown masked
 * everywhere after it is sent.
 */
export function LeadForm({
  kind,
  sessionId,
  onSaved,
  onCancel,
  fetchFn,
}: {
  kind: "handoff" | "not_interested";
  sessionId: string;
  onSaved: (leadId: string) => void;
  onCancel: () => void;
  fetchFn?: typeof fetch;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState<NotInterestedReason | "">("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ reason?: string; phone?: string; consent?: string }>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const handoff = kind === "handoff";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    const wantsCall = handoff || phone.trim() !== "";
    if (!handoff && !reason) next.reason = t("lead.reasonError");
    if (wantsCall && !isIndianMobile(phone)) next.phone = t("lead.phoneError");
    if (wantsCall && !consent) next.consent = t("lead.consentError");
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    setFailed(false);
    saveLead(
      sessionId,
      {
        reason: handoff ? "asked_for_human" : (reason as NotInterestedReason),
        ...(wantsCall ? { phone: phone.trim(), callbackConsent: true } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      fetchFn,
    ).then(
      (r) => onSaved(r.leadId),
      () => {
        setFailed(true);
        setSaving(false);
      },
    );
  };

  return (
    <form className="card form lead-form" onSubmit={submit} noValidate aria-labelledby="lead-title">
      <h3 id="lead-title" className="card__title">
        {t(handoff ? "lead.handoff.title" : "lead.notInterested.title")}
      </h3>

      {!handoff && (
        <fieldset className="field">
          <legend className="visually-hidden">{t("lead.notInterested.title")}</legend>
          {LEAD_REASONS.map((r) => (
            <label key={r} className="radio-row">
              <input type="radio" name="lead-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
              {t(`lead.reason.${r}`)}
            </label>
          ))}
          {errors.reason && <p className="field-error">{errors.reason}</p>}
        </fieldset>
      )}

      <div className="field">
        <label className="field__label" htmlFor="lead-phone">
          {t(handoff ? "lead.phone" : "lead.callMeToo")}
        </label>
        <input
          id="lead-phone"
          className="input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={16}
          value={phone}
          aria-invalid={errors.phone ? true : undefined}
          aria-describedby={errors.phone ? "lead-phone-error" : undefined}
          onChange={(e) => setPhone(e.target.value)}
        />
        {errors.phone && (
          <p id="lead-phone-error" className="field-error">
            {errors.phone}
          </p>
        )}
      </div>

      <label className="radio-row">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={errors.consent ? true : undefined} />
        {t("lead.consent")}
      </label>
      {errors.consent && <p className="field-error">{errors.consent}</p>}

      <div className="field">
        <label className="field__label" htmlFor="lead-note">
          {t("lead.note")}
        </label>
        <input id="lead-note" className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {failed && (
        <p className="field-error" role="alert">
          {t("lead.error")}
        </p>
      )}
      <button type="submit" className="button-primary" disabled={saving}>
        {t(handoff ? "lead.submit" : "lead.submitReason")}
      </button>
      <button type="button" className="link-button" onClick={onCancel}>
        {t("lead.cancel")}
      </button>
    </form>
  );
}
