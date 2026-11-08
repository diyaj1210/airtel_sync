import type { BusinessProfile, CityTier, GstinStatus, Segment } from "../catalogue/types.js";
import { GSTIN_STATUSES } from "../catalogue/types.js";
import type { City } from "../cities.js";
import { maskIdentifiers } from "../masking.js";
import { matchCity } from "./lexicon.js";

/**
 * What the advisor knows about the business. Every value here has been validated; the rules
 * engine only ever sees a profile built from these answers (never raw LLM output).
 */

/** The questions, in the order the advisor asks them (PDF: type, size, locations, current tools). */
export const SLOTS = ["businessKind", "employees", "sites", "city", "gstin", "internet", "tools"] as const;
export type Slot = (typeof SLOTS)[number];

export const BUSINESS_KINDS = ["shop", "office", "chain", "factory"] as const;
export type BusinessKind = (typeof BUSINESS_KINDS)[number];

/** Current internet, same categories as `current_internet` in smb_leads.csv. */
export const INTERNET_TYPES = ["none", "mobile_hotspot", "home_broadband", "business_broadband", "leased_line"] as const;
export type InternetType = (typeof INTERNET_TYPES)[number];

/** Tools the business already uses (PDF: current tools). */
export const TOOLS = ["pos", "email", "cctv", "messaging"] as const;
export type Tool = (typeof TOOLS)[number];

export const OTHER_CITY = "__other__";
export const LIMITS = { employees: { min: 1, max: 100_000 }, sites: { min: 1, max: 1_000 } } as const;
const MAX_LABEL = 40;

export interface CityAnswer {
  name: string;
  tier: CityTier;
  /** false = not one of the cities in our data; treated as tier 2 (the stricter rule set). */
  listed: boolean;
}

export interface Answers {
  businessKind?: BusinessKind;
  /** Short label for the business, e.g. "Dental clinic" (only used in explanations). */
  businessType?: string;
  employees?: number;
  sites?: number;
  city?: CityAnswer;
  gstin?: GstinStatus;
  internet?: InternetType;
  /** [] = uses none of them. */
  tools?: Tool[];
}

/** Unvalidated updates, from the deterministic parser, a quick reply or the LLM. */
export interface AnswerUpdates {
  businessKind?: unknown;
  businessType?: unknown;
  employees?: unknown;
  sites?: unknown;
  city?: unknown;
  gstin?: unknown;
  internet?: unknown;
  tools?: unknown;
}

const oneOf = <T extends string>(values: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (values as readonly string[]).includes(v);

const wholeIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** A short free-text label with identifiers masked and no control characters. */
export function cleanLabel(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const text = maskIdentifiers(v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim());
  if (text.length === 0 || text.length > MAX_LABEL || /[<>{}]/.test(text)) return undefined;
  return text;
}

function parseCity(v: unknown, cities: readonly City[]): CityAnswer | undefined {
  if (typeof v !== "string") return undefined;
  const raw = v.trim();
  if (raw === OTHER_CITY) return { name: "", tier: 2, listed: false };
  const otherPrefix = /^OTHER:\s*/i;
  if (otherPrefix.test(raw)) {
    // The LLM marks a city that is not in our list as "OTHER:<name>". Check our list anyway.
    const rest = raw.replace(otherPrefix, "");
    const listed = matchCity(rest, cities);
    if (listed) return { name: listed.name, tier: listed.tier, listed: true };
    const name = cleanLabel(rest);
    return name ? { name, tier: 2, listed: false } : undefined;
  }
  const city = matchCity(raw, cities);
  return city ? { name: city.name, tier: city.tier, listed: true } : undefined;
}

export interface ApplyResult {
  answers: Answers;
  /** Slots whose value changed. */
  changed: Slot[];
  /** Slots that had a value offered that failed validation (kept as before). */
  rejected: Slot[];
}

/** Validate updates and merge them into the answers. Invalid values are rejected, never guessed. */
export function applyUpdates(answers: Answers, updates: AnswerUpdates, cities: readonly City[]): ApplyResult {
  const next: Answers = { ...answers };
  const changed: Slot[] = [];
  const rejected: Slot[] = [];
  const offered = (v: unknown) => v !== undefined && v !== null;
  const set = <K extends Slot>(slot: K, value: Answers[K] | undefined, raw: unknown) => {
    if (!offered(raw)) return;
    if (value === undefined) {
      rejected.push(slot);
      return;
    }
    if (JSON.stringify(next[slot]) !== JSON.stringify(value)) {
      next[slot] = value;
      changed.push(slot);
    }
  };

  set("businessKind", oneOf(BUSINESS_KINDS, updates.businessKind) ? updates.businessKind : undefined, updates.businessKind);
  if (offered(updates.businessType)) {
    const label = cleanLabel(updates.businessType);
    if (label) next.businessType = label;
  } else if (changed.includes("businessKind")) {
    // A new kind without a new label (e.g. a quick reply): the old label no longer fits.
    delete next.businessType;
  }
  set(
    "employees",
    wholeIn(updates.employees, LIMITS.employees.min, LIMITS.employees.max) ? updates.employees : undefined,
    updates.employees,
  );
  set("sites", wholeIn(updates.sites, LIMITS.sites.min, LIMITS.sites.max) ? updates.sites : undefined, updates.sites);
  set("city", parseCity(updates.city, cities), updates.city);
  set("gstin", oneOf(GSTIN_STATUSES, updates.gstin) ? updates.gstin : undefined, updates.gstin);
  set("internet", oneOf(INTERNET_TYPES, updates.internet) ? updates.internet : undefined, updates.internet);
  const tools =
    Array.isArray(updates.tools) && updates.tools.length <= TOOLS.length && updates.tools.every((t) => oneOf(TOOLS, t))
      ? TOOLS.filter((t) => (updates.tools as unknown[]).includes(t))
      : undefined;
  set("tools", tools, updates.tools);
  return { answers: next, changed, rejected };
}

/** The next question to ask, or null when every answer is known. */
export function nextSlot(answers: Answers): Slot | null {
  return SLOTS.find((s) => answers[s] === undefined) ?? null;
}

export function isComplete(answers: Answers): boolean {
  return nextSlot(answers) === null;
}

/**
 * Segment from the kind of business and its size. Shops and services with two or more locations
 * are run as a chain (the multi-site segment); in smb_leads.csv every multi-site business has
 * 3+ sites and every micro business 1, and the rules engine still checks each product's minimum.
 */
export function segmentFor(kind: BusinessKind, sites: number): Segment {
  switch (kind) {
    case "factory":
      return "mfg";
    case "office":
      return "prof";
    case "shop":
    case "chain":
      return sites >= 2 ? "multi" : "micro";
  }
}

/** The four facts the catalogue rules depend on. Only call when the answers are complete. */
export function profileFor(answers: Answers): BusinessProfile {
  const { city, employees, sites, gstin } = answers;
  if (!city || employees === undefined || sites === undefined || !gstin) throw new Error("Answers are not complete");
  return { cityTier: city.tier, employees, sites, gstin };
}
