import { describe, expect, it } from "vitest";
import { parseCities } from "../../src/cities.js";
import { addDays, TODAY } from "../../src/clock.js";
import { QuoteStore } from "../../src/quote/store.js";
import { buildQuote, type QuoteRequest } from "../../src/quote/quote.js";
import { catalogue } from "../testApp.js";

describe("clock", () => {
  it("today is 2026-07-15 as the data README requires", () => {
    expect(TODAY).toBe("2026-07-15");
  });

  it("adds days across month and year ends, including leap days", () => {
    expect(addDays("2026-07-15", 7)).toBe("2026-07-22");
    expect(addDays("2026-07-28", 7)).toBe("2026-08-04");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-07-15", -90)).toBe("2026-04-16");
  });

  it("rejects malformed and impossible dates", () => {
    expect(() => addDays("15-07-2026", 1)).toThrow(/YYYY-MM-DD/);
    expect(() => addDays("2026-02-30", 1)).toThrow(/Invalid date/);
  });
});

describe("parseCities", () => {
  it("collects distinct cities with their tier, tier 1 first", () => {
    const csv = "city,state,city_tier\nPune,Maharashtra,1\nKochi,Kerala,2\nPune,Maharashtra,1\nAgra,Uttar Pradesh,2\n";
    expect(parseCities(csv)).toEqual([
      { name: "Pune", state: "Maharashtra", tier: 1 },
      { name: "Agra", state: "Uttar Pradesh", tier: 2 },
      { name: "Kochi", state: "Kerala", tier: 2 },
    ]);
  });

  it("stops on a city with two tiers or an unknown tier", () => {
    expect(() => parseCities("city,state,city_tier\nPune,MH,1\nPune,MH,2\n")).toThrow(/tiers 1 and 2/);
    expect(() => parseCities("city,state,city_tier\nPune,MH,3\n")).toThrow(/unknown tier/);
  });
});

describe("QuoteStore", () => {
  const req: QuoteRequest = {
    segment: "micro",
    variant: "standard",
    profile: { cityTier: 2, employees: 3, sites: 1, gstin: "none" },
    exclude: [],
    include: [],
  };
  const q = buildQuote(catalogue, req);

  it("stores accepted quotes with an id and a 7-day validity from the injected today", () => {
    const store = new QuoteStore(() => "2026-07-15");
    const a = store.accept(req, q);
    expect(a).toMatchObject({ acceptedOn: "2026-07-15", validUntil: "2026-07-22" });
    expect(store.get(a.quoteId)).toBe(a);
    expect(store.get("Q-NOPE0000")).toBeUndefined();
  });

  it("never reuses an id", () => {
    const ids = ["Q-AAAAAAAA", "Q-AAAAAAAA", "Q-BBBBBBBB"];
    const store = new QuoteStore(() => "2026-07-15", () => ids.shift()!);
    expect(store.accept(req, q).quoteId).toBe("Q-AAAAAAAA");
    expect(store.accept(req, q).quoteId).toBe("Q-BBBBBBBB");
  });
});
