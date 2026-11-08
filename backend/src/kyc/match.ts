/**
 * Fuzzy comparison of names and addresses read by OCR (kyc-validation.md checks 4, 5 and 7).
 * A small OCR slip (one or two characters in a long name) still matches; a different word does not
 * ("Prop. Shri Physio Clinic" vs "Prop. Neelgiri Physio Clinic").
 */

export const NAME_MATCH = 0.9;
export const ADDRESS_MATCH = 0.9;

const WORDS: Record<string, string> = {
  pvt: "private",
  ltd: "limited",
  co: "company",
  "&": "and",
};

/** Lower case, '&' -> 'and', common abbreviations expanded, punctuation dropped, single spaces. */
export function simplifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " & ")
    .replace(/[^a-z0-9& ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => WORDS[w] ?? w)
    .join(" ");
}

/** Letters and digits only: addresses wrap mid-word on the documents ("West Be" / "ngal"). */
export function simplifyAddress(address: string): string {
  return address.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** 1 = identical, 0 = nothing in common. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = simplifyName(a);
  const y = simplifyName(b);
  return x.length > 0 && similarity(x, y) >= NAME_MATCH;
}

export function anyNameMatches(name: string | null | undefined, candidates: (string | null | undefined)[]): boolean {
  return candidates.some((c) => namesMatch(name, c));
}

export function addressesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = simplifyAddress(a);
  const y = simplifyAddress(b);
  return x.length > 0 && similarity(x, y) >= ADDRESS_MATCH;
}

/** "Neha Kaur (Prop. Vindhya Tours & Travels)" -> "Neha Kaur". Null when the legal name has no person. */
export function proprietorOf(legalName: string | null | undefined): string | null {
  const m = /^\s*(.+?)\s*\(\s*prop(?:rietor)?\.?\s+.+\)\s*$/i.exec(legalName ?? "");
  return m ? m[1]!.trim() : null;
}
