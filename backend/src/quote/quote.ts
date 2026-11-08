import { buildBundle, type BuiltBundle, type BundleVariant } from "../catalogue/bundles.js";
import type { Catalogue } from "../catalogue/catalogue.js";
import { priceBundle } from "../catalogue/pricing.js";
import { checkBundle, type RuleViolation } from "../catalogue/rules.js";
import type { BundleLine, BusinessProfile, ProductId, Segment } from "../catalogue/types.js";

/**
 * Quote = a segment bundle (step 1) plus the owner's changes: core lines they removed and
 * add-ons they switched on. Every change is re-checked with the rules engine, and for every
 * item the quote says whether it can be toggled right now and, if not, why.
 */

export interface QuoteRequest {
  segment: Segment;
  variant: BundleVariant;
  profile: BusinessProfile;
  /** Core bundle products the owner removed. */
  exclude: ProductId[];
  /** Add-ons the owner switched on. */
  include: ProductId[];
}

/** Why an item cannot be toggled: a catalogue rule, or a dependency of the bundle itself. */
export type ToggleBlock =
  | RuleViolation
  | { code: "REQUIRED_BY"; message: string; params: { products: string[] } }
  | { code: "LAST_ITEM"; message: string; params: Record<string, never> }
  | { code: "REPLACED_BY"; message: string; params: { product: string } };

export interface QuoteItem {
  productId: ProductId;
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
  /** For an upgrade add-on: the core product it replaces. */
  replaces?: ProductId;
  canToggle: boolean;
  /** Reasons the toggle is blocked (empty when canToggle). */
  blockedBy: ToggleBlock[];
}

export interface Quote {
  templateId: string;
  name: string;
  segment: Segment;
  variant: BundleVariant;
  variants: BundleVariant[];
  profile: BusinessProfile;
  items: QuoteItem[];
  /** Products the rules engine left out for this business, with reasons. */
  unavailable: { productId: ProductId; name: string; violations: RuleViolation[] }[];
  totals: { monthlyInr: number; monthlyMaxInr: number; setupInr: number; contractMonths: number; installDays: number };
}

export interface SelectionProblem {
  productId: ProductId;
  action: "add" | "remove";
  reasons: ToggleBlock[];
}

export class QuoteSelectionError extends Error {
  constructor(readonly problems: SelectionProblem[]) {
    super("The requested changes are not allowed");
  }
}

export class QuoteRequestError extends Error {
  constructor(readonly details: string[]) {
    super(details.join("; "));
  }
}

interface Option {
  productId: ProductId;
  qty: number;
  kind: "core" | "addon";
  replaces?: ProductId;
}

/** Final bundle lines for a selection: core minus removed/replaced, plus chosen add-ons. */
function linesFor(options: Option[], selected: ReadonlySet<ProductId>): BundleLine[] {
  const replaced = new Set(options.filter((o) => o.replaces && selected.has(o.productId)).map((o) => o.replaces!));
  return options
    .filter((o) => selected.has(o.productId) && !replaced.has(o.productId))
    .map((o) => ({ productId: o.productId, qty: o.qty }));
}

function problemsFor(
  catalogue: Catalogue,
  options: Option[],
  selected: ReadonlySet<ProductId>,
  profile: BusinessProfile,
  changed: { productId: ProductId; action: "add" | "remove" }[],
): SelectionProblem[] {
  const lines = linesFor(options, selected);
  if (lines.length === 0) {
    return changed
      .filter((c) => c.action === "remove")
      .map((c) => ({
        productId: c.productId,
        action: "remove",
        reasons: [{ code: "LAST_ITEM", message: "A bundle needs at least one product.", params: {} }],
      }));
  }
  const failing = checkBundle(catalogue, lines, profile).lines.filter((l) => !l.eligible);
  const problems: SelectionProblem[] = [];
  for (const c of changed) {
    if (c.action === "add") {
      const own = failing.find((f) => f.productId === c.productId);
      if (own) problems.push({ productId: c.productId, action: "add", reasons: own.violations });
    } else {
      // Removing c breaks every failing line whose requires_one_of lists c.
      const dependents = failing.filter((f) => catalogue.get(f.productId).requiresOneOf.includes(c.productId));
      if (dependents.length > 0) {
        const names = dependents.map((d) => catalogue.get(d.productId).name);
        problems.push({
          productId: c.productId,
          action: "remove",
          reasons: [
            {
              code: "REQUIRED_BY",
              message: `Can't remove ${catalogue.get(c.productId).name}: ${names.join(", ")} need${names.length === 1 ? "s" : ""} it.`,
              params: { products: dependents.map((d) => d.productId) },
            },
          ],
        });
      }
    }
  }
  // Any other failure means an earlier change broke something; report it on that line.
  for (const f of failing) {
    if (!problems.some((p) => p.productId === f.productId) && !changed.some((c) => c.action === "remove" && catalogue.get(f.productId).requiresOneOf.includes(c.productId))) {
      problems.push({ productId: f.productId, action: "add", reasons: f.violations });
    }
  }
  return problems;
}

