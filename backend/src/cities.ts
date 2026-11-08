import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsv } from "./catalogue/csv.js";
import type { CityTier } from "./catalogue/types.js";
import { REPO_ROOT } from "./config.js";

export interface City {
  name: string;
  state: string;
  tier: CityTier;
}

export const DEFAULT_LEADS_PATH = resolve(REPO_ROOT, "data", "raw", "smb_leads.csv");

/**
 * Cities served today, with their tier, taken from smb_leads.csv (read-only).
 * A city that appears with two different tiers is a data error and stops startup.
 */
export function parseCities(csvText: string): City[] {
  const byCity = new Map<string, City>();
  for (const row of parseCsv(csvText)) {
    const name = (row.city ?? "").trim();
    const state = (row.state ?? "").trim();
    const tier = Number(row.city_tier);
    if (!name) continue;
    if (tier !== 1 && tier !== 2) throw new Error(`smb_leads.csv: city ${name} has unknown tier "${row.city_tier}"`);
    const existing = byCity.get(name);
    if (existing && existing.tier !== tier) throw new Error(`smb_leads.csv: city ${name} appears with tiers ${existing.tier} and ${tier}`);
    if (!existing) byCity.set(name, { name, state, tier: tier as CityTier });
  }
  return [...byCity.values()].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}

export function loadCities(path: string = DEFAULT_LEADS_PATH): City[] {
  return parseCities(readFileSync(path, "utf8"));
}
