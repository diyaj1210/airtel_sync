import type { Catalogue } from "./catalogue.js";
import type { BundleLine, BusinessProfile, Product, ProductId } from "./types.js";

/**
 * Catalogue eligibility rules (data/raw/README.md). This module is the only place that decides
 * whether a product may be sold; the advisor's LLM only explains what this returns.
 */
export type RuleCode = "CITY_TIER" | "MIN_EMPLOYEES" | "MIN_SITES" | "GSTIN_REQUIRED" | "REQUIRES_ONE_OF";

export interface RuleViolation {
  code: RuleCode;
  /** Plain-English reason (the frontend translates from `code` + `params`). */
  message: string;
  params: Record<string, string | number | readonly string[]>;
}

/**
 * Check one product for one business.
 * @param bundleIds products in the same bundle (used for `requires_one_of`; the product itself
 *   never satisfies its own dependency).
 */
export function checkProduct(
  product: Product,
  profile: BusinessProfile,
  bundleIds: Iterable<ProductId>,
): RuleViolation[] {
  const v: RuleViolation[] = [];

  if (!product.cityTiers.includes(profile.cityTier)) {
    v.push({
      code: "CITY_TIER",
      message: `${product.name} is only sold in tier ${product.cityTiers.join(" and ")} cities.`,
      params: { allowedTiers: product.cityTiers.map(String), cityTier: profile.cityTier },
    });
  }
  if (profile.employees < product.minEmployees) {
    v.push({
      code: "MIN_EMPLOYEES",
      message: `${product.name} needs at least ${product.minEmployees} employees.`,
      params: { minEmployees: product.minEmployees, employees: profile.employees },
    });
  }
  if (profile.sites < product.minSites) {
    v.push({
      code: "MIN_SITES",
      message: `${product.name} needs at least ${product.minSites} sites.`,
      params: { minSites: product.minSites, sites: profile.sites },
    });
  }
  if (product.requiresGstin && profile.gstin !== "active") {
    v.push({
      code: "GSTIN_REQUIRED",
      message:
        profile.gstin === "inactive"
          ? `${product.name} needs an active GSTIN; this GSTIN is cancelled or suspended.`
          : `${product.name} needs a valid, active GSTIN.`,
      params: { gstin: profile.gstin },
    });
  }
  if (product.requiresOneOf.length > 0) {
    const present = new Set(bundleIds);
    present.delete(product.id);
    if (!product.requiresOneOf.some((id) => present.has(id))) {
      v.push({
        code: "REQUIRES_ONE_OF",
        message: `${product.name} needs one of these in the same bundle: ${product.requiresOneOf.join(", ")}.`,
        params: { requiresOneOf: product.requiresOneOf },
      });
    }
  }
  return v;
}

export interface LineCheck extends BundleLine {
  eligible: boolean;
  violations: RuleViolation[];
}

export interface BundleCheck {
  valid: boolean;
  lines: LineCheck[];
}

/** Check every line of a bundle against the rules, using the bundle itself for dependencies. */
export function checkBundle(catalogue: Catalogue, lines: readonly BundleLine[], profile: BusinessProfile): BundleCheck {
  const ids = lines.map((l) => l.productId);
  const checked = lines.map((line) => {
    const violations = checkProduct(catalogue.get(line.productId), profile, ids);
    return { ...line, eligible: violations.length === 0, violations };
  });
  return { valid: checked.every((l) => l.eligible), lines: checked };
}
