import { randomBytes } from "node:crypto";
import { addDays } from "../clock.js";
import type { Quote, QuoteRequest } from "./quote.js";

export const QUOTE_VALID_DAYS = 7;

export interface AcceptedQuote {
  quoteId: string;
  acceptedOn: string;
  validUntil: string;
  request: QuoteRequest;
  quote: Quote;
  /** Partner / sales code the customer was referred by (back-office attribution), or null. */
  attributionCode: string | null;
}

/**
 * Accepted quotes, kept in memory (prototype: they are lost when the backend restarts).
 * Only business-size facts and products are stored; no names or identifiers.
 */
export class QuoteStore {
  private readonly quotes = new Map<string, AcceptedQuote>();

  constructor(
    private readonly today: () => string,
    private readonly newId: () => string = () => `Q-${randomBytes(4).toString("hex").toUpperCase()}`,
  ) {}

  accept(request: QuoteRequest, quote: Quote, attributionCode: string | null = null): AcceptedQuote {
    let quoteId = this.newId();
    for (let tries = 0; this.quotes.has(quoteId); tries++) {
      if (tries > 10) throw new Error("Could not generate a unique quote id");
      quoteId = this.newId();
    }
    const acceptedOn = this.today();
    const accepted: AcceptedQuote = {
      quoteId,
      acceptedOn,
      validUntil: addDays(acceptedOn, QUOTE_VALID_DAYS),
      request,
      quote,
      attributionCode,
    };
    this.quotes.set(quoteId, accepted);
    return accepted;
  }

  get(quoteId: string): AcceptedQuote | undefined {
    return this.quotes.get(quoteId);
  }

  list(): AcceptedQuote[] {
    return [...this.quotes.values()];
  }
}
