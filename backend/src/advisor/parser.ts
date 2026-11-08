import type { Catalogue } from "../catalogue/catalogue.js";
import type { ProductId } from "../catalogue/types.js";
import type { City } from "../cities.js";
import { OTHER_CITY, TOOLS, type AnswerUpdates, type Answers, type Slot, type Tool } from "./answers.js";
import {
  BUNDLE_QUESTION_WORDS,
  BUSINESS_TYPES,
  CHAIN_WORDS,
  EMPLOYEE_UNITS,
  GREETING_WORDS,
  GST_WORDS,
  hasAny,
  hasWord,
  HUMAN_WORDS,
  INACTIVE_WORDS,
  INTERNET_WORDS,
  matchCity,
  NO_INTERNET_WORDS,
  NO_WORDS,
  normalise,
  NOT_INTERESTED_WORDS,
  NUMBER_WORDS,
  PRODUCT_WORDS,
  QUESTION_WORDS,
  RESTART_WORDS,
  SITE_UNITS,
  TOOL_WORDS,
  USAGE_WORDS,
  YES_WORDS,
} from "./lexicon.js";

/**
 * The no-key advisor's understanding of one message: deterministic keyword and number rules in
 * English, Hindi and Hinglish. It is also the safety net whenever the LLM is off or fails.
 */

export const INTENTS = [
  "answer",
  "product_question",
  "bundle_question",
  "human",
  "not_interested",
  "greeting",
  "restart",
  "unclear",
] as const;
export type Intent = (typeof INTENTS)[number];

export interface Understanding {
  updates: AnswerUpdates;
  intent: Intent;
  /** Catalogue products the owner asked about (at most 3). */
  productIds: ProductId[];
}

export interface ParseContext {
  expecting: Slot | null;
  answers: Answers;
  cities: readonly City[];
  catalogue: Catalogue;
}

/** Structure of a GSTIN (the number itself is never kept, only "has an active GSTIN"). */
export const GSTIN_PATTERN = /(?<![a-z0-9])\d{2}[a-z]{5}\d{4}[a-z][1-9a-z]z[0-9a-z](?![a-z0-9])/i;
const MAX_PRODUCTS = 3;

