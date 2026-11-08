import { useEffect, useState } from "react";
import {
  fetchSampleImage,
  KycError,
  listSamples,
  lookupKyc,
  rememberApplication,
  resumeKyc,
  saveBusiness,
  startKyc,
  submitKyc,
  uploadDocument,
  withdrawConsent,
  type DocType,
  type KycCase,
  type Lookup,
} from "../../api/kyc";
import { formatDate } from "../../format";
import type { MessageKey } from "../../i18n/en";
import { useI18n } from "../../i18n/I18nProvider";
import { KycBusiness, type Identifiers } from "./KycBusiness";
import { KycDocuments } from "./KycDocuments";
import { KycEsign } from "./KycEsign";
import { KycLookup, KycName } from "./KycLookup";
import { KycConsent, MyDataView } from "./KycPrivacy";
import { BlockerHistory, ReadinessCard } from "./ReadinessCard";

/**
 * Smart KYC, lookup first (privacy + One-Sitting Completion add-ons):
 *   1. business identifiers (GSTIN, Udyam) or a DEMO sample  -> public registry lookup, nothing stored
 *   2. what the lookup found + the readiness preview + the documents still needed
 *   3. consent (five sections, listing only what is still needed)          -> the case is created
 *   4. the applicant's name                                                -> 5. documents, with the
 *      readiness card and a fix for every blocker -> 6. MOCK e-sign -> done. "My data" on every step.
 */
type Step = "identify" | "lookup" | "consent" | "name" | "documents" | "esign" | "done" | "withdrawn" | "mydata";

const errorKey = (err: unknown): MessageKey => (err instanceof KycError && err.code === "network" ? "kyc.network" : "kyc.error");

