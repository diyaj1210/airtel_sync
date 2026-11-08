/** Types and calls for the backend quote API (backend/src/quote). */

export type Segment = "micro" | "prof" | "multi" | "mfg";
export type Variant = "standard" | "lite";
export type GstinStatus = "active" | "inactive" | "none";

export interface BusinessProfile {
  cityTier: 1 | 2;
  employees: number;
  sites: number;
  gstin: GstinStatus;
}

export interface QuoteRequest {
  segment: Segment;
  variant: Variant;
  profile: BusinessProfile;
  exclude: string[];
  include: string[];
}

/** A reason something is blocked: a catalogue rule or a bundle dependency. */
export interface Block {
  code: string;
  message: string;
  params: Record<string, unknown>;
}

export interface QuoteItem {
  productId: string;
  name: string;
  description: string;
  category: string;
  unit: string;
  kind: "core" | "addon";
  qty: number;
  unitPriceInr: number;
  monthlyInr: number;
  setupInr: number;
  minContractMonths: number;
  installDays: number;
  selected: boolean;
  replaces?: string;
  canToggle: boolean;
  blockedBy: Block[];
}

export interface Quote {
  templateId: string;
  name: string;
  segment: Segment;
  variant: Variant;
  variants: Variant[];
  profile: BusinessProfile;
  items: QuoteItem[];
  unavailable: { productId: string; name: string; violations: Block[] }[];
  totals: { monthlyInr: number; monthlyMaxInr: number; setupInr: number; contractMonths: number; installDays: number };
}

export interface AcceptedQuote {
  quoteId: string;
  acceptedOn: string;
  validUntil: string;
  quote: Quote;
}

export interface City {
  name: string;
  state: string;
  tier: 1 | 2;
}

export interface ProductSummary {
  id: string;
  name: string;
}

export interface SelectionProblem {
  productId: string;
  action: "add" | "remove";
  reasons: Block[];
}

/** The server refused a selection (a rule would be broken). */
export class NotAllowedError extends Error {
  constructor(readonly problems: SelectionProblem[]) {
    super("not_allowed");
  }
}

export class ApiError extends Error {}

type FetchFn = typeof fetch;

/** JSON call to the backend. Network failure or a non-2xx status -> ApiError (422 -> NotAllowedError). */
export async function call<T>(fetchFn: FetchFn, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError("network");
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(`HTTP ${res.status}`);
  }
  if (res.status === 422) throw new NotAllowedError((data as { problems: SelectionProblem[] }).problems);
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`);
  return data as T;
}

export const fetchCities = async (fetchFn: FetchFn = fetch) =>
  (await call<{ cities: City[] }>(fetchFn, "/api/cities")).cities;

export const fetchProducts = async (fetchFn: FetchFn = fetch): Promise<ProductSummary[]> =>
  (await call<{ products: ProductSummary[] }>(fetchFn, "/api/catalogue")).products.map(({ id, name }) => ({ id, name }));

export const fetchQuote = (req: QuoteRequest, fetchFn: FetchFn = fetch) => call<Quote>(fetchFn, "/api/quote", req);

export const acceptQuote = (req: QuoteRequest, fetchFn: FetchFn = fetch) => call<AcceptedQuote>(fetchFn, "/api/quotes", req);
