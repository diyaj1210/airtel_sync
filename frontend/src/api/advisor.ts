/** Types and calls for the advisor chat API (backend/src/advisor). */
import type { Lang } from "../i18n/I18nProvider";
import { call, type Block, type QuoteRequest } from "./quote";

export type Slot = "businessKind" | "employees" | "sites" | "city" | "gstin" | "internet" | "tools";
export type Choice = { slot: Slot; value: unknown } | { slot: "action"; value: "human" | "not_interested" | "restart" };

export interface ProductCard {
  productId: string;
  name: string;
  description: string;
  unit: string;
  unitPriceInr: number;
  setupInr: number;
  /** null = depends on the business (not all answers known yet). */
  eligible: boolean | null;
  violations: Block[];
  inBundle: boolean;
  addOn: boolean;
}

export interface AdvisorMessage {
  text: string;
  /** "gemini" = written by the AI helper and checked against the rules; "rules" = the advisor's own text. */
  source: "gemini" | "rules";
  products?: ProductCard[];
}

export interface QuickReply {
  label: string;
  choice: Choice;
}

export interface Recommendation {
  quoteRequest: QuoteRequest;
  templateId: string;
  name: string;
  totals: { monthlyInr: number; monthlyMaxInr: number; setupInr: number; contractMonths: number; installDays: number };
  items: { productId: string; name: string; qty: number; unit: string; monthlyInr: number; setupInr: number; kind: "core" | "addon"; why: string }[];
  unavailable: { productId: string; name: string; violations: Block[] }[];
  whySource: "gemini" | "rules";
}

export interface AdvisorReply {
  sessionId: string;
  lang: Lang;
  messages: AdvisorMessage[];
  expecting: Slot | null;
  quickReplies: QuickReply[];
  multiSelect: boolean;
  recommendation: Recommendation | null;
  action: "handoff" | "not_interested" | null;
  mode: "gemini" | "basic";
}

export const LEAD_REASONS = [
  "price_too_high",
  "decided_to_wait",
  "only_mobile_plan",
  "locked_in_provider",
  "needs_unavailable_product",
  "other",
] as const;
export type NotInterestedReason = (typeof LEAD_REASONS)[number];
export type LeadReason = NotInterestedReason | "asked_for_human";

export interface LeadRequest {
  reason: LeadReason;
  phone?: string;
  callbackConsent?: boolean;
  note?: string;
}

type FetchFn = typeof fetch;

export const startChat = (lang: Lang, fetchFn: FetchFn = fetch) => call<AdvisorReply>(fetchFn, "/api/advisor/sessions", { lang });

export const sendToAdvisor = (sessionId: string, body: { lang: Lang; text: string } | { lang: Lang; choice: Choice }, fetchFn: FetchFn = fetch) =>
  call<AdvisorReply>(fetchFn, `/api/advisor/sessions/${encodeURIComponent(sessionId)}/messages`, body);

export const saveLead = (sessionId: string, body: LeadRequest, fetchFn: FetchFn = fetch) =>
  call<{ leadId: string; reason: string; phoneMasked: string | null }>(fetchFn, `/api/advisor/sessions/${encodeURIComponent(sessionId)}/lead`, body);

/** Same rule as the backend: 10 digits starting 6-9, optional +91 / 0 prefix, spaces and dashes allowed. */
export function isIndianMobile(raw: string): boolean {
  const digits = raw.replace(/[\s()-]/g, "").replace(/^(?:\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, "");
  return /^[6-9]\d{9}$/.test(digits);
}
