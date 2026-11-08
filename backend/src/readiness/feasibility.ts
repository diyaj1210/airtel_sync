import type { City } from "../cities.js";
import type { Quote } from "../quote/quote.js";

/**
 * MOCK service feasibility (the data has no coverage information). Rule, labelled MOCK everywhere:
 * wired service (fibre / leased line) is available in every city of the data except the cities in
 * NO_FIBRE_CITIES, where only 5G AirFiber can be installed. The installation address is the
 * address proof's, else the GST registry's principal place of business, else the Udyam city.
 * A real rollout replaces this with the network coverage API.
 */
export const NO_FIBRE_CITIES: readonly string[] = ["Bhopal", "Patna"];
/** Products that need a wired (fibre) connection at the site. */
export const WIRED_PRODUCTS: readonly string[] = ["P01", "P02", "P03", "P05", "P06"];
export const LEASED_LINES: readonly string[] = ["P05", "P06"];

export interface Feasibility {
  mock: true;
  /** Known once there is an installation address. */
  known: boolean;
  city: string | null;
  fibre: boolean | null;
  source: "address_proof" | "gst_registry" | "udyam_registry" | null;
}

export function cityIn(address: string | null | undefined, cities: readonly City[]): string | null {
  if (!address) return null;
  const a = address.toLowerCase();
  return cities.find((c) => new RegExp(`\\b${c.name.toLowerCase()}\\b`).test(a))?.name ?? null;
}

export function checkFeasibility(
  addresses: { addressProof: string | null; gst: string | null; udyamCity: string | null },
  cities: readonly City[],
): Feasibility {
  const options: [Feasibility["source"], string | null][] = [
    ["address_proof", cityIn(addresses.addressProof, cities)],
    ["gst_registry", cityIn(addresses.gst, cities)],
    ["udyam_registry", addresses.udyamCity && cities.some((c) => c.name === addresses.udyamCity) ? addresses.udyamCity : null],
  ];
  const found = options.find(([, city]) => city !== null);
  if (!found) return { mock: true, known: false, city: null, fibre: null, source: null };
  const [source, city] = found;
  return { mock: true, known: true, city, fibre: !NO_FIBRE_CITIES.includes(city!), source };
}

export const selectedIds = (quote: Quote) => quote.items.filter((i) => i.selected).map((i) => i.productId);
export const needsWired = (quote: Quote) => selectedIds(quote).some((id) => WIRED_PRODUCTS.includes(id));