export function buildQuote(catalogue: Catalogue, req: QuoteRequest): Quote {
  const bundle: BuiltBundle = buildBundle(catalogue, req.segment, req.profile, req.variant);
  const options: Option[] = [
    ...bundle.lines.map((l) => ({ productId: l.productId, qty: l.qty, kind: "core" as const })),
    ...bundle.addOns.map((a) => ({
      productId: a.productId,
      qty: a.qty,
      kind: "addon" as const,
      ...(a.replaces ? { replaces: a.replaces } : {}),
    })),
  ];
  const coreIds = new Set(bundle.lines.map((l) => l.productId));
  const addOnIds = new Set(bundle.addOns.map((a) => a.productId));

  const details: string[] = [];
  const dupes = (ids: ProductId[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const id of new Set(dupes(req.exclude))) details.push(`exclude lists ${id} twice`);
  for (const id of new Set(dupes(req.include))) details.push(`include lists ${id} twice`);
  for (const id of req.exclude) if (!coreIds.has(id)) details.push(`exclude: ${id} is not in the ${bundle.name} bundle`);
  for (const id of req.include) if (!addOnIds.has(id)) details.push(`include: ${id} is not an add-on of the ${bundle.name} bundle`);
  if (details.length > 0) throw new QuoteRequestError(details);

  const selected = new Set<ProductId>([...[...coreIds].filter((id) => !req.exclude.includes(id)), ...req.include]);
  const changes = [
    ...req.exclude.map((productId) => ({ productId, action: "remove" as const })),
    ...req.include.map((productId) => ({ productId, action: "add" as const })),
  ];
  const problems = problemsFor(catalogue, options, selected, req.profile, changes);
  if (problems.length > 0) throw new QuoteSelectionError(problems);

  const lines = linesFor(options, selected);
  const price = priceBundle(catalogue, lines);
  const replacedBy = new Map(
    options.filter((o) => o.replaces && selected.has(o.productId)).map((o) => [o.replaces!, o.productId]),
  );

  const items: QuoteItem[] = options.map((o) => {
    const p = catalogue.get(o.productId);
    const isSelected = selected.has(o.productId) && !replacedBy.has(o.productId);
    let blockedBy: ToggleBlock[];
    const replacer = replacedBy.get(o.productId);
    if (replacer) {
      const name = catalogue.get(replacer).name;
      blockedBy = [{ code: "REPLACED_BY", message: `Replaced by ${name}.`, params: { product: replacer } }];
    } else {
      // Simulate the toggle and ask the rules engine.
      const next = new Set(selected);
      const action = isSelected ? "remove" : "add";
      if (isSelected) next.delete(o.productId);
      else next.add(o.productId);
      blockedBy = problemsFor(catalogue, options, next, req.profile, [{ productId: o.productId, action }]).flatMap(
        (pr) => pr.reasons,
      );
    }
    return {
      productId: o.productId,
      name: p.name,
      description: p.description,
      category: p.category,
      unit: p.unit,
      kind: o.kind,
      qty: o.qty,
      unitPriceInr: p.priceMinInr,
      monthlyInr: p.priceMinInr * o.qty,
      setupInr: p.setupInr * o.qty,
      minContractMonths: p.minContractMonths,
      installDays: p.installDays,
      selected: isSelected,
      ...(o.replaces ? { replaces: o.replaces } : {}),
      canToggle: blockedBy.length === 0,
      blockedBy,
    };
  });

  return {
    templateId: bundle.templateId,
    name: bundle.name,
    segment: bundle.segment,
    variant: bundle.variant,
    variants: req.segment === "micro" ? ["standard", "lite"] : ["standard"],
    profile: req.profile,
    items,
    unavailable: bundle.removed.map((r) => ({
      productId: r.productId,
      name: catalogue.get(r.productId).name,
      violations: r.violations,
    })),
    totals: {
      monthlyInr: price.monthlyInr,
      monthlyMaxInr: price.monthlyMaxInr,
      setupInr: price.setupInr,
      contractMonths: price.contractMonths,
      installDays: price.installDays,
    },
  };
}
