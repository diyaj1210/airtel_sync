import type { Catalogue } from "../catalogue/catalogue.js";
import type { ProductId } from "../catalogue/types.js";
import { buildQuote, QuoteSelectionError, type Quote, type QuoteRequest } from "../quote/quote.js";
import { profileFor, segmentFor, type Answers, type Tool } from "./answers.js";

/**
 * The advisor's recommendation = the segment bundle the rules engine builds for the answers
 * (catalogue/bundles.ts via quote/quote.ts), plus add-ons that fill a gap in the owner's current
 * tools. An add-on is only suggested when the quote engine accepts it for this business, so every
 * product in a recommendation passes every catalogue rule.
 */

/** Tools whose absence (or presence) leads to an add-on suggestion. */
export type GapTool = Exclude<Tool, "email">;

export interface Suggestion {
  productId: ProductId;
  /** The current-tools answer that led to it. */
  because: GapTool;
}

export interface Recommendation {
  quoteRequest: QuoteRequest;
  quote: Quote;
  suggested: Suggestion[];
}

/** Add-on -> the tools answer that makes it worth suggesting. */
const TOOL_GAPS: { productId: ProductId; because: GapTool; when: (tools: readonly Tool[]) => boolean }[] = [
  { productId: "P19", because: "pos", when: (tools) => !tools.includes("pos") }, // no billing software yet
  { productId: "P23", because: "cctv", when: (tools) => !tools.includes("cctv") }, // no CCTV yet
  { productId: "P15", because: "messaging", when: (tools) => tools.includes("messaging") }, // already chats with customers
];

export function recommend(catalogue: Catalogue, answers: Answers): Recommendation {
  const { businessKind, sites } = answers;
  if (!businessKind || sites === undefined) throw new Error("Answers are not complete");
  const segment = segmentFor(businessKind, sites);
  const base: QuoteRequest = { segment, variant: "standard", profile: profileFor(answers), exclude: [], include: [] };
  let quote = buildQuote(catalogue, base);

  const tools = answers.tools ?? [];
  const suggested: Suggestion[] = [];
  for (const gap of TOOL_GAPS) {
    const item = quote.items.find((i) => i.productId === gap.productId && i.kind === "addon" && !i.selected);
    if (!item || !item.canToggle || !gap.when(tools)) continue;
    const include = [...suggested.map((s) => s.productId), gap.productId];
    try {
      quote = buildQuote(catalogue, { ...base, include });
      suggested.push({ productId: gap.productId, because: gap.because });
    } catch (err) {
      // The quote engine refused this add-on for this business: it is not suggested.
      if (!(err instanceof QuoteSelectionError)) throw err;
    }
  }
  return { quoteRequest: { ...base, include: suggested.map((s) => s.productId) }, quote, suggested };
}

export const selectedItems = (rec: Recommendation) => rec.quote.items.filter((i) => i.selected);
