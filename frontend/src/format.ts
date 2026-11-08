import type { Lang } from "./i18n/I18nProvider";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** ₹1,597 / ₹1,19,182 (Indian digit grouping), same digits in English and Hindi. */
export function formatInr(amount: number): string {
  return inr.format(amount);
}

/** 2026-07-22 -> "22 July 2026" / "22 जुलाई 2026". */
export function formatDate(isoDate: string, lang: Lang): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
    numberingSystem: "latn",
  });
}
