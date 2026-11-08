import type { Catalogue } from "../catalogue/catalogue.js";
import type { GstinStatus } from "../catalogue/types.js";
import { buildQuote, type Quote, type QuoteRequest } from "../quote/quote.js";
import type { AlternativeKind } from "./types.js";

/**
 * Alternatives offered when the selected bundle cannot be completed as it is. Every alternative is
 * built by the quote engine, so the rules engine decides what is in it and the price; nothing here
 * picks products or prices by itself. Returns null when the rules allow no alternative.
 */

export interface Alternative {
  kind: AlternativeKind;
  request: QuoteRequest;
  quote: Quote;
  removed: string[];
  added: string[];
}

function tryBuild(catalogue: Catalogue, request: QuoteRequest): Quote | null {
  try {
    const q = buildQuote(catalogue, request);
    return q.items.some((i) => i.selected) ? q : null;
  } catch {
    return null;
  }
}

function diff(from: Quote, to: Quote) {
  const names = (q: Quote) => new Map(q.items.filter((i) => i.selected).map((i) => [i.productId, i.name]));
  const a = names(from);
  const b = names(to);
  return { removed: [...a].filter(([id]) => !b.has(id)).map(([, n]) => n), added: [...b].filter(([id]) => !a.has(id)).map(([, n]) => n) };
}

export function buildAlternative(
  kind: AlternativeKind,
  current: { request: QuoteRequest; quote: Quote },
  catalogue: Catalogue,
  gstin: GstinStatus = "inactive",
): Alternative | null {
  const { request } = current;
  let candidates: QuoteRequest[];
  switch (kind) {
    case "without_gstin_products": {
      // The same bundle for a business whose GSTIN cannot be used: the rules engine drops the GSTIN-only lines.
      const profile = { ...request.profile, gstin };
      const include = request.include.filter((id) => !catalogue.get(id).requiresGstin);
      candidates = [
        { ...request, profile, include },
        { ...request, profile, include, exclude: [] },
      ];
      break;
    }
    case "airfiber":
      // No wired service at the address: the 5G AirFiber bundle for the same business.
      candidates = [{ segment: "micro", variant: "standard", profile: request.profile, exclude: [], include: [] }];
      break;
    case "requote":
      // An expired quote: the same choices at today's prices.
      candidates = [request];
      break;
  }
  for (const candidate of candidates) {
    const quote = tryBuild(catalogue, candidate);
    if (quote) return { kind, request: candidate, quote, ...diff(current.quote, quote) };
  }
  return null;
}
