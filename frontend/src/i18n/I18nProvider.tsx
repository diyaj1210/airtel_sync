import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type MessageKey } from "./en";
import { hi } from "./hi";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिंदी" },
] as const;
export type Lang = (typeof LANGUAGES)[number]["code"];

const DICTIONARIES: Record<Lang, Record<MessageKey, string>> = { en, hi };
export const STORAGE_KEY = "udyam.lang";
const DEFAULT_LANG: Lang = "en";

function isLang(value: unknown): value is Lang {
  return LANGUAGES.some((l) => l.code === value);
}

/** Read the saved language. Storage can be missing or throw (private mode), so never fail. */
function readSavedLang(): Lang {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isLang(saved) ? saved : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

function saveLang(lang: Lang): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Storage unavailable: the choice still applies for this visit.
  }
}

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children, initialLang }: { children: ReactNode; initialLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => initialLang ?? readSavedLang());

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    saveLang(next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang, t: (key) => DICTIONARIES[lang][key] }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}