const tokenise = (t: string) => t.split(/[\s,.;:!?()"'/|+&]+/u).filter(Boolean);

function toNumber(token: string): number | undefined {
  if (/^\d{1,6}$/.test(token)) return Number(token);
  return NUMBER_WORDS[token];
}

const unitMatches = (token: string | undefined, units: readonly string[]) =>
  token !== undefined &&
  units.some((u) => (u.endsWith("*") ? token.startsWith(u.slice(0, -1)) : /[ऀ-ॿ]/.test(u) ? token.startsWith(u) : token === u));

/** "5 people", "3 branches", "staff of 12", "5 लोगों की", "ek dukaan". */
function countsIn(tokens: string[]): { employees?: number; sites?: number; bare: number[] } {
  const out: { employees?: number; sites?: number; bare: number[] } = { bare: [] };
  tokens.forEach((tok, i) => {
    const n = toNumber(tok);
    if (n === undefined) return;
    const after = [tokens[i + 1], tokens[i + 2]];
    const before = [tokens[i - 1], tokens[i - 2]];
    const nextIsEmployee = after.findIndex((t) => unitMatches(t, EMPLOYEE_UNITS));
    const nextIsSite = after.findIndex((t) => unitMatches(t, SITE_UNITS));
    if (nextIsEmployee !== -1 && (nextIsSite === -1 || nextIsEmployee < nextIsSite)) out.employees ??= n;
    else if (nextIsSite !== -1) out.sites ??= n;
    else if (before.some((t) => unitMatches(t, EMPLOYEE_UNITS))) out.employees ??= n;
    else if (before.some((t) => unitMatches(t, SITE_UNITS))) out.sites ??= n;
    else if (/^\d+$/.test(tok) || tokens.length === 1) out.bare.push(n);
  });
  return out;
}

function businessFrom(t: string): { kind?: AnswerUpdates["businessKind"]; label?: string } {
  const entry = BUSINESS_TYPES.find((e) => hasAny(t, e.keywords));
  if (hasAny(t, CHAIN_WORDS)) {
    const specific = entry && entry.kind === "shop" && entry.en !== "Shop";
    return { kind: "chain", label: specific ? `${entry.en} chain` : "Chain" };
  }
  return entry ? { kind: entry.kind, label: entry.en } : {};
}

/** Tools in use, per clause, so "no CCTV, but we use billing software" gives only POS. */
function toolsFrom(t: string): { tools: Tool[]; saidNone: boolean } {
  const clauses = t.split(/,|;|\bbut\b|\band\b|\blekin\b|\baur\b|लेकिन|और|पर |तथा/u);
  const found = new Set<Tool>();
  let saidNone = false;
  for (const clause of clauses) {
    const inClause = TOOL_WORDS.filter(([, words]) => hasAny(clause, words)).map(([tool]) => tool);
    const negated = hasAny(clause, NO_WORDS);
    if (inClause.length === 0 && negated) saidNone = true;
    if (!negated) inClause.forEach((tool) => found.add(tool));
  }
  return { tools: TOOLS.filter((tool) => found.has(tool)), saidNone };
}

export function productsMentioned(t: string, catalogue: Catalogue): ProductId[] {
  const ids: ProductId[] = [];
  const add = (id: ProductId) => {
    if (!ids.includes(id) && catalogue.has(id)) ids.push(id);
  };
  // Exact names first, then keywords in what is left ("Backup 4G/5G Failover" is not also Cloud Backup or 5G).
  let rest = t;
  for (const p of catalogue.products) {
    if (hasWord(rest, p.name)) {
      add(p.id);
      rest = rest.split(normalise(p.name)).join(" ");
    }
  }
  for (const [productIds, words] of PRODUCT_WORDS) {
    if (ids.length >= MAX_PRODUCTS) break;
    if (hasAny(rest, words) && !productIds.some((id) => ids.includes(id))) productIds.forEach(add);
  }
  return ids.slice(0, MAX_PRODUCTS);
}

export function parseMessage(text: string, ctx: ParseContext): Understanding {
  const { expecting, answers, cities, catalogue } = ctx;
  // Ranges count as the lower end ("5-6 people" = 5): never overstate size to the rules engine.
  const t = normalise(text).replace(/(\d+)\s*(?:-|–|to|se|से)\s*\d+/g, "$1");
  const tokens = tokenise(t);
  const isQuestion = text.includes("?") || hasAny(t, QUESTION_WORDS);
  const updates: AnswerUpdates = {};

  // Business type: when asked, or while still unknown (a later "2 shops" must not overwrite "clinic").
  if (expecting === "businessKind" || answers.businessKind === undefined) {
    const b = businessFrom(t);
    if (b.kind) {
      updates.businessKind = b.kind;
      updates.businessType = b.label;
    }
  }

  // Numbers
  const counts = countsIn(tokens);
  if (counts.employees !== undefined) updates.employees = counts.employees;
  if (counts.sites !== undefined) updates.sites = counts.sites;
  if (updates.employees === undefined && hasAny(t, ["just me", "only me", "by myself", "on my own", "sirf main", "akela", "अकेला", "अकेली", "सिर्फ मैं", "केवल मैं"])) {
    updates.employees = 1;
  }
  if (expecting === "employees" && updates.employees === undefined && counts.bare.length === 1) updates.employees = counts.bare[0];
  // "me and my brother", "मैं और मेरा भाई": two people.
  if (
    updates.employees === undefined &&
    /(?<![a-z])(?:me|i|myself) and my (?:brother|sister|wife|husband|son|daughter|partner|father|mother|friend|helper)(?![a-z])|मैं और मेर[ाी] (?:भाई|बहन|पत्नी|पति|बेटा|बेटी|पार्टनर|पिता|माँ|मां|दोस्त|साथी)/u.test(t)
  ) {
    updates.employees = 2;
  }
  if (expecting === "sites" && updates.sites === undefined && counts.bare.length === 1) updates.sites = counts.bare[0];

  // City
  const city = matchCity(t, cities);
  if (city) updates.city = city.name;
  else if (expecting === "city") {
    if (hasAny(t, ["other", "not in the list", "not listed", "another city", "दूसरा", "दूसरे", "अन्य", "लिस्ट में नहीं"])) {
      updates.city = OTHER_CITY;
    } else {
      const raw = text.trim();
      if (/^[\p{L}\p{M} .-]{2,40}$/u.test(raw) && raw.split(/\s+/).length <= 3 && !isQuestion) updates.city = `OTHER:${raw}`;
    }
  }

  // GSTIN: a GSTIN-shaped number means "has a GSTIN" (verified against the registry in KYC).
  if (GSTIN_PATTERN.test(t)) updates.gstin = "active";
  else if (expecting === "gstin" || (hasAny(t, GST_WORDS) && !isQuestion)) {
    if (hasAny(t, INACTIVE_WORDS)) updates.gstin = "inactive";
    else if (hasAny(t, NO_WORDS)) updates.gstin = "none";
    else if (!isQuestion && (hasAny(t, YES_WORDS) || (expecting === "gstin" && hasAny(t, GST_WORDS)))) updates.gstin = "active";
  }

  // Current internet and tools: when asked, or when clearly describing today's setup.
  const describing = hasAny(t, USAGE_WORDS) && !isQuestion;
  if (expecting === "internet" || (describing && hasAny(t, INTERNET_WORDS.flatMap(([, w]) => w)))) {
    const hit = INTERNET_WORDS.find(([, words]) => hasAny(t, words));
    if (hasAny(t, NO_INTERNET_WORDS)) updates.internet = "none";
    else if (hit) updates.internet = hit[0];
    else if (expecting === "internet" && (hasAny(t, NO_WORDS) || hasAny(t, ["nothing", "कुछ नहीं"]))) updates.internet = "none";
  }
  // Tools only as the answer to that question: a partial mention elsewhere is not the full list.
  if (expecting === "tools") {
    const { tools, saidNone } = toolsFrom(t);
    if (tools.length > 0) updates.tools = tools;
    else if (saidNone) updates.tools = [];
  }

  const productIds = isQuestion ? productsMentioned(t, catalogue) : [];
  const hasUpdates = Object.keys(updates).length > 0;
  const yesNoSlot = expecting === "gstin" || expecting === "internet" || expecting === "tools";

  let intent: Intent;
  if (hasAny(t, RESTART_WORDS)) intent = "restart";
  else if (hasAny(t, HUMAN_WORDS)) intent = "human";
  else if (!yesNoSlot && !hasUpdates && hasAny(t, NOT_INTERESTED_WORDS)) intent = "not_interested";
  else if (productIds.length > 0) intent = "product_question";
  else if (isQuestion && hasAny(t, BUNDLE_QUESTION_WORDS)) intent = "bundle_question";
  else if (hasUpdates) intent = "answer";
  else if (hasAny(t, GREETING_WORDS)) intent = "greeting";
  else intent = "unclear";

  return { updates, intent, productIds };
}
