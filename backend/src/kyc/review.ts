/**
 * Manual review of KYC exceptions (back-office, step 7). The checks send a case to manual review
 * when a person must look (cancelled / suspended GSTIN, details that differ from the registry, a
 * signatory who is not the owner ...). A reviewer (operations desk) approves or rejects it.
 *
 * - A decision applies only to the exact problems the reviewer saw. If the owner changes anything
 *   that changes the problems (a new document, other details), the decision lapses and the case
 *   is checked afresh.
 * - Approval lets the owner e-sign and pay. It never overrides the catalogue rules: products that
 *   need a valid, Active GSTIN stay blocked without one (checkout refuses them).
 * - Cases that need a fix by the owner are not decided by a reviewer; the owner fixes them.
 */
import type { Registries } from "./registry.js";
import { evaluateKyc, type KycEvaluation, type KycIssue, type KycStatus } from "./checks.js";
import type { KycCase } from "./store.js";

export const REVIEW_DECISIONS = ["approved", "rejected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const MAX_REVIEW_NOTE = 300;

export interface KycReview {
  decision: ReviewDecision;
  /** Staff code of the reviewer. */
  by: string;
  on: string;
  /** Shown to the owner (identifiers masked when saved). */
  note: string | null;
  /** The problems the decision was made on. */
  issueKey: string;
}

/** Status as the owner and checkout see it: the checks' result, after a reviewer's decision. */
export type CaseStatus = KycStatus | "rejected";

export type CaseEvaluation = Omit<KycEvaluation, "status"> & {
  status: CaseStatus;
  /** The reviewer's decision, when it applies to the current problems. */
  review: { decision: ReviewDecision; on: string; note: string | null } | null;
};

export const issueKey = (issues: KycIssue[]): string =>
  issues
    .map((i) => `${i.code}:${i.doc ?? ""}`)
    .sort()
    .join("|");

export function applyReview(evaluation: KycEvaluation, review: KycReview | null): CaseEvaluation {
  const applies = !!review && evaluation.status === "manual_review" && review.issueKey === issueKey(evaluation.issues);
  if (!applies) return { ...evaluation, review: null };
  return {
    ...evaluation,
    status: review.decision === "approved" ? "pass" : "rejected",
    review: { decision: review.decision, on: review.on, note: review.note },
  };
}

/** The case's checks with the reviewer's decision applied (used by KYC, e-sign and checkout). */
export function evaluateCase(c: KycCase, registries: Registries, today: string): CaseEvaluation {
  return applyReview(
    evaluateKyc(
      {
        business: c.business,
        documents: c.documents,
        submitted: c.submitted,
        certGstinConfirmed: c.certGstinConfirmed,
        signatoryAuthorised: !!c.authorisation?.signed,
      },
      registries,
      today,
    ),
    c.review,
  );
}
