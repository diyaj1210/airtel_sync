import { useState, type FormEvent } from "react";
import { KycError, startEsign, verifyEsign, type Agreement, type KycCase } from "../../api/kyc";
import { formatDate, formatInr } from "../../format";
import type { MessageKey } from "../../i18n/en";
import { useI18n } from "../../i18n/I18nProvider";

/**
 * MOCK e-sign (Aadhaar-OTP / DigiLocker style): review the agreement, get a one-time password,
 * type it to sign. The OTP is shown on screen; no SMS is sent and nothing is legally signed.
 */
export function KycEsign({ kyc, onSigned, fetchFn }: { kyc: KycCase; onSigned: (k: KycCase) => void; fetchFn?: typeof fetch }) {
  const { t, lang } = useI18n();
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [mockOtp, setMockOtp] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ key: MessageKey; left?: number } | null>(null);
  const [needNewCode, setNeedNewCode] = useState(false);

  const requestOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await startEsign(kyc.caseId, fetchFn);
      setAgreement(res.agreement);
      setMockOtp(res.otp);
      setOtp("");
      setNeedNewCode(false);
    } catch (err) {
      setError({ key: err instanceof KycError && err.code === "network" ? "kyc.network" : "kyc.error" });
    } finally {
      setBusy(false);
    }
  };

  const sign = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp.trim())) return setError({ key: "kyc.esign.otpError" });
    setBusy(true);
    setError(null);
    try {
      onSigned(await verifyEsign(kyc.caseId, otp.trim(), fetchFn));
    } catch (err) {
      if (err instanceof KycError && ["wrong_otp", "otp_expired", "too_many_attempts"].includes(err.code)) {
        setError({ key: `kyc.esign.${err.code}` as MessageKey, left: err.attemptsLeft });
        if (err.code !== "wrong_otp" || err.attemptsLeft === 0) setNeedNewCode(true);
      } else {
        setError({ key: err instanceof KycError && err.code === "network" ? "kyc.network" : "kyc.error" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card form" aria-labelledby="kyc-esign-title">
      <div className="kyc-doc__head">
        <h2 id="kyc-esign-title" className="card__title">
          {t("kyc.esign.title")}
        </h2>
        <span className="mock-badge">{t("kyc.esign.mock")}</span>
      </div>
      <p className="muted small">{t("kyc.esign.mockNote")}</p>

      {agreement && (
        <dl className="kyc-read" data-testid="kyc-agreement">
          <div>
            <dt>{t("kyc.esign.business")}</dt>
            <dd>{agreement.business}</dd>
          </div>
          {agreement.gstin && (
            <div>
              <dt>{t("kyc.esign.gstin")}</dt>
              <dd className="code">{agreement.gstin}</dd>
            </div>
          )}
          <div>
            <dt>{t("kyc.esign.signatory")}</dt>
            <dd>{agreement.signatory}</dd>
          </div>
          {agreement.quote && (
            <>
              <div>
                <dt>{t("kyc.esign.bundle")}</dt>
                <dd>{agreement.quote.bundle}</dd>
              </div>
              <div>
                <dt>{t("kyc.esign.monthly")}</dt>
                <dd>
                  {formatInr(agreement.quote.monthlyInr)}
                  {t("quote.perMonth")}
                </dd>
              </div>
              <div>
                <dt>{t("kyc.esign.setup")}</dt>
                <dd>{formatInr(agreement.quote.setupInr)}</dd>
              </div>
              <div>
                <dt>{t("kyc.esign.contract")}</dt>
                <dd>{t(agreement.quote.contractMonths === 1 ? "quote.month.one" : "quote.month.other", { n: agreement.quote.contractMonths })}</dd>
              </div>
            </>
          )}
          <div>
            <dt>{t("kyc.esign.date")}</dt>
            <dd>{formatDate(agreement.date, lang)}</dd>
          </div>
        </dl>
      )}

      {mockOtp && !needNewCode && (
        <p className="mock-otp" role="status">
          {t("kyc.esign.otpShown", { otp: mockOtp })}
        </p>
      )}

      {(!mockOtp || needNewCode) && (
        <button type="button" className="button-primary" disabled={busy} onClick={() => void requestOtp()}>
          {t(mockOtp ? "kyc.esign.again" : "kyc.esign.start")}
        </button>
      )}

      {mockOtp && !needNewCode && (
        <form onSubmit={sign} noValidate className="form">
          <div className="field">
            <label className="field__label" htmlFor="kyc-otp">
              {t("kyc.esign.otp")}
            </label>
            <input
              id="kyc-otp"
              className="input input--code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <button type="submit" className="button-primary" disabled={busy}>
            {t(busy ? "kyc.esign.signing" : "kyc.esign.sign")}
          </button>
        </form>
      )}

      {error && (
        <p className="field-error" role="alert">
          {t(error.key, { left: error.left ?? 0 })}
        </p>
      )}
    </section>
  );
}
