import type { Catalogue } from "./catalogue.js";
import { priceBundle, type BundlePrice } from "./pricing.js";
import { checkProduct, type RuleViolation } from "./rules.js";
import type { BundleLine, BusinessProfile, ProductId, Segment } from "./types.js";

/**
 * Segment bundle templates from solution_outline_chat/bundles-and-pricing.md.
 * A template proposes lines for a profile; the rules engine then removes every line that is not
 * eligible (repeating until stable, because removing a line can break another line's
 * requires_one_of), and a removed line may be swapped for its fallback lines.
 */

export type BundleVariant = "standard" | "lite";

interface TemplateLine extends BundleLine {
  /** Lines to add instead if this line is not eligible. */
  fallback?: BundleLine[];
}

interface AddOnDef {
  productId: ProductId;
  qty: (p: BusinessProfile) => number;
  /** Taking this add-on replaces that product (upgrade), e.g. P06 replaces P05. */
  replaces?: ProductId;
}

interface Template {
  id: string;
  segment: Segment;
  variant: BundleVariant;
  name: string;
  lines: (p: BusinessProfile) => TemplateLine[];
  addOns: AddOnDef[];
}

const perSite = (p: BusinessProfile) => p.sites;
const perEmployee = (p: BusinessProfile) => p.employees;
const fixed = (n: number) => () => n;

const MICRO_ADD_ONS: AddOnDef[] = [
  { productId: "P19", qty: fixed(1) }, // Cloud POS
  { productId: "P23", qty: fixed(1) }, // Cloud CCTV (per camera)
  { productId: "P18", qty: fixed(1) }, // Website + domain
  { productId: "P15", qty: fixed(1) }, // WhatsApp Business API (needs GSTIN)
];

export const TEMPLATES: readonly Template[] = [
  {
    id: "dukaan-digital-starter",
    segment: "micro",
    variant: "standard",
    name: "Dukaan Digital Starter",
    lines: (p) => [
      { productId: "P04", qty: perSite(p) },
      { productId: "P07", qty: 1 },
      { productId: "P22", qty: perSite(p) },
    ],
    addOns: MICRO_ADD_ONS,
  },
  {
    id: "dukaan-digital-starter-lite",
    segment: "micro",
    variant: "lite",
    name: "Dukaan Digital Starter Lite (6 months)",
    lines: (p) => [
      { productId: "P04", qty: perSite(p) },
      { productId: "P07", qty: 1 },
    ],
    addOns: [{ productId: "P22", qty: perSite }, ...MICRO_ADD_ONS],
  },
  {
    id: "office-pro",
    segment: "prof",
    variant: "standard",
    name: "Office Pro",
    lines: (p) => [
      { productId: "P02", qty: perSite(p) },
      { productId: "P07", qty: 2 },
      { productId: "P16", qty: perEmployee(p) },
      { productId: "P17", qty: 1 },
      { productId: "P20", qty: perEmployee(p) },
      { productId: "P09", qty: perSite(p) },
    ],
    addOns: [
      { productId: "P12", qty: fixed(2) }, // Cloud telephony channels
      { productId: "P11", qty: fixed(1) }, // Static IP
      { productId: "P14", qty: fixed(1) }, // Business SMS
    ],
  },
  {
    id: "chain-connect",
    segment: "multi",
    variant: "standard",
    name: "Chain Connect",
    lines: (p) => [
      { productId: "P02", qty: perSite(p) },
      { productId: "P09", qty: perSite(p) },
      { productId: "P23", qty: 2 * perSite(p) },
      { productId: "P22", qty: perSite(p) },
      { productId: "P10", qty: perSite(p) },
      { productId: "P13", qty: 1 },
      { productId: "P08", qty: perSite(p) },
    ],
    addOns: [
      { productId: "P21", qty: perSite }, // Managed firewall
      { productId: "P12", qty: fixed(2) },
      { productId: "P15", qty: fixed(1) },
      { productId: "P19", qty: perSite }, // POS, one counter per site
      { productId: "P25", qty: fixed(1) }, // Fleet tracker
    ],
  },
  {
    id: "factory-connect",
    segment: "mfg",
    variant: "standard",
    name: "Factory Connect",
    lines: (p) => [
      {
        productId: "P05",
        qty: perSite(p),
        // Leased line needs >= 10 employees and an active GSTIN; otherwise fibre + static IP.
        fallback: [
          { productId: "P02", qty: perSite(p) },
          { productId: "P11", qty: 1 },
          { productId: "P20", qty: perEmployee(p) },
        ],
      },
      { productId: "P21", qty: perSite(p) },
      { productId: "P24", qty: 5 },
      { productId: "P16", qty: perEmployee(p) },
      { productId: "P08", qty: 2 },
    ],
    addOns: [
      { productId: "P06", qty: perSite, replaces: "P05" }, // upgrade to 100 Mbps leased line
      { productId: "P17", qty: fixed(1) },
      { productId: "P20", qty: perEmployee },
      { productId: "P25", qty: fixed(1) },
      { productId: "P12", qty: fixed(2) },
    ],
  },
];

