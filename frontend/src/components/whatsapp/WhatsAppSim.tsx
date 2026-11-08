import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { isIndianMobile } from "../../api/advisor";
import { ACCEPTED_IMAGES, readFileBytes, type DocType } from "../../api/kyc";
import { sampleDocument, sendPhoto, sendText, tapButton, WhatsAppError, type WaMessage } from "../../api/whatsapp";
import type { MessageKey } from "../../i18n/en";
import { useI18n } from "../../i18n/I18nProvider";
import { referralCode } from "../../referral";
import { readAloudSupported, speak, stopSpeaking } from "../../voice";
import { VoiceButton } from "../VoiceButton";

/**
 * WhatsApp simulator (step 8). Plays the owner's WhatsApp app against the MOCK WhatsApp Business
 * webhook in the backend: the bot there runs the whole journey (advisor, quote, KYC with photos,
 * MOCK e-sign, MOCK payment, tracker) on the same code as the app.
 */

type Bubble =
  | { key: string; from: "bot"; message: WaMessage }
  | { key: string; from: "me"; text: string; kind: "text" | "voice" | "photo" | "button" }
  | { key: string; from: "error"; text: MessageKey };

const MAX_TEXT = 500;
const DEMO_NUMBER = "9000012345";

/** WhatsApp formatting: *bold*, _italic_; line breaks kept by CSS. Built as elements, never as HTML. */
export function formatWa(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*([^*\n]+)\*|_([^_\n]+)_/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(m[1] !== undefined ? <strong key={m.index}>{m[1]}</strong> : <em key={m.index}>{m[2]}</em>);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function WhatsAppSim({ fetchFn }: { fetchFn?: typeof fetch }) {
  const { t, lang } = useI18n();
  const [phone, setPhone] = useState<string | null>(null);
  const [numberDraft, setNumberDraft] = useState("");
  const [numberError, setNumberError] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [text, setText] = useState(() => `Hi${referralCode() ? ` ${referralCode()}` : ""}`);
  const [busy, setBusy] = useState(false);
  const [openList, setOpenList] = useState<number | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const counter = useRef(0);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [bubbles, busy]);
  useEffect(() => () => stopSpeaking(), []);

  const lastBot = [...bubbles].reverse().find((b): b is Extract<Bubble, { from: "bot" }> => b.from === "bot");
  const key = () => `b${counter.current++}`;

  const exchange = async (mine: Bubble | null, call: () => Promise<WaMessage[]>) => {
    if (!phone || busy) return;
    setBusy(true);
    setOpenList(null);
    if (mine) setBubbles((b) => [...b, mine]);
    try {
      const replies = await call();
      setBubbles((b) => [...b, ...replies.map((message) => ({ key: key(), from: "bot" as const, message }))]);
      if (readAloud) replies.forEach((r) => speak(r.text, lang));
    } catch (err) {
      if (!(err instanceof WhatsAppError && err.status === 409)) setBubbles((b) => [...b, { key: key(), from: "error", text: "wa.error" }]);
    } finally {
      setBusy(false);
    }
  };

  const start = (e: FormEvent) => {
    e.preventDefault();
    const ok = isIndianMobile(numberDraft);
    setNumberError(!ok);
    // The backend reads the number the same way (10 digits, optional +91 / 0).
    if (ok) setPhone(numberDraft.replace(/\D/g, "").slice(-10));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim().slice(0, MAX_TEXT);
    if (!value || !phone) return;
    setText("");
    void exchange({ key: key(), from: "me", text: value, kind: "text" }, () => sendText(phone, value, false, fetchFn));
  };

  const voice = (said: string) => {
    const value = said.slice(0, MAX_TEXT);
    if (phone) void exchange({ key: key(), from: "me", text: value, kind: "voice" }, () => sendText(phone, value, true, fetchFn));
  };

  const tap = (id: string, title: string) => {
    if (!phone) return;
    if (id.startsWith("sample:")) setSample(id.slice("sample:".length));
    void exchange({ key: key(), from: "me", text: title, kind: "button" }, () => tapButton(phone, id, fetchFn));
  };

  const photo = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !phone) return;
    const bytes = await readFileBytes(file);
    void exchange({ key: key(), from: "me", text: t("wa.photo"), kind: "photo" }, () => sendPhoto(phone, { bytes, type: file.type }, fetchFn));
  };

  const demoPhoto = (doc: DocType) => {
    if (!phone || !sample) return;
    void exchange({ key: key(), from: "me", text: t("wa.photoOf", { doc: t(`kyc.doc.${doc}`) }), kind: "photo" }, async () => sendPhoto(phone, await sampleDocument(sample, doc, fetchFn), fetchFn));
  };

  if (!phone) {
    return (
      <form className="card form" onSubmit={start} noValidate aria-labelledby="wa-start-title">
        <h2 id="wa-start-title" className="card__title">
          {t("wa.title")}
        </h2>
        <p>
          <span className="mock-badge">MOCK</span> {t("wa.mockNote")}
        </p>
        <label className="field__label" htmlFor="wa-number">
          {t("wa.number")}
        </label>
        <input
          id="wa-number"
          className="input"
          inputMode="tel"
          autoComplete="tel"
          value={numberDraft}
          aria-invalid={numberError ? true : undefined}
          aria-describedby="wa-number-hint"
          onChange={(e) => setNumberDraft(e.target.value)}
        />
        <p id="wa-number-hint" className="muted small">
          {t("wa.numberHint")}
        </p>
        {numberError && <p className="field-error">{t("lead.phoneError")}</p>}
        <button type="button" className="link-button" onClick={() => setNumberDraft(DEMO_NUMBER)}>
          {t("wa.demoNumber")}
        </button>
        <button type="submit" className="button-primary">
          {t("wa.open")}
        </button>
      </form>
    );
  }

  const active = lastBot?.message;
  return (
    <section className="wa" aria-labelledby="wa-title">
      <header className="wa__bar">
        <div>
          <h2 id="wa-title" className="wa__name">
            Accel Business
          </h2>
          <p className="wa__sub">
            <span className="mock-badge">MOCK</span> {t("wa.bar")}
          </p>
        </div>
        {readAloudSupported() && (
          <button
            type="button"
            className="wa__icon"
            aria-pressed={readAloud}
            aria-label={t("wa.readAloud")}
            onClick={() => {
              if (readAloud) stopSpeaking();
              setReadAloud(!readAloud);
            }}
          >
            🔊
          </button>
        )}
      </header>

      <div className="wa__log" role="log" aria-live="polite" aria-label={t("wa.title")}>
        {bubbles.length === 0 && <p className="wa__hint small">{t("wa.startHint")}</p>}
        {bubbles.map((b) => {
          if (b.from === "error") {
            return (
              <p key={b.key} className="wa__error small" role="alert">
                {t(b.text)}
              </p>
            );
          }
          if (b.from === "me") {
            return (
              <div key={b.key} className={`wa__msg wa__msg--me wa__msg--${b.kind}`} data-from="me">
                {b.kind === "voice" && <span aria-label={t("wa.voiceNote")}>🎤 </span>}
                {b.kind === "photo" && <span aria-hidden="true">📷 </span>}
                {b.text}
              </div>
            );
          }
          const m = b.message;
          const isActive = m === active;
          return (
            <div key={b.key} className="wa__msg wa__msg--bot" data-from="bot" data-message={m.id}>
              <p className="wa__text">{formatWa(m.text)}</p>
              {m.buttons && m.buttons.length > 0 && (
                <div className="wa__buttons">
                  {m.buttons.map((btn) => (
                    <button key={btn.id} type="button" className="wa__button" disabled={!isActive || busy} onClick={() => tap(btn.id, btn.title)}>
                      {btn.title}
                    </button>
                  ))}
                </div>
              )}
              {m.list && (
                <>
                  <button type="button" className="wa__button" disabled={!isActive || busy} aria-expanded={openList === m.id} onClick={() => setOpenList(openList === m.id ? null : m.id)}>
                    ☰ {m.list.button}
                  </button>
                  {openList === m.id && isActive && (
                    <ul className="wa__list" aria-label={m.list.button}>
                      {m.list.rows.map((row) => (
                        <li key={row.id}>
                          <button type="button" className="wa__row" disabled={busy} onClick={() => tap(row.id, row.title)}>
                            {row.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          );
        })}
        {busy && (
          <p className="wa__typing small" role="status">
            {t("wa.typing")}
          </p>
        )}
        <div ref={end} />
      </div>

      {active?.expectsPhoto && sample && (
        <button type="button" className="button-secondary card--demo" disabled={busy} onClick={() => demoPhoto(active.expectsPhoto!)}>
          {t("wa.demoPhoto", { sample, doc: t(`kyc.doc.${active.expectsPhoto}`) })}
        </button>
      )}

      <form className="wa__composer" onSubmit={submit}>
        <label className="wa__icon" title={t("wa.attach")}>
          <span aria-hidden="true">📎</span>
          <span className="sr-only">{t("wa.attach")}</span>
          <input type="file" accept={ACCEPTED_IMAGES} className="sr-only" disabled={busy} onChange={(e) => void photo(e)} />
        </label>
        <label className="sr-only" htmlFor="wa-input">
          {t("wa.placeholder")}
        </label>
        <input
          id="wa-input"
          className="input wa__input"
          value={text}
          maxLength={MAX_TEXT}
          placeholder={t("wa.placeholder")}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <VoiceButton disabled={busy} onText={voice} />
        <button type="submit" className="wa__send" disabled={busy || text.trim() === ""} aria-label={t("wa.send")}>
          ➤
        </button>
      </form>
      <p className="muted small">{t("voice.privacy")}</p>
    </section>
  );
}

