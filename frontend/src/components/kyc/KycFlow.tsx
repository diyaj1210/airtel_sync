import { useState, type FormEvent } from "react";
import {
  fetchSampleImage,
  KycError,
  listSamples,
  saveBusiness,
  startKyc,
  submitKyc,
  uploadDocument,
  withdrawConsent,
  type BusinessInput,
  type KycCase,
} from "../../api/kyc";
import { formatDate } from "../../format";
import type { MessageKey } from "../../i18n/en";
import { useI18n } from "../../i18n/I18nProvider";
import { KycBusiness } from "./KycBusiness";
import { KycDocuments } from "./KycDocuments";
import { KycEsign } from "./KycEsign";

type Step = "consent" | "business" | "documents" | "esign" | "done" | "withdrawn";

const errorKey = (err: unknown): MessageKey => (err instanceof KycError && err.code === "network" ? "kyc.network" : "kyc.error");

/** The consent notice (DPDP Act 2023): what, why, how, how long, how to withdraw. Shown before anything is collected. */
function KycConsent({ onAgree, onCancel }: { onAgree: () => Promise<void>; onCancel: () => void }) {
  const { t } = useI18n();
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!agreed) return setError("kyc.consent.agreeError");
    setBusy(true);
    setError(null);
    try {
      await onAgree();
    } catch (err) {
      setError(errorKey(err));
      setBusy(false);
    }
  };

  const sections: [MessageKey, MessageKey][] = [
    ["kyc.consent.whatTitle", "kyc.consent.what"],
    ["kyc.consent.whyTitle", "kyc.consent.why"],
    ["kyc.consent.howTitle", "kyc.consent.how"],
    ["kyc.consent.keepTitle", "kyc.consent.keep"],
    ["kyc.consent.withdrawTitle", "kyc.consent.withdraw"],
  ];
  return (
    <form className="card form" onSubmit={(e) => void submit(e)} noValidate aria-labelledby="kyc-consent-title">
      <h2 id="kyc-consent-title" className="hero__title">
        {t("kyc.consent.title")}
      </h2>
      <p>{t("kyc.consent.intro")}</p>
      {sections.map(([title, body]) => (
        <div key={title} className="consent-section">
          <h3 className="consent-section__title">{t(title)}</h3>
          <p>{t(body)}</p>
        </div>
      ))}
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

export function KycFlow({
  quoteId,
  onExit,
  onCheckout,
  fetchFn,
}: {
  quoteId: string | null;
  onExit: () => void;
  /** After signing: pay and place the order (step 5). */
  onCheckout?: (caseId: string) => void;
  fetchFn?: typeof fetch;
}) {
  const { t, lang } = useI18n();
  const [step, setStep] = useState<Step>("consent");
  const [kyc, setKyc] = useState<KycCase | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);

  const agree = async () => {
    setKyc(await startKyc(lang, quoteId, fetchFn));
    setStep("business");
  };

  const save = async (input: BusinessInput) => {
    setKyc(await saveBusiness(kyc!.caseId, input, fetchFn));
    setStep("documents");
  };

  /** DEMO: fill in a sample applicant and upload its documents one by one, like the owner would. */
  const applySample = async (sampleId: string) => {
    const caseId = kyc!.caseId;
    const sample = (await listSamples(fetchFn)).find((s) => s.id === sampleId);
    if (!sample) throw new KycError(404, "sample_not_found");
    let current = await saveBusiness(caseId, { sampleId }, fetchFn);
    setKyc(current);
    setStep("documents");
    setError(null);
    try {
      for (const [i, doc] of sample.documents.entries()) {
        setProgress({ n: i + 1, total: sample.documents.length });
        const bytes = await fetchSampleImage(sampleId, doc, fetchFn);
        current = await uploadDocument(caseId, doc, { bytes, type: "image/png" }, fetchFn);
        setKyc(current);
      }
      setKyc(await submitKyc(caseId, fetchFn));
    } catch (err) {
      setError(err instanceof KycError && err.code === "ocr_unavailable" ? "kyc.upload.ocr_unavailable" : errorKey(err));
    } finally {
      setProgress(null);
    }
  };

  const withdraw = async () => {
    try {
      await withdrawConsent(kyc!.caseId, fetchFn);
      setKyc(null);
      setConfirmWithdraw(false);
      setStep("withdrawn");
    } catch (err) {
      // Already gone (e.g. the server restarted): nothing is left to delete.
      if (err instanceof KycError && err.status === 404) {
        setKyc(null);
        setStep("withdrawn");
      } else setError(errorKey(err));
    }
  };

  const canWithdraw = kyc !== null && step !== "done" && step !== "withdrawn";

  return (
    <div className="kyc">
      {kyc && step !== "withdrawn" && (
        <p className="muted small kyc__ref" data-testid="kyc-reference">
          {t("kyc.reference", { id: kyc.caseId })}
        </p>
      )}

      {step === "consent" && <KycConsent onAgree={agree} onCancel={onExit} />}

      {step === "business" && <KycBusiness onSave={save} onSample={applySample} fetchFn={fetchFn} />}

      {step === "documents" && kyc && (
        <KycDocuments
          kyc={kyc}
          onChange={setKyc}
          onEdit={() => setStep("business")}
          onSign={() => setStep("esign")}
          progress={progress}
          fetchFn={fetchFn}
        />
      )}

      {step === "esign" && kyc && (
        <KycEsign
          kyc={kyc}
          onSigned={(k) => {
            setKyc(k);
            setStep("done");
          }}
          fetchFn={fetchFn}
        />
      )}

      {step === "done" && kyc?.esign?.signed && (
        <section className="card" aria-labelledby="kyc-done-title">
          <h2 id="kyc-done-title" className="hero__title">
            {t("kyc.done.title")}
          </h2>
          <p>{t("kyc.done.body")}</p>
          <p className="muted">{t("kyc.done.reference")}</p>
          <p className="reference" data-testid="esign-reference">
            {kyc.esign.signed.reference}
          </p>
          <p className="muted small">{formatDate(kyc.esign.signed.signedOn, lang)}</p>
          {kyc.quoteId && onCheckout ? (
            <button type="button" className="button-primary" onClick={() => onCheckout(kyc.caseId)}>
              {t("kyc.done.pay")}
            </button>
          ) : (
            <p className="muted">{t("kyc.done.noQuote")}</p>
          )}
          <button type="button" className="button-secondary" onClick={onExit}>
            {t("kyc.done.home")}
          </button>
        </section>
      )}

      {step === "withdrawn" && (
        <section className="card" role="status">
          <p>{t("kyc.withdrawn")}</p>
          <button type="button" className="button-secondary" onClick={onExit}>
            {t("kyc.done.home")}
          </button>
        </section>
      )}

      {error && (
        <p className="field-error" role="alert">
          {t(error)}
        </p>
      )}

      {canWithdraw && (
        <div className="kyc__footer">
          {confirmWithdraw ? (
            <div className="card card--alert" role="alertdialog" aria-labelledby="kyc-withdraw-q">
              <p id="kyc-withdraw-q">{t("kyc.withdraw.confirm")}</p>
              <button type="button" className="button-primary button-danger" onClick={() => void withdraw()}>
                {t("kyc.withdraw.yes")}
              </button>
              <button type="button" className="link-button" onClick={() => setConfirmWithdraw(false)}>
                {t("kyc.withdraw.no")}
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="link-button" onClick={() => setConfirmWithdraw(true)}>
                {t("kyc.withdraw")}
              </button>
              <button type="button" className="link-button" onClick={onExit}>
                {t("kyc.done.home")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
