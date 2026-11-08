/** Types and calls for checkout (MOCK payment) and the order tracker (backend/src/orders). */

export const STAGES = ["kyc_verified", "order_placed", "installation_scheduled", "installed", "activated"] as const;
export type Stage = (typeof STAGES)[number];
export const PAYMENT_METHODS = ["upi", "card", "netbanking"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type CheckoutBlock = "kyc_not_signed" | "no_quote" | "quote_expired" | "quote_needs_active_gstin" | "already_paid";

export interface Checkout {
  quoteId: string | null;
  bundle: string | null;
  monthlyInr: number;
  setupInr: number;
  dueNowInr: number;
  contractMonths: number;
  installDays: number;
  blockedProducts: { productId: string; name: string }[];
  canPay: boolean;
  block: CheckoutBlock | null;
  orderId: string | null;
}

export interface Order {
  orderId: string;
  placedOn: string;
  payment: { mock: true; reference: string; method: PaymentMethod; paidOn: string; setupInr: number; firstMonthInr: number; totalInr: number };
  bundle: { name: string; monthlyInr: number; setupInr: number; contractMonths: number };
  lines: { productId: string; name: string; qty: number; unit: string; installDays: number; expectedOn: string }[];
  stages: { stage: Stage; expectedOn: string; doneOn: string | null }[];
  currentStage: Stage;
  nextStage: { stage: Stage; expectedOn: string } | null;
  readyOn: string;
  activated: boolean;
  notifications: { id: number; stage: Stage; on: string; params: Record<string, string> }[];
}

export class OrderError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly orderId?: string,
  ) {
    super(code);
  }
}

type FetchFn = typeof fetch;

async function send<T>(fetchFn: FetchFn, method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method,
      headers: body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new OrderError(0, "network");
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    if (res.ok) throw new OrderError(res.status, "bad_response");
  }
  if (!res.ok) {
    throw new OrderError(res.status, typeof data.error === "string" ? data.error : `http_${res.status}`, typeof data.orderId === "string" ? data.orderId : undefined);
  }
  return data as T;
}

export const getCheckout = (caseId: string, fetchFn: FetchFn = fetch) =>
  send<Checkout>(fetchFn, "GET", `/api/orders/checkout/${encodeURIComponent(caseId)}`);

export const pay = (caseId: string, method: PaymentMethod, simulateFailure: boolean, fetchFn: FetchFn = fetch) =>
  send<Order>(fetchFn, "POST", "/api/orders", { caseId, method, ...(simulateFailure ? { simulateFailure: true } : {}) });

export const getOrder = (orderId: string, fetchFn: FetchFn = fetch) => send<Order>(fetchFn, "GET", `/api/orders/${encodeURIComponent(orderId)}`);

export const advanceOrder = (orderId: string, fetchFn: FetchFn = fetch) =>
  send<Order>(fetchFn, "POST", `/api/orders/${encodeURIComponent(orderId)}/advance`, {});

/** "ord-1a2b3c4d" or " ORD-1A2B3C4D " -> "ORD-1A2B3C4D"; null if it is not an order reference. */
export function cleanOrderId(raw: string): string | null {
  const id = raw.trim().toUpperCase();
  return /^ORD-[0-9A-F]{8}$/.test(id) ? id : null;
}
