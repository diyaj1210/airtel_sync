export type ProductId = string;
export type CityTier = 1 | 2;
/** Catalogue segment codes used in `target_segments`. */
export type Segment = "micro" | "prof" | "multi" | "mfg";
export const SEGMENTS: readonly Segment[] = ["micro", "prof", "multi", "mfg"];

/**
 * GSTIN state of the business. `requires_gstin = Y` products need "active":
 * a valid GSTIN whose registry status is Active (data/raw/README.md).
 * - active:   has a GSTIN with status Active (self-declared until KYC verifies it in step 4)
 * - inactive: has a GSTIN but it is Cancelled or Suspended
 * - none:     no GSTIN
 */
export type GstinStatus = "active" | "inactive" | "none";
export const GSTIN_STATUSES: readonly GstinStatus[] = ["active", "inactive", "none"];

export interface Product {
  id: ProductId;
  category: string;
  name: string;
  description: string;
  unit: string;
  priceMinInr: number;
  priceMaxInr: number;
  setupInr: number;
  minContractMonths: number;
  cityTiers: CityTier[];
  minEmployees: number;
  minSites: number;
  requiresGstin: boolean;
  /** Needs at least one of these in the same bundle (empty = no dependency). */
  requiresOneOf: ProductId[];
  installDays: number;
  targetSegments: Segment[];
}

/** The facts about a business that the catalogue rules depend on. */
export interface BusinessProfile {
  cityTier: CityTier;
  employees: number;
  sites: number;
  gstin: GstinStatus;
}

export interface BundleLine {
  productId: ProductId;
  qty: number;
}
