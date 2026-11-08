import type { Catalogue } from "../catalogue/catalogue.js";
import type { ProductId } from "../catalogue/types.js";
import { addDays } from "../clock.js";

/**
 * Time to value: the ONE function that says when each product of a bundle is ready (add-on A3).
 * The quote, the One-Sitting Completion check and the order tracker all call it, so the three
 * always show the same dates. Every date is an estimate ("approximately"), never a guarantee.
 *
 *   product ready  = start + its typical_install_days (product_catalogue.csv)
 *                    - but a product with requires_one_of is never ready before the base link it
 *                      depends on: max(own days, base link days)
 *   bundle ready   = the latest product ready date
 *   Day-1 products = ready within TIMELINE_RULES.dayOneMaxDays (usable while the internet is installed)
 */

/** The timing rules, in one place. */
export const TIMELINE_RULES = {
  /** A dependent product (requires_one_of) waits for the base product it needs, as present in the bundle. */
  dependentWaitsForBase: true,
  /** "Day 1": products ready this many days after the start, or sooner. */
  dayOneMaxDays: 1,
  /** Verification still needs a person (Needs review): everything starts this many calendar days later. */
  reviewDelayDays: 1,
  /**
   * Long or complex installations: shown as a service window (days from - to) with a site survey,
   * and partner assistance is recommended. Proposed planning windows (MOCK: no field data).
   */
  serviceWindows: {
    P05: [21, 30],
    P06: [30, 45],
    P10: [14, 21],
    P21: [10, 14],
    P24: [10, 14],
  } as Readonly<Record<string, readonly [number, number]>>,
} as const;

export interface TimelineItem {
  productId: ProductId;
  name: string;
  qty: number;
  unit: string;
}

export interface TimelineLine extends TimelineItem {
  /** typical_install_days of the product itself. */
  ownDays: number;
  /** Days until ready, after waiting for its base link. */
  days: number;
  /** The base link it waits for, when that made it later. */
  waitsFor: ProductId | null;
  readyOn: string;
  dayOne: boolean;
  /** Service window (days from - to) for long / complex installations. */
  window: readonly [number, number] | null;
}

export interface Timeline {
  approximate: true;
  start: string;
  lines: TimelineLine[];
  readyDays: number;
  readyOn: string;
  slowest: TimelineLine;
  dayOne: ProductId[];
  /** "What you can start using, and when": lines grouped by day, earliest first. */
  groups: { days: number; readyOn: string; productIds: ProductId[] }[];
  /** For a bundle with a long / complex installation: the service window and a site survey. */
  window: { from: number; to: number; siteSurvey: true; productIds: ProductId[] } | null;
}

export function computeTimeline(items: readonly TimelineItem[], catalogue: Catalogue, start: string): Timeline {
  if (items.length === 0) throw new Error("A timeline needs at least one product");
  const present = new Set(items.map((i) => i.productId));
  const memo = new Map<ProductId, { days: number; waitsFor: ProductId | null }>();
  const daysOf = (id: ProductId, seen: Set<ProductId>): { days: number; waitsFor: ProductId | null } => {
    const known = memo.get(id);
    if (known) return known;
    const own = catalogue.get(id).installDays;
    let result = { days: own, waitsFor: null as ProductId | null };
    if (TIMELINE_RULES.dependentWaitsForBase && !seen.has(id)) {
      // Needs at least one of its bases: ready once the earliest of the bases in this bundle is.
      const bases = catalogue.get(id).requiresOneOf.filter((b) => present.has(b));
      if (bases.length > 0) {
        const next = new Set(seen).add(id);
        const base = bases.map((b) => ({ id: b, days: daysOf(b, next).days })).reduce((a, b) => (b.days < a.days ? b : a));
        if (base.days > own) result = { days: base.days, waitsFor: base.id };
      }
    }
    memo.set(id, result);
    return result;
  };

  const lines: TimelineLine[] = items.map((i) => {
    const { days, waitsFor } = daysOf(i.productId, new Set());
    return {
      ...i,
      ownDays: catalogue.get(i.productId).installDays,
      days,
      waitsFor,
      readyOn: addDays(start, days),
      dayOne: days <= TIMELINE_RULES.dayOneMaxDays,
      window: TIMELINE_RULES.serviceWindows[i.productId] ?? null,
    };
  });
  const slowest = lines.reduce((a, b) => (b.days > a.days ? b : a));
  const byDay = new Map<number, ProductId[]>();
  for (const l of lines) byDay.set(l.days, [...(byDay.get(l.days) ?? []), l.productId]);
  const windowed = lines.filter((l) => l.window);
  return {
    approximate: true,
    start,
    lines,
    readyDays: slowest.days,
    readyOn: slowest.readyOn,
    slowest,
    dayOne: lines.filter((l) => l.dayOne).map((l) => l.productId),
    groups: [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([days, productIds]) => ({ days, readyOn: addDays(start, days), productIds })),
    window: windowed.length
      ? { from: slowest.days, to: Math.max(...windowed.map((l) => l.window![1]), slowest.days), siteSurvey: true, productIds: windowed.map((l) => l.productId) }
      : null,
  };
}

/** When verification is expected to be complete: today, or a day later if a person must review it. */
export const verificationStart = (today: string, needsReview: boolean) => (needsReview ? addDays(today, TIMELINE_RULES.reviewDelayDays) : today);

/** The same timeline from another start date (the order date, or when verification completes). */
export function shiftTimeline(t: Timeline, start: string): Timeline {
  const lines = t.lines.map((l) => ({ ...l, readyOn: addDays(start, l.days) }));
  const slowest = lines.find((l) => l.productId === t.slowest.productId) ?? lines[0]!;
  return {
    ...t,
    start,
    lines,
    slowest,
    readyOn: addDays(start, t.readyDays),
    groups: t.groups.map((g) => ({ ...g, readyOn: addDays(start, g.days) })),
  };
}
