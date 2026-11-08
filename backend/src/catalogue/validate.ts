import type { BundleVariant } from "./bundles.js";
import { GSTIN_STATUSES, SEGMENTS, type BusinessProfile, type GstinStatus, type Segment } from "./types.js";

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const MAX_EMPLOYEES = 100_000;
const MAX_SITES = 1_000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function intInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

export function parseProfile(input: unknown, path = "profile"): Parsed<BusinessProfile> {
  if (!isObject(input)) return { ok: false, errors: [`${path} must be an object`] };
  const errors: string[] = [];
  const { cityTier, employees, sites, gstin } = input;
  if (cityTier !== 1 && cityTier !== 2) errors.push(`${path}.cityTier must be 1 or 2`);
  if (!intInRange(employees, 1, MAX_EMPLOYEES)) errors.push(`${path}.employees must be a whole number from 1 to ${MAX_EMPLOYEES}`);
  if (!intInRange(sites, 1, MAX_SITES)) errors.push(`${path}.sites must be a whole number from 1 to ${MAX_SITES}`);
  if (!(GSTIN_STATUSES as readonly unknown[]).includes(gstin)) {
    errors.push(`${path}.gstin must be one of ${GSTIN_STATUSES.join(", ")}`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { cityTier: cityTier as 1 | 2, employees: employees as number, sites: sites as number, gstin: gstin as GstinStatus },
  };
}

export function parseBuildRequest(
  body: unknown,
): Parsed<{ segment: Segment; variant: BundleVariant; profile: BusinessProfile }> {
  if (!isObject(body)) return { ok: false, errors: ["body must be a JSON object"] };
  const errors: string[] = [];
  const segment = body.segment;
  if (!(SEGMENTS as readonly unknown[]).includes(segment)) errors.push(`segment must be one of ${SEGMENTS.join(", ")}`);
  const variant = body.variant ?? "standard";
  if (variant !== "standard" && variant !== "lite") errors.push("variant must be standard or lite");
  else if (variant === "lite" && segment !== "micro") errors.push("variant lite exists only for segment micro");
  const profile = parseProfile(body.profile);
  if (!profile.ok) errors.push(...profile.errors);
  if (errors.length > 0 || !profile.ok) return { ok: false, errors };
  return { ok: true, value: { segment: segment as Segment, variant: variant as BundleVariant, profile: profile.value } };
}

export function parseEligibilityRequest(
  body: unknown,
  isKnownProduct: (id: string) => boolean,
): Parsed<{ profile: BusinessProfile; productIds: string[] }> {
  if (!isObject(body)) return { ok: false, errors: ["body must be a JSON object"] };
  const errors: string[] = [];
  const { productIds } = body;
  if (!Array.isArray(productIds) || productIds.length === 0 || productIds.length > 100) {
    errors.push("productIds must be a non-empty array (at most 100)");
  } else {
    const seen = new Set<string>();
    for (const id of productIds) {
      if (typeof id !== "string" || !isKnownProduct(id)) errors.push(`unknown product id ${JSON.stringify(id)}`);
      else if (seen.has(id)) errors.push(`product id ${id} is listed twice`);
      else seen.add(id);
    }
  }
  const profile = parseProfile(body.profile);
  if (!profile.ok) errors.push(...profile.errors);
  if (errors.length > 0 || !profile.ok) return { ok: false, errors };
  return { ok: true, value: { profile: profile.value, productIds: productIds as string[] } };
}
