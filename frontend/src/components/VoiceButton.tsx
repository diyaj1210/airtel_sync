import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { listen, voiceInputSupported, type ListenError } from "../voice";

/**
 * Mic button: tap, speak (in the current language), and the words are sent like a typed message.
 * Hidden when the browser has no speech recognition.
 */
export function VoiceButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const { t, lang } = useI18n();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<ListenError | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      stopRef.current?.();
    },
    [],
  );

  if (!voiceInputSupported()) return null;

  const toggle = () => {
    if (listening) return stopRef.current?.();
    setError(null);
    setListening(true);
    const { result, stop } = listen(lang);
    stopRef.current = stop;
    result.then(
      (text) => {
        if (!alive.current) return;
        setListening(false);
        onText(text);
      },
      (err: ListenError) => {
        if (!alive.current) return;
        setListening(false);
        setError(err);
      },
    );
  };

  return (
    <>
      <button
        type="button"
        className={`voice-button${listening ? " voice-button--on" : ""}`}
        aria-pressed={listening}
        aria-label={t(listening ? "voice.stop" : "voice.start")}
        title={t("voice.privacy")}
        disabled={disabled && !listening}
        onClick={toggle}
      >
        🎤
      </button>
      {listening && (
        <span className="small voice-status" role="status">
          {t("voice.listening")}
        </span>
      )}
      {error && (
        <span className="field-error small voice-status" role="alert">
          {t(`voice.error.${error}`)}
        </span>
      )}
    </>
  );
}
