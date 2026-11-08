import { describe, expect, it } from "vitest";
import { en } from "./en";
import { hi } from "./hi";

const DEVANAGARI = /[ऀ-ॿ]/;

describe("translations", () => {
  it("Hindi has exactly the same keys as English", () => {
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
  });

  it("no string is empty", () => {
    for (const dict of [en, hi]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim(), key).not.toBe("");
      }
    }
  });

  it("every Hindi string is actually written in Devanagari", () => {
    for (const [key, value] of Object.entries(hi)) {
      expect(DEVANAGARI.test(value), `${key}: ${value}`).toBe(true);
    }
  });
});
