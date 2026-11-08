import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { listen, voiceInputSupported, type ListenError } from "../voice";

/**
 * Dictation into a text box. Tap the mic and speak: the words appear in the box as you speak
 * (after anything already typed). Nothing is sent: the owner can correct the text and then press
 * Send. Tap the mic again, "Stop", or Esc to stop at any time. Hidden when the browser has no
 * speech recognition.
 *
 * Renders the mic button; the status line ("Listening..." / errors) is rendered by <VoiceStatus>,
 * below the text box, so it never squeezes the box.
 */

export interface Dictation {
  listening: boolean;
  error: ListenError | null;
  toggle: () => void;
  stop: () => void;
  supported: boolean;
}

export function useDictation(value: string, onChange: (text: string) => void, onHeard?: () => void): Dictation {
  const { lang } = useI18n();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<ListenError | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  const latest = useRef({ value, onChange, onHeard });
  latest.current = { value, onChange, onHeard };

  useEffect(() => {
    // Set on every mount: React's strict mode mounts twice, and a stale "false" would drop the words.
    alive.current = true;
    return () => {
      alive.current = false;
      stopRef.current?.();
    };
  }, []);

  const stop = () => stopRef.current?.();

  const toggle = () => {
    if (listening) return stop();
    setError(null);
    setListening(true);
    const before = latest.current.value.trimEnd();
    const join = (said: string) => (before ? `${before} ${said}` : said);
    const { result, stop: end } = listen(lang, (partial) => {
      if (alive.current && partial) latest.current.onChange(join(partial));
    });
    stopRef.current = end;
    result.then(
      (said) => {
        stopRef.current = null;
        if (!alive.current) return;
        setListening(false);
        latest.current.onChange(join(said));
        latest.current.onHeard?.();
      },
      (err: ListenError) => {
        stopRef.current = null;
        if (!alive.current) return;
        setListening(false);
        setError(err);
      },
    );
  };

  // Esc stops listening.
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stopRef.current?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listening]);

  return { listening, error, toggle, stop, supported: voiceInputSupported() };
}

export function VoiceButton({ dictation, disabled }: { dictation: Dictation; disabled?: boolean }) {
  const { t } = useI18n();
  if (!dictation.supported) return null;
  return (
    <button
      type="button"
      className={`voice-button${dictation.listening ? " voice-button--on" : ""}`}
      aria-pressed={dictation.listening}
      aria-label={t(dictation.listening ? "voice.stop" : "voice.start")}
      title={t(dictation.listening ? "voice.stop" : "voice.start")}
      disabled={disabled && !dictation.listening}
      onClick={dictation.toggle}
    >
      {dictation.listening ? "■" : "🎤"}
    </button>
  );
}

/** Under the text box: "Listening..." with a Stop link, or what went wrong. */
export function VoiceStatus({ dictation }: { dictation: Dictation }) {
  const { t } = useI18n();
  if (dictation.listening) {
    return (
      <p className="small voice-status" role="status">
        <span className="voice-status__dot" aria-hidden="true" /> {t("voice.listening")}{" "}
        <button type="button" className="link-button link-button--inline" onClick={dictation.stop}>
          {t("voice.stopLink")}
        </button>
      </p>
    );
  }
  if (dictation.error) {
    return (
      <p className="field-error small voice-status" role="alert">
        {t(`voice.error.${dictation.error}`)}
      </p>
    );
  }
  return null;
}
