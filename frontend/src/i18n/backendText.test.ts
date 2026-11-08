import { describe, expect, it } from "vitest";
import { HI_DESCRIPTIONS, reasonText, TEXT } from "../../../backend/src/advisor/text";
import type { Block } from "../api/quote";
import { catalogue } from "../test/liveBackend";
import { en, type MessageKey } from "./en";
import { hi } from "./hi";
import { interpolate, type Translate } from "./I18nProvider";
import { productDescription } from "./products";
import { describeBlock } from "./reasons";

/** The advisor writes its own sentences on the server; they must match the quote screen's wording. */

const tFor =
  (dict: Record<MessageKey, string>): Translate =>
  (key, vars) =>
    interpolate(dict[key], vars);
const nameOf = (id: string) => catalogue.get(id).name;

describe("advisor text (server) matches the app text", () => {
  it("uses the same Hindi product descriptions", () => {
    for (const p of catalogue.products) expect(HI_DESCRIPTIONS[p.id], p.id).toBe(productDescription(p.id, p.description, "hi"));
  });

  it("explains every rule with the same sentence, in both languages", () => {
    const blocks: Block[] = [
      { code: "CITY_TIER", message: "", params: { allowedTiers: ["1"] } },
      { code: "MIN_EMPLOYEES", message: "", params: { minEmployees: 10 } },
      { code: "MIN_SITES", message: "", params: { minSites: 3 } },
      { code: "GSTIN_REQUIRED", message: "", params: { gstin: "none" } },
      { code: "GSTIN_REQUIRED", message: "", params: { gstin: "inactive" } },
      { code: "REQUIRES_ONE_OF", message: "", params: { requiresOneOf: ["P01", "P02"] } },
    ];
    for (const b of blocks) {
      const v = b as Parameters<typeof reasonText>[2];
      expect(reasonText(catalogue, "en", v)).toBe(describeBlock(b, tFor(en), nameOf));
      expect(reasonText(catalogue, "hi", v)).toBe(describeBlock(b, tFor(hi), nameOf));
    }
  });

  it("has every server sentence in both languages, Hindi in Devanagari", () => {
    expect(Object.keys(TEXT.hi).sort()).toEqual(Object.keys(TEXT.en).sort());
    const latinOnly = new Set(["perUnit", "listJoin", "tool.cctv", "fullStop"]);
    for (const [key, value] of Object.entries(TEXT.hi)) {
      if (!latinOnly.has(key) && !/^\s*\W*\s*$/.test(value)) expect(/[ऀ-ॿ]/.test(value), `${key}: ${value}`).toBe(true);
    }
  });
});
