import { describe, expect, it } from "vitest";
import { SHARED_PREFIXES } from "../../../backend/src/channels/sharedKeys";
import { SHARED_TEXT } from "../../../backend/src/channels/sharedText";
import { OWN_TEXT } from "../../../backend/src/channels/text";
import { en } from "./en";
import { hi } from "./hi";

/** WhatsApp says exactly what the app says (backend/src/channels/sharedText.ts is generated from here). */
describe("WhatsApp channel wording", () => {
  it("the shared strings are the app's, word for word (regenerate with backend/scripts/sync-channel-text.ts)", () => {
    const keys = Object.keys(en).filter((k) => SHARED_PREFIXES.some((p) => k.startsWith(p)));
    expect(keys.length).toBeGreaterThan(50);
    const pick = (d: Record<string, string>) => Object.fromEntries(keys.map((k) => [k, d[k]]));
    expect(SHARED_TEXT.en).toEqual(pick(en));
    expect(SHARED_TEXT.hi).toEqual(pick(hi));
  });

  it("the bot's own messages exist in both languages, and the Hindi ones are in Devanagari", () => {
    expect(Object.keys(OWN_TEXT.hi).sort()).toEqual(Object.keys(OWN_TEXT.en).sort());
    for (const [key, value] of Object.entries(OWN_TEXT.hi)) {
      // Templates that are only placeholders and punctuation (e.g. "• {name}: {date}") have nothing to translate.
      if (!/\p{L}/u.test(value.replace(/\{\w+\}/g, ""))) continue;
      expect(/[ऀ-ॿ]/.test(value), key).toBe(true);
    }
  });
});
