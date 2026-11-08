import type { Catalogue } from "./catalogue.js";
import type { BundleLine, ProductId } from "./types.js";

/**
 * Pricing model, confirmed against all 368 activated bundles in smb_leads.csv:
 * - list price = catalogue price_min (the bundle value always lies in [Σ min × qty, Σ max × qty])
 * - one-time setup is per unit: Σ one_time_setup_inr × qty
 * - contract = the longest min_contract_months in the bundle
 * - install ETA = the longest typical_install_days in the bundle
 */
export interface PricedLine {
  productId: ProductId;
  name: string;
  category: string;
  unit: string;
  qty: number;
  unitPriceInr: number;
  unitPriceMaxInr: number;
  monthlyInr: number;
  setupInr: number;
  minContractMonths: number;
  installDays: number;
}

export interface BundlePrice {
  lines: PricedLine[];
  /** The one monthly price shown to the owner (catalogue minimum prices). */
  monthlyInr: number;
  /** Top of the catalogue price range for the same bundle. */
  monthlyMaxInr: number;
  setupInr: number;
  contractMonths: number;
  installDays: number;
}

export function assertValidLines(catalogue: Catalogue, lines: readonly BundleLine[]): void {
  if (lines.length === 0) throw new Error("A bundle needs at least one product");
  const seen = new Set<ProductId>();
  for (const line of lines) {
    if (!catalogue.has(line.productId)) throw new Error(`Unknown product "${line.productId}"`);
    if (seen.has(line.productId)) throw new Error(`Product ${line.productId} appears twice; combine the quantities`);
    seen.add(line.productId);
    if (!Number.isInteger(line.qty) || line.qty < 1) {
      throw new Error(`Quantity for ${line.productId} must be a whole number of at least 1`);
    }
  }
}

export function priceBundle(catalogue: Catalogue, lines: readonly BundleLine[]): BundlePrice {
  assertValidLines(catalogue, lines);
  const priced: PricedLine[] = lines.map(({ productId, qty }) => {
    const p = catalogue.get(productId);
    return {
      productId,
      name: p.name,
      category: p.category,
      unit: p.unit,
      qty,
      unitPriceInr: p.priceMinInr,
      unitPriceMaxInr: p.priceMaxInr,
      monthlyInr: p.priceMinInr * qty,
      setupInr: p.setupInr * qty,
      minContractMonths: p.minContractMonths,
      installDays: p.installDays,
    };
  });
  return {
    lines: priced,
    monthlyInr: sum(priced.map((l) => l.monthlyInr)),
    monthlyMaxInr: sum(priced.map((l) => l.unitPriceMaxInr * l.qty)),
    setupInr: sum(priced.map((l) => l.setupInr)),
    contractMonths: Math.max(...priced.map((l) => l.minContractMonths)),
    installDays: Math.max(...priced.map((l) => l.installDays)),
  };
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