export function findTemplate(segment: Segment, variant: BundleVariant): Template | undefined {
  return TEMPLATES.find((t) => t.segment === segment && t.variant === variant);
}

export interface RemovedLine extends BundleLine {
  violations: RuleViolation[];
}

export interface AddOnOption extends BundleLine {
  replaces?: ProductId;
  eligible: boolean;
  violations: RuleViolation[];
}

export interface BuiltBundle {
  templateId: string;
  segment: Segment;
  variant: BundleVariant;
  name: string;
  profile: BusinessProfile;
  /** Every line here passes every catalogue rule for this profile. */
  lines: BundleLine[];
  /** Template lines the rules engine removed, with the reasons (e.g. "add a GSTIN to unlock"). */
  removed: RemovedLine[];
  price: BundlePrice;
  addOns: AddOnOption[];
}

/** Remove ineligible lines until every remaining line passes; swap in fallbacks where defined. */
export function filterToEligible(
  catalogue: Catalogue,
  candidates: readonly TemplateLine[],
  profile: BusinessProfile,
): { lines: BundleLine[]; removed: RemovedLine[] } {
  let lines: TemplateLine[] = [...candidates];
  const removed: RemovedLine[] = [];
  for (;;) {
    const ids = lines.map((l) => l.productId);
    const failing = new Map<ProductId, RuleViolation[]>();
    for (const line of lines) {
      const v = checkProduct(catalogue.get(line.productId), profile, ids);
      if (v.length > 0) failing.set(line.productId, v);
    }
    if (failing.size === 0) break;

    const kept = lines.filter((l) => !failing.has(l.productId));
    for (const line of lines) {
      const violations = failing.get(line.productId);
      if (!violations) continue;
      removed.push({ productId: line.productId, qty: line.qty, violations });
      for (const fb of line.fallback ?? []) {
        const alreadyUsed =
          kept.some((l) => l.productId === fb.productId) || removed.some((r) => r.productId === fb.productId);
        if (!alreadyUsed) kept.push({ productId: fb.productId, qty: fb.qty });
      }
    }
    lines = kept;
  }
  return { lines: lines.map(({ productId, qty }) => ({ productId, qty })), removed };
}

export function buildBundle(
  catalogue: Catalogue,
  segment: Segment,
  profile: BusinessProfile,
  variant: BundleVariant = "standard",
): BuiltBundle {
  const template = findTemplate(segment, variant);
  if (!template) throw new Error(`No "${variant}" bundle for segment "${segment}"`);

  const { lines, removed } = filterToEligible(catalogue, template.lines(profile), profile);
  if (lines.length === 0) throw new Error(`No eligible products in ${template.name} for this business`);

  const inBundle = new Set(lines.map((l) => l.productId));
  const addOns: AddOnOption[] = template.addOns
    .filter((a) => !inBundle.has(a.productId))
    .filter((a) => !a.replaces || inBundle.has(a.replaces))
    .map((a) => {
      const ids = new Set(inBundle);
      if (a.replaces) ids.delete(a.replaces);
      ids.add(a.productId);
      const violations = checkProduct(catalogue.get(a.productId), profile, ids);
      return {
        productId: a.productId,
        qty: a.qty(profile),
        ...(a.replaces ? { replaces: a.replaces } : {}),
        eligible: violations.length === 0,
        violations,
      };
    });

  return {
    templateId: template.id,
    segment,
    variant,
    name: template.name,
    profile,
    lines,
    removed,
    price: priceBundle(catalogue, lines),
    addOns,
  };
}
