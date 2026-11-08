import type { Catalogue } from "../catalogue/catalogue.js";
import type { ProductId } from "../catalogue/types.js";
import { maskIdentifiers } from "../masking.js";
import { hasAny, hasWord, normalise } from "./lexicon.js";
import type { Lang } from "./text.js";

/**
 * Checks every sentence the LLM writes before the owner sees it. The LLM never decides what is
 * sold; this guard makes sure its wording cannot contradict the rules engine either:
 *  - it may name only the products the engine allowed for this message,
 *  - every rupee amount must be one the engine computed,
 *  - it must be in the owner's language, without links or identifiers.
 * A rejected text is replaced by the advisor's own template sentence.
 */

export interface GuardContext {
  lang: Lang;
  catalogue: Catalogue;
  /** Products the text may name. */
  allowedProducts: ReadonlySet<ProductId>;
  /** Rupee amounts the text may contain. */
  allowedAmounts: ReadonlySet<number>;
  maxLength: number;
}

export type GuardResult = { ok: true; text: string } | { ok: false; problems: string[] };

/** Other ways to name a product. A name or alias inside an allowed product's own description is fine. */
const ALIASES: readonly [readonly ProductId[], readonly string[]][] = [
  [["P10"], ["sd-wan", "sdwan", "sd wan", "एसडी-वैन", "एसडी वैन"]],
  [["P05", "P06"], ["leased line*", "लीज्ड लाइन", "लीज़्ड लाइन", "लीज लाइन"]],
  [["P13"], ["toll-free", "toll free", "1800 number", "टोल-फ्री", "टोल फ्री"]],
  [["P21"], ["firewall*", "फायरवॉल", "फ़ायरवॉल", "फायरवाल"]],
  [["P12"], ["cloud telephony", "telephony", "टेलीफोनी", "टेलीफ़ोनी"]],
  [["P24"], ["machine monitoring", "मशीन मॉनिटरिंग"]],
  [["P25"], ["fleet tracker", "gps tracker", "fleet tracking", "फ्लीट"]],
  [["P15"], ["whatsapp business api", "whatsapp api"]],
  [["P03"], ["1 gbps", "1gbps", "biz fibre 1g"]],
  [["P04"], ["airfiber", "air fiber", "air fibre", "एयरफाइबर", "एयर फाइबर"]],
  [["P09"], ["failover", "फेलओवर", "फ़ेलओवर"]],
  [["P17"], ["cloud backup", "क्लाउड बैकअप"]],
  [["P19"], ["cloud pos"]],
  [["P23"], ["cloud cctv"]],
];

const URL_RE = /https?:\/\/|www\.|\b[\w-]+\.(?:com|in|net|org|io|co|app|link|ly)\b/i;
const AMOUNT_RES = [
  /(?:₹|\brs\.?|\binr\b|रु\.?|रुपये|रुपए)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/giu,
  /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:₹|\brupees?\b|\brs\b|रुपये|रुपए|रु)/giu,
  /([0-9][0-9,]*(?:\.[0-9]+)?)\s*\/\s*(?:month|mo\b|महीना|महीने|माह)/giu,
];

const devanagariDigits = (s: string) => s.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));

export function amountsIn(text: string): number[] {
  const t = devanagariDigits(text);
  const found: number[] = [];
  for (const re of AMOUNT_RES) {
    for (const m of t.matchAll(re)) {
      const value = Number((m[1] ?? "").replace(/,/g, ""));
      if (Number.isFinite(value)) found.push(value);
    }
  }
  return found;
}

/** Share of letters that are Devanagari (product names stay in Latin script). */
export function devanagariShare(text: string): number {
  const deva = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return deva + latin === 0 ? 0 : deva / (deva + latin);
}

export function productsNamedIn(text: string, catalogue: Catalogue, allowed: ReadonlySet<ProductId>): ProductId[] {
  const t = normalise(text);
  const allowedText = normalise(
    [...allowed].filter((id) => catalogue.has(id)).map((id) => `${catalogue.get(id).name} ${catalogue.get(id).description}`).join(" | "),
  );
  const named = new Set<ProductId>();
  for (const p of catalogue.products) if (hasWord(t, p.name) && (allowed.has(p.id) || !hasWord(allowedText, p.name))) named.add(p.id);
  for (const [ids, words] of ALIASES) {
    const hit = words.filter((w) => hasWord(t, w) && !hasWord(allowedText, w));
    if (hit.length > 0 && !ids.some((id) => allowed.has(id))) ids.forEach((id) => named.add(id));
  }
  return [...named];
}

/** Light clean-up of model formatting (no markdown in a chat bubble). */
export function cleanLlmText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\*\*|__|`/g, "")
    .replace(/^[ \t]*#+[ \t]*/gm, "")
    .replace(/^[ \t]*[*-][ \t]+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function checkLlmText(raw: unknown, ctx: GuardContext): GuardResult {
  if (typeof raw !== "string") return { ok: false, problems: ["not text"] };
  const text = cleanLlmText(raw);
  const problems: string[] = [];
  if (text.length === 0) problems.push("empty");
  if (text.length > ctx.maxLength) problems.push(`longer than ${ctx.maxLength} characters`);
  if (URL_RE.test(text)) problems.push("contains a link");
  if (maskIdentifiers(text) !== text) problems.push("contains an identifier");
  if (/[<>{}]/.test(text)) problems.push("contains markup");

  const share = devanagariShare(text);
  if (ctx.lang === "hi" && share < 0.4) problems.push("not in Hindi");
  if (ctx.lang === "en" && share > 0.1) problems.push("not in English");

  const outside = productsNamedIn(text, ctx.catalogue, ctx.allowedProducts).filter((id) => !ctx.allowedProducts.has(id));
  if (outside.length > 0) problems.push(`names products the rules engine did not allow here: ${outside.join(", ")}`);

  const wrong = amountsIn(text).filter((a) => !ctx.allowedAmounts.has(a));
  if (wrong.length > 0) problems.push(`amounts not computed by the price engine: ${wrong.join(", ")}`);

  // Prices come only from the catalogue: no invented discounts or cashback.
  if (/\d\s*%\s*(?:off|discount|छूट)/iu.test(text) || hasAny(normalise(text), ["discount*", "cashback", "cash back", "छूट", "डिस्काउंट", "कैशबैक"])) {
    problems.push("makes an offer");
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, text };
}
