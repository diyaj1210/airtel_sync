/**
 * Order tracker (step 5). Pure: dates are passed in, never read from the clock.
 *
 * Stages (KYC and payment happen before the order exists, solution_outline_chat/01-self-serve-app.md):
 *   KYC verified -> Payment received / order placed -> Installation scheduled -> Installed -> Activated
 * Expected date per product line = order date + its typical_install_days (catalogue);
 * the bundle is ready when its slowest line is: order date + max(typical_install_days).
 */
import { addDays } from "../clock.js";
import type { Quote } from "../quote/quote.js";

export const STAGES = ["kyc_verified", "order_placed", "installation_scheduled", "installed", "activated"] as const;
export type Stage = (typeof STAGES)[number];

/** The installation visit is booked for the day after the order (or the ready day, if sooner). */
export const SCHEDULING_DAYS = 1;

export interface OrderLine {
  productId: string;
  name: string;
  qty: number;
  unit: string;
  installDays: number;
  expectedOn: string;
}

export interface StageState {
  stage: Stage;
  expectedOn: string;
  doneOn: string | null;
}

/** A stage update for the owner. The app words it (English / Hindi) from the stage and params. */
export interface TrackerNotification {
  id: number;
  stage: Stage;
  on: string;
  params: Record<string, string>;
}

export interface Plan {
  lines: OrderLine[];
  stages: StageState[];
  readyOn: string;
}

/** Expected dates for an order placed on `placedOn`, from the accepted quote's selected lines. */
export function planOrder(quote: Quote, placedOn: string, kycVerifiedOn: string): Plan {
  const selected = quote.items.filter((i) => i.selected);
  if (selected.length === 0) throw new Error("An order needs at least one product");
  const lines = selected.map((i) => ({
    productId: i.productId,
    name: i.name,
    qty: i.qty,
    unit: i.unit,
    installDays: i.installDays,
    expectedOn: addDays(placedOn, i.installDays),
  }));
  const readyDays = Math.max(...lines.map((l) => l.installDays));
  const readyOn = addDays(placedOn, readyDays);
  const scheduledOn = addDays(placedOn, Math.min(SCHEDULING_DAYS, readyDays));
  return {
    lines,
    readyOn,
    stages: [
      { stage: "kyc_verified", expectedOn: kycVerifiedOn, doneOn: kycVerifiedOn },
      { stage: "order_placed", expectedOn: placedOn, doneOn: placedOn },
      { stage: "installation_scheduled", expectedOn: scheduledOn, doneOn: null },
      { stage: "installed", expectedOn: readyOn, doneOn: null },
      // Service is switched on the day the installation is finished.
      { stage: "activated", expectedOn: readyOn, doneOn: null },
    ],
  };
}

/** Index of the last stage that is done. */
export function currentStageIndex(stages: StageState[]): number {
  let last = -1;
  stages.forEach((s, i) => {
    if (s.doneOn) last = i;
  });
  return last;
}

/** The stage after the current one, or null when the order is activated. */
export function nextStage(stages: StageState[]): StageState | null {
  return stages[currentStageIndex(stages) + 1] ?? null;
}

/** Notification for a stage that has just been done. */
export function notificationFor(id: number, stage: StageState, readyOn: string): TrackerNotification {
  if (!stage.doneOn) throw new Error(`Stage ${stage.stage} is not done`);
  return { id, stage: stage.stage, on: stage.doneOn, params: { readyOn, expectedOn: stage.expectedOn } };
}
