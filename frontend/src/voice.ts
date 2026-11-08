/**
 * Voice input and read-aloud with the browser's Web Speech API (step 8). Nothing is recorded or
 * sent to our servers: only the words the browser recognised are sent, as a normal message.
 * Note: Chrome and Edge do the recognition on their own (Google / Microsoft) speech service, so the
 * audio goes to the browser maker; the screen says so. Unsupported browsers simply hide the mic.
 */
import type { Lang } from "./i18n/I18nProvider";

interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
}
export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

export const SPEECH_LANG: Record<Lang, string> = { en: "en-IN", hi: "hi-IN" };

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const voiceInputSupported = (): boolean => recognitionCtor() !== null;

export type ListenError = "no_speech" | "not_allowed" | "failed";

/**
 * Listen once, in the given language. Resolves with what was said (trimmed), rejects with a
 * ListenError. `stop()` ends listening early and keeps what was heard so far.
 */
export function listen(lang: Lang): { result: Promise<string>; stop: () => void } {
  const Ctor = recognitionCtor();
  if (!Ctor) return { result: Promise.reject<string>("failed" satisfies ListenError), stop: () => undefined };
  const rec = new Ctor();
  rec.lang = SPEECH_LANG[lang];
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  let heard = "";
  let error: ListenError | null = null;
  const result = new Promise<string>((resolve, reject) => {
    rec.onresult = (e) => {
      heard = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
    };
    rec.onerror = (e) => {
      error = e.error === "not-allowed" || e.error === "service-not-allowed" ? "not_allowed" : e.error === "no-speech" ? "no_speech" : "failed";
    };
    rec.onend = () => {
      if (heard) resolve(heard);
      else reject(error ?? ("no_speech" satisfies ListenError));
    };
  });
  try {
    rec.start();
  } catch {
    return { result: Promise.reject<string>("failed" satisfies ListenError), stop: () => undefined };
  }
  return { result, stop: () => rec.stop() };
}

export const readAloudSupported = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

/** Read a reply aloud (WhatsApp formatting marks removed). */
export function speak(text: string, lang: Lang): void {
  if (!readAloudSupported()) return;
  const clean = text.replace(/[*_~]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = SPEECH_LANG[lang];
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (readAloudSupported()) window.speechSynthesis.cancel();
}
