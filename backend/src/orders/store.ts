import { randomBytes } from "node:crypto";
import { currentStageIndex, notificationFor, planOrder, type OrderLine, type StageState, type TrackerNotification } from "./tracker.js";
import type { Quote } from "../quote/quote.js";

/**
 * Orders, in memory (prototype: lost when the backend restarts). An order holds no personal data:
 * no names, no identifiers, no payment details beyond the method type and the amount.
 */

export const PAYMENT_METHODS = ["upi", "card", "netbanking"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const ORDER_ID_RE = /^ORD-[0-9A-F]{8}$/;
export const MAX_ORDERS = 1000;

export interface Order {
  orderId: string;
  caseId: string;
  quoteId: string;
  placedOn: string;
  /** MOCK payment: no money moves. */
  payment: { reference: string; method: PaymentMethod; paidOn: string; setupInr: number; firstMonthInr: number; totalInr: number };
  bundle: { name: string; monthlyInr: number; setupInr: number; contractMonths: number };
  lines: OrderLine[];
  stages: StageState[];
  readyOn: string;
  notifications: TrackerNotification[];
}

const hexId = (prefix: string) => () => `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`;

export class OrderStore {
  private readonly orders = new Map<string, Order>();
  private readonly byCase = new Map<string, string>();

  constructor(
    private readonly newOrderId: () => string = hexId("ORD"),
    private readonly newPaymentRef: () => string = hexId("PAY"),
    private readonly maxOrders = MAX_ORDERS,
  ) {}

  /** Place the order for a paid quote. One order per KYC case. */
  place(input: { caseId: string; quoteId: string; quote: Quote; method: PaymentMethod; placedOn: string; kycVerifiedOn: string }): Order {
    if (this.byCase.has(input.caseId)) throw new Error("This KYC case already has an order");
    let orderId = this.newOrderId();
    for (let tries = 0; this.orders.has(orderId); tries++) {
      if (tries > 10) throw new Error("Could not generate a unique order id");
      orderId = this.newOrderId();
    }
    while (this.orders.size >= this.maxOrders) {
      const oldest = this.orders.values().next().value!;
      this.orders.delete(oldest.orderId);
      this.byCase.delete(oldest.caseId);
    }
    const { totals } = input.quote;
    const plan = planOrder(input.quote, input.placedOn, input.kycVerifiedOn);
    const order: Order = {
      orderId,
      caseId: input.caseId,
      quoteId: input.quoteId,
      placedOn: input.placedOn,
      payment: {
        reference: this.newPaymentRef(),
        method: input.method,
        paidOn: input.placedOn,
        setupInr: totals.setupInr,
        firstMonthInr: totals.monthlyInr,
        totalInr: totals.setupInr + totals.monthlyInr,
      },
      bundle: { name: input.quote.name, monthlyInr: totals.monthlyInr, setupInr: totals.setupInr, contractMonths: totals.contractMonths },
      lines: plan.lines,
      stages: plan.stages,
      readyOn: plan.readyOn,
      notifications: [],
    };
    // The two stages already done when the order is placed.
    for (const stage of plan.stages.filter((s) => s.doneOn)) order.notifications.push(notificationFor(order.notifications.length + 1, stage, plan.readyOn));
    this.orders.set(orderId, order);
    this.byCase.set(input.caseId, orderId);
    return order;
  }

  /**
   * MOCK: the next stage happens, on its expected date (there is no real installation team).
   * Returns null when the order is already activated.
   */
  advance(order: Order): Order | null {
    const next = order.stages[currentStageIndex(order.stages) + 1];
    if (!next) return null;
    next.doneOn = next.expectedOn;
    order.notifications.push(notificationFor(order.notifications.length + 1, next, order.readyOn));
    return order;
  }

  get(orderId: string): Order | undefined {
    return ORDER_ID_RE.test(orderId) ? this.orders.get(orderId) : undefined;
  }

  forCase(caseId: string): Order | undefined {
    const id = this.byCase.get(caseId);
    return id ? this.orders.get(id) : undefined;
  }
}
