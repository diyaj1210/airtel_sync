import { Router, type Response } from "express";
import type { Catalogue } from "../catalogue/catalogue.js";
import { parseBuildRequest, type Parsed } from "../catalogue/validate.js";
import type { City } from "../cities.js";
import { buildQuote, QuoteRequestError, QuoteSelectionError, type QuoteRequest } from "./quote.js";
import type { QuoteStore } from "./store.js";

/**
 *   GET  /api/cities             cities served, with tier (from smb_leads.csv)
 *   POST /api/quote              { segment, variant?, profile, exclude?, include? } -> live quote
 *   POST /api/quotes             same body -> quote re-computed on the server and accepted
 *   GET  /api/quotes/:quoteId    an accepted quote
 */
export function quoteRouter(catalogue: Catalogue, cities: City[], store: QuoteStore): Router {
  const router = Router();

  router.get("/cities", (_req, res) => {
    res.json({ cities });
  });

  router.post("/quote", (req, res) => {
    const parsed = parseQuoteRequest(req.body);
    if (!parsed.ok) return void res.status(400).json({ error: "invalid_request", details: parsed.errors });
    respondWithQuote(res, catalogue, parsed.value, (quote) => res.json(quote));
  });

  router.post("/quotes", (req, res) => {
    const parsed = parseQuoteRequest(req.body);
    if (!parsed.ok) return void res.status(400).json({ error: "invalid_request", details: parsed.errors });
    // The total is always recomputed here; a price sent by the client is never trusted.
    respondWithQuote(res, catalogue, parsed.value, (quote) => res.status(201).json(store.accept(parsed.value, quote)));
  });

  router.get("/quotes/:quoteId", (req, res) => {
    const accepted = /^Q-[0-9A-F]{8}$/.test(req.params.quoteId) ? store.get(req.params.quoteId) : undefined;
    if (!accepted) return void res.status(404).json({ error: "quote_not_found" });
    res.json(accepted);
  });

  return router;
}

function respondWithQuote(
  res: Response,
  catalogue: Catalogue,
  request: QuoteRequest,
  ok: (quote: ReturnType<typeof buildQuote>) => void,
): void {
  try {
    ok(buildQuote(catalogue, request));
  } catch (err) {
    if (err instanceof QuoteRequestError) {
      res.status(400).json({ error: "invalid_request", details: err.details });
    } else if (err instanceof QuoteSelectionError) {
      res.status(422).json({ error: "not_allowed", problems: err.problems });
    } else {
      throw err;
    }
  }
}

function idList(value: unknown, field: string, errors: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50 || !value.every((v) => typeof v === "string")) {
    errors.push(`${field} must be an array of product ids (at most 50)`);
    return [];
  }
  return value as string[];
}

export function parseQuoteRequest(body: unknown): Parsed<QuoteRequest> {
  const base = parseBuildRequest(body);
  const errors = base.ok ? [] : [...base.errors];
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const exclude = idList(record.exclude, "exclude", errors);
  const include = idList(record.include, "include", errors);
  if (!base.ok || errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { ...base.value, exclude, include } };
}
