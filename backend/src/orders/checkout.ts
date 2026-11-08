/**
 * Checkout after KYC: what is due now, and whether the order may be placed. Pure.
 * Due now = one-time setup + the first month (MOCK payment; no money moves).
 */
import type { Catalogue } from "../catalogue/catalogue.js";
import type { KycEvaluation } from "../kyc/checks.js";
import type { KycCase } from "../kyc/store.js";
import type { AcceptedQuote } from "../quote/store.js";

export type CheckoutBlock =
  | "kyc_not_signed"
  | "no_quote"
  | "quote_expired"
  | "quote_needs_active_gstin"
  | "already_paid";

export interface Checkout {
  quoteId: string | null;
  bundle: string | null;
  monthlyInr: number;
  setupInr: number;
  dueNowInr: number;
  contractMonths: number;
  installDays: number;
  /** Products in the quote that need an Active GSTIN the business does not have. */
  blockedProducts: { productId: string; name: string }[];
  canPay: boolean;
  block: CheckoutBlock | null;
}

export function checkout(
  kycCase: KycCase,
  evaluation: KycEvaluation,
  quote: AcceptedQuote | undefined,
  catalogue: Catalogue,
  today: string,
  existingOrderId: string | null,
): Checkout {
  const items = quote?.quote.items.filter((i) => i.selected) ?? [];
  const blockedProducts = evaluation.gstinProductsAllowed
    ? []
    : items.filter((i) => catalogue.get(i.productId).requiresGstin).map((i) => ({ productId: i.productId, name: i.name }));
  const totals = quote?.quote.totals;
  const block: CheckoutBlock | null = existingOrderId
    ? "already_paid"
    : !kycCase.esign?.signed
      ? "kyc_not_signed"
      : !quote
        ? "no_quote"
        : today > quote.validUntil
          ? "quote_expired"
          : blockedProducts.length > 0
            ? "quote_needs_active_gstin"
            : null;
  return {
    quoteId: quote?.quoteId ?? null,
    bundle: quote?.quote.name ?? null,
    monthlyInr: totals?.monthlyInr ?? 0,
    setupInr: totals?.setupInr ?? 0,
    dueNowInr: totals ? totals.setupInr + totals.monthlyInr : 0,
    contractMonths: totals?.contractMonths ?? 0,
    installDays: totals?.installDays ?? 0,
    blockedProducts,
    canPay: block === null,
    block,
  };
}
