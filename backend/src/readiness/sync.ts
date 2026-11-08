import type { KycCase } from "../kyc/store.js";
import type { Blocker } from "./types.js";

/**
 * Keep blockers on the application across re-checks (One-Sitting Completion): the same problem
 * keeps its id and the day it was opened; a problem that is gone is marked resolved - "auto" when
 * the owner's own fix or the system cleared it, "staff" (waived) when a reviewer's approval did.
 * Resolved blockers stay as history (the tracker and the metrics use them).
 */
export function syncBlockers(c: KycCase, computed: Blocker[], today: string): void {
  const previous = new Map(c.blockers.map((b) => [b.id, b]));
  const next: Blocker[] = [];
  for (const b of computed) {
    const p = previous.get(b.id);
    const stillOpen = p && (p.status === "open" || p.status === "in_progress");
    next.push({ ...b, openedOn: stillOpen ? p.openedOn : b.openedOn });
    previous.delete(b.id);
  }
  for (const p of previous.values()) {
    if (p.status === "open" || p.status === "in_progress") {
      const byStaff = p.responsibleParty === "accel_ops" && c.review?.decision === "approved";
      next.push({ ...p, status: byStaff ? "waived" : "resolved", resolvedOn: today, resolvedBy: byStaff ? "staff" : "auto" });
    } else {
      next.push(p);
    }
  }
  c.blockers = next;
}

export const openBlockers = (c: KycCase) => c.blockers.filter((b) => b.status === "open" || b.status === "in_progress");
