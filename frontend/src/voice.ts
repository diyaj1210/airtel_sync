/**
 * Voice input (dictation) and read-aloud with the browser's Web Speech API (step 8).
 *
 * Dictation fills the text box as the owner speaks (live, word by word); nothing is sent until the
 * owner presses Send, so they can correct the text first. Nothing is recorded or sent to our
 * servers; only the text the owner sends. Chrome and Edge do the recognition on their own (Google /
 * Microsoft) speech service, so the audio goes to the browser maker; the screen says so.
 * Unsupported browsers simply hide the mic.
 */
import type { Lang } from "./i18n/I18nProvider";

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: RecognitionAlternative;
}
interface RecognitionResultEvent {
  results: ArrayLike<RecognitionResult>;
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
/** If the browser's speech engine neither hears anything nor ends by itself, give up after this long. */
export const LISTEN_TIMEOUT_MS = 15_000;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const voiceInputSupported = (): boolean => recognitionCtor() !== null;

/** Why listening ended without words. */
export type ListenError = "no_speech" | "not_allowed" | "no_microphone" | "network" | "failed";

function errorOf(code: string): ListenError {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "not_allowed";
    case "no-speech":
    case "aborted":
      return "no_speech";
    case "audio-capture":
      return "no_microphone";
    case "network":
      return "network";
    default:
      return "failed";
  }
}

/**
 * Listen once, in the given language. `onPartial` gets the words heard so far, live (interim
 * results included). Resolves with the final words (trimmed), rejects with a ListenError.
 * `stop()` ends listening early and keeps what was heard so far.
 */
export function listen(lang: Lang, onPartial: (text: string) => void = () => undefined): { result: Promise<string>; stop: () => void } {
  const Ctor = recognitionCtor();
  if (!Ctor) return { result: Promise.reject<string>("failed" satisfies ListenError), stop: () => undefined };
  const rec = new Ctor();
  rec.lang = SPEECH_LANG[lang];
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  let heard = "";
  let error: ListenError | null = null;
  let settled = false;
  let finish: () => void = () => undefined;

  const result = new Promise<string>((resolve, reject) => {
    finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (heard) resolve(heard);
      else reject(error ?? ("no_speech" satisfies ListenError));
    };
    rec.onresult = (e) => {
      heard = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      onPartial(heard);
    };
    rec.onerror = (e) => {
      error = errorOf(e.error);
    };
    rec.onend = () => finish();
  });
  // Safety net: some browsers never end on their own (no microphone signal, blocked speech service).
  const timer = setTimeout(() => {
    try {
      rec.abort();
    } catch {
      // already stopped
    }
    finish();
  }, LISTEN_TIMEOUT_MS);

  try {
    rec.start();
  } catch {
    error = "failed";
    finish();
  }
  return {
    result,
    stop: () => {
      try {
        rec.stop();
      } catch {
        // already stopped
      }
      // If the browser does not end it promptly, end it here (keeping what was heard).
      setTimeout(finish, 1500);
    },
  };
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