export function KycFlow({
  quoteId,
  resumeCaseId,
  onExit,
  onCheckout,
  onGetQuote,
  fetchFn,
}: {
  quoteId: string | null;
  /** Save and return: open an existing application by its reference. */
  resumeCaseId?: string | null;
  onExit: () => void;
  /** After signing: pay and place the order (step 5). */
  onCheckout?: (caseId: string) => void;
  /** No quote yet: get one (the verification is kept). */
  onGetQuote?: () => void;
  fetchFn?: typeof fetch;
}) {
  const { t, lang } = useI18n();
  const [step, setStep] = useState<Step>(resumeCaseId ? "documents" : "identify");
  const [back, setBack] = useState<Step>("identify");
  const [kyc, setKyc] = useState<KycCase | null>(null);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [identifiers, setIdentifiers] = useState<Identifiers | null>(null);
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);
  const [resuming, setResuming] = useState(!!resumeCaseId);

  const stepFor = (k: KycCase): Step => (k.withdrawn ? "withdrawn" : k.esign?.signed ? "done" : !k.business ? "identify" : "documents");

  // Save and return: reopen the application with its blockers.
  useEffect(() => {
    if (!resumeCaseId) return;
    let live = true;
    resumeKyc(resumeCaseId, fetchFn).then(
      (k) => {
        if (!live) return;
        setKyc(k);
        setStep(stepFor(k));
        setResuming(false);
      },
      (err) => {
        if (!live) return;
        setError(err instanceof KycError && err.status === 404 ? "kyc.resume.notFound" : errorKey(err));
        setStep("identify");
        setResuming(false);
      },
    );
    return () => {
      live = false;
    };
  }, [resumeCaseId, fetchFn]);

  const identify = async (input: Identifiers) => {
    setLookup(await lookupKyc({ ...input, quoteId }, fetchFn));
    setIdentifiers(input);
    setSampleId(null);
    setStep("lookup");
  };

  const pickSample = async (id: string) => {
    setLookup(await lookupKyc({ sampleId: id, quoteId }, fetchFn));
    setIdentifiers(null);
    setSampleId(id);
    setStep("lookup");
  };

  /** DEMO: fill in a sample applicant and upload every document it has, one by one, like the owner would. */
  const applySample = async (caseId: string, id: string) => {
    const sample = (await listSamples(fetchFn)).find((s) => s.id === id);
    if (!sample) throw new KycError(404, "sample_not_found");
    let current = await saveBusiness(caseId, { sampleId: id }, fetchFn);
    setKyc(current);
    setStep("documents");
    setError(null);
    try {
      for (const [i, doc] of sample.documents.entries()) {
        setProgress({ n: i + 1, total: sample.documents.length });
        const bytes = await fetchSampleImage(id, doc, fetchFn);
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

  const agree = async (marketing: boolean) => {
    const k = kyc ?? (await startKyc(lang, quoteId, fetchFn, marketing));
    rememberApplication(k.caseId);
    setKyc(k);
    if (sampleId) await applySample(k.caseId, sampleId);
    else setStep("name");
  };

  const saveName = async (applicantName: string) => {
    const ids = identifiers ?? { gstin: null, hasUdyam: false, udyamNumber: null };
    setKyc(await saveBusiness(kyc!.caseId, { applicantName, ...ids }, fetchFn));
    setStep("documents");
  };

  const withdraw = async () => {
    try {
      await withdrawConsent(kyc!.caseId, fetchFn);
      setConfirmWithdraw(false);
      setKyc(await resumeKyc(kyc!.caseId, fetchFn).catch(() => kyc));
      setStep("withdrawn");
    } catch (err) {
      setError(errorKey(err));
    }
  };

  const openMyData = () => {
    setBack(step);
    setStep("mydata");
  };

  const focusUpload = (doc: DocType) => {
    const input = document.getElementById(`kyc-file-${doc}`);
    input?.scrollIntoView?.({ block: "center" });
    input?.click();
  };

  const canWithdraw = kyc !== null && !kyc.withdrawn && step !== "withdrawn" && step !== "mydata";
  const withdrawnOn = kyc?.withdrawn?.on;

  if (resuming) return <p className="muted">{t("bo.loading")}</p>;

  return (
    <div className="kyc">
      {kyc && step !== "withdrawn" && (
        <p className="muted small kyc__ref" data-testid="kyc-reference">
          {t("kyc.reference", { id: kyc.caseId })}
          {step !== "mydata" && (
            <>
              {" · "}
              <button type="button" className="link-button link-button--inline" onClick={openMyData}>
                {t("mydata.open")}
              </button>
            </>
          )}
        </p>
      )}

      {step === "identify" && <KycBusiness onSave={identify} onSample={pickSample} fetchFn={fetchFn} />}

      {step === "lookup" && lookup && <KycLookup lookup={lookup} onContinue={() => setStep(kyc ? (sampleId ? "documents" : "name") : "consent")} onChange={() => setStep("identify")} />}

      {step === "consent" && lookup && (
        <KycConsent
          documentsNeeded={lookup.documentsNeeded}
          identifiers={{ gstin: !!lookup.registry.gst || !!identifiers?.gstin, udyam: !!identifiers?.udyamNumber }}
          onAgree={agree}
          onCancel={onExit}
          fetchFn={fetchFn}
        />
      )}

      {step === "name" && <KycName onSave={saveName} />}

      {step === "documents" && kyc && (
        <>
          {kyc.readiness && (
            <ReadinessCard readiness={kyc.readiness} kyc={kyc} onChange={setKyc} onUpload={focusUpload} onGetQuote={onGetQuote} fetchFn={fetchFn} />
          )}
          <KycDocuments kyc={kyc} onChange={setKyc} onEdit={() => setStep("identify")} onSign={() => setStep("esign")} progress={progress} fetchFn={fetchFn} />
          <BlockerHistory history={kyc.blockerHistory ?? []} />
        </>
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
          {withdrawnOn && <p className="small">{t("mydata.deletedOn", { date: formatDate(withdrawnOn, lang) })}</p>}
          {kyc && (
            <button type="button" className="button-secondary" onClick={openMyData}>
              {t("mydata.open")}
            </button>
          )}
          <button type="button" className="button-secondary" onClick={onExit}>
            {t("kyc.done.home")}
          </button>
        </section>
      )}

      {step === "mydata" && kyc && (
        <MyDataView
          caseId={kyc.caseId}
          onBack={() => setStep(kyc.withdrawn ? "withdrawn" : back)}
          onDeleted={() => void resumeKyc(kyc.caseId, fetchFn).then(setKyc, () => undefined)}
          fetchFn={fetchFn}
        />
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
