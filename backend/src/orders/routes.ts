import { Router } from "express";
import type { Catalogue } from "../catalogue/catalogue.js";
import { evaluateKyc } from "../kyc/checks.js";
import type { Registries } from "../kyc/registry.js";
import type { KycCaseStore } from "../kyc/store.js";
import type { Logger } from "../logger.js";
import type { QuoteStore } from "../quote/store.js";
import { checkout } from "./checkout.js";
import { PAYMENT_METHODS, type Order, type OrderStore, type PaymentMethod } from "./store.js";
import { currentStageIndex, nextStage } from "./tracker.js";

/**
 *   GET  /api/orders/checkout/:caseId   what is due now for a signed KYC case, and whether it can be paid
 *   POST /api/orders                    { caseId, method: upi|card|netbanking, simulateFailure? } -> MOCK payment -> order
 *   GET  /api/orders/:orderId           order status for the owner (no login: the reference is the key; no personal data inside)
 *   POST /api/orders/:orderId/advance   MOCK: the next stage happens on its expected date (demo of the timeline)
 */

export interface OrderDeps {
  catalogue: Catalogue;
  quoteStore: QuoteStore;
  registries: Registries;
  kycStore: KycCaseStore;
  orderStore: OrderStore;
  today: () => string;
  logger: Logger;
}

export function orderView(order: Order) {
  const current = currentStageIndex(order.stages);
  const next = nextStage(order.stages);
  return {
    orderId: order.orderId,
    placedOn: order.placedOn,
    payment: { mock: true, ...order.payment },
    bundle: order.bundle,
    lines: order.lines,
    stages: order.stages,
    currentStage: order.stages[current]!.stage,
    nextStage: next && { stage: next.stage, expectedOn: next.expectedOn },
    readyOn: order.readyOn,
    activated: next === null,
    // Newest first, as in a message inbox.
    notifications: [...order.notifications].reverse(),
  };
}

export function ordersRouter(deps: OrderDeps): Router {
  const { catalogue, quoteStore, registries, kycStore, orderStore, today, logger } = deps;
  const router = Router();

  const checkoutFor = (caseId: string) => {
    const kycCase = kycStore.get(caseId);
    if (!kycCase) return null;
    const evaluation = evaluateKyc({ business: kycCase.business, documents: kycCase.documents, submitted: kycCase.submitted }, registries, today());
    const quote = kycCase.quoteId ? quoteStore.get(kycCase.quoteId) : undefined;
    return { kycCase, quote, result: checkout(kycCase, evaluation, quote, catalogue, today(), orderStore.forCase(caseId)?.orderId ?? null) };
  };

  router.get("/orders/checkout/:caseId", (req, res) => {
    const found = checkoutFor(req.params.caseId);
    if (!found) return void res.status(404).json({ error: "case_not_found" });
    res.json({ ...found.result, orderId: orderStore.forCase(req.params.caseId)?.orderId ?? null });
  });

  router.post("/orders", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const method = body.method as PaymentMethod;
    if (typeof body.caseId !== "string" || !(PAYMENT_METHODS as readonly string[]).includes(method)) {
      return void res.status(400).json({ error: "invalid_request" });
    }
    if (body.simulateFailure !== undefined && typeof body.simulateFailure !== "boolean") return void res.status(400).json({ error: "invalid_request" });
    const found = checkoutFor(body.caseId);
    if (!found) return void res.status(404).json({ error: "case_not_found" });
    const { kycCase, quote, result } = found;
    if (!result.canPay) {
      const existing = orderStore.forCase(kycCase.caseId);
      return void res.status(409).json({ error: result.block, ...(existing ? { orderId: existing.orderId } : {}) });
    }
    if (body.simulateFailure === true) {
      // MOCK: a declined payment, so the app's retry path can be shown. No order is created.
      logger.info("payment failed (MOCK)", { caseId: kycCase.caseId, method });
      return void res.status(402).json({ error: "payment_failed", mock: true });
    }
    const order = orderStore.place({
      caseId: kycCase.caseId,
      quoteId: quote!.quoteId,
      quote: quote!.quote,
      method,
      placedOn: today(),
      kycVerifiedOn: kycCase.esign!.signed!.signedOn,
    });
    logger.info("order placed (MOCK payment)", { orderId: order.orderId, caseId: kycCase.caseId, method, totalInr: order.payment.totalInr });
    res.status(201).json(orderView(order));
  });

  router.get("/orders/:orderId", (req, res) => {
    const order = orderStore.get(req.params.orderId);
    if (!order) return void res.status(404).json({ error: "order_not_found" });
    res.json(orderView(order));
  });

  router.post("/orders/:orderId/advance", (req, res) => {
    const order = orderStore.get(req.params.orderId);
    if (!order) return void res.status(404).json({ error: "order_not_found" });
    if (!orderStore.advance(order)) return void res.status(409).json({ error: "already_activated" });
    logger.info("order stage (MOCK)", { orderId: order.orderId, stage: order.stages[currentStageIndex(order.stages)]!.stage });
    res.json(orderView(order));
  });

  return router;
}
