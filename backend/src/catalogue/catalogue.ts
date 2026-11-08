import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "../config.js";
import { parseCsv } from "./csv.js";
import { SEGMENTS, type CityTier, type Product, type ProductId, type Segment } from "./types.js";

export const DEFAULT_CATALOGUE_PATH = resolve(REPO_ROOT, "data", "raw", "product_catalogue.csv");

export const CATALOGUE_COLUMNS = [
  "product_id",
  "category",
  "product_name",
  "description",
  "unit",
  "price_min_inr_per_month",
  "price_max_inr_per_month",
  "one_time_setup_inr",
  "min_contract_months",
  "available_city_tiers",
  "min_employees",
  "min_sites",
  "requires_gstin",
  "requires_one_of",
  "typical_install_days",
  "target_segments",
] as const;

export class Catalogue {
  private readonly byId: ReadonlyMap<ProductId, Product>;

  constructor(readonly products: readonly Product[]) {
    this.byId = new Map(products.map((p) => [p.id, p]));
  }

  has(id: ProductId): boolean {
    return this.byId.has(id);
  }

  get(id: ProductId): Product {
    const product = this.byId.get(id);
    if (!product) throw new Error(`Unknown product "${id}"`);
    return product;
  }
}

function fail(row: number, column: string, message: string): never {
  throw new Error(`product_catalogue.csv row ${row}, ${column}: ${message}`);
}

function int(row: number, column: string, raw: string, min: number): number {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(value) || value < min) {
    fail(row, column, `expected an integer >= ${min}, got "${raw}"`);
  }
  return value;
}

/** Parse and validate the catalogue CSV. Throws a clear error on any malformed value. */
export function parseCatalogue(csvText: string): Catalogue {
  const records = parseCsv(csvText);
  const first = records[0];
  if (!first) throw new Error("product_catalogue.csv has no products");
  for (const column of CATALOGUE_COLUMNS) {
    if (!(column in first)) throw new Error(`product_catalogue.csv is missing column "${column}"`);
  }

  const products: Product[] = records.map((r, i) => {
    const row = i + 2; // header is row 1
    const col = (name: (typeof CATALOGUE_COLUMNS)[number]) => (r[name] ?? "").trim();

    const id = col("product_id");
    if (!/^P\d{2}$/.test(id)) fail(row, "product_id", `expected P + 2 digits, got "${id}"`);

    const priceMinInr = int(row, "price_min_inr_per_month", col("price_min_inr_per_month"), 0);
    const priceMaxInr = int(row, "price_max_inr_per_month", col("price_max_inr_per_month"), 0);
    if (priceMaxInr < priceMinInr) fail(row, "price_max_inr_per_month", "is below price_min_inr_per_month");

    const cityTiers = col("available_city_tiers")
      .split(";")
      .map((t) => {
        if (t !== "1" && t !== "2") fail(row, "available_city_tiers", `unknown tier "${t}"`);
        return Number(t) as CityTier;
      });

    const gstinFlag = col("requires_gstin");
    if (gstinFlag !== "Y" && gstinFlag !== "N") fail(row, "requires_gstin", `expected Y or N, got "${gstinFlag}"`);

    const targetSegments = col("target_segments")
      .split(";")
      .map((s) => {
        if (!(SEGMENTS as readonly string[]).includes(s)) fail(row, "target_segments", `unknown segment "${s}"`);
        return s as Segment;
      });

    const name = col("product_name");
    if (!name) fail(row, "product_name", "is empty");

    return {
      id,
      category: col("category"),
      name,
      description: col("description"),
      unit: col("unit"),
      priceMinInr,
      priceMaxInr,
      setupInr: int(row, "one_time_setup_inr", col("one_time_setup_inr"), 0),
      minContractMonths: int(row, "min_contract_months", col("min_contract_months"), 1),
      cityTiers,
      minEmployees: int(row, "min_employees", col("min_employees"), 1),
      minSites: int(row, "min_sites", col("min_sites"), 1),
      requiresGstin: gstinFlag === "Y",
      requiresOneOf: col("requires_one_of") === "" ? [] : col("requires_one_of").split("|"),
      installDays: int(row, "typical_install_days", col("typical_install_days"), 0),
      targetSegments,
    };
  });

  const ids = new Set<ProductId>();
  for (const p of products) {
    if (ids.has(p.id)) throw new Error(`product_catalogue.csv has duplicate product_id "${p.id}"`);
    ids.add(p.id);
  }
  for (const p of products) {
    for (const dep of p.requiresOneOf) {
      if (!ids.has(dep)) throw new Error(`product_catalogue.csv: ${p.id} requires unknown product "${dep}"`);
      if (dep === p.id) throw new Error(`product_catalogue.csv: ${p.id} requires itself`);
    }
  }
  return new Catalogue(products);
}

/** Read the catalogue from data/raw (read-only). */
export function loadCatalogue(path: string = DEFAULT_CATALOGUE_PATH): Catalogue {
  return parseCatalogue(readFileSync(path, "utf8"));
}
