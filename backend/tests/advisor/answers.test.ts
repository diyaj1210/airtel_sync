import { describe, expect, it } from "vitest";
import { applyUpdates, cleanLabel, isComplete, nextSlot, profileFor, segmentFor, type Answers } from "../../src/advisor/answers.js";
import { cities } from "./helpers.js";

describe("applyUpdates (every value is validated before the rules engine sees it)", () => {
  it("accepts valid values and reports what changed", () => {
    const r = applyUpdates({}, { businessKind: "office", employees: 5, city: "Kochi", gstin: "none" }, cities);
    expect(r.answers).toEqual({ businessKind: "office", employees: 5, city: { name: "Kochi", tier: 2, listed: true }, gstin: "none" });
    expect(r.changed).toEqual(["businessKind", "employees", "city", "gstin"]);
    expect(r.rejected).toEqual([]);
  });

  it.each([
    [{ employees: 0 }, "employees"],
    [{ employees: -5 }, "employees"],
    [{ employees: 2.5 }, "employees"],
    [{ employees: "5" }, "employees"],
    [{ employees: 100_001 }, "employees"],
    [{ sites: 1001 }, "sites"],
    [{ businessKind: "bank" }, "businessKind"],
    [{ gstin: "maybe" }, "gstin"],
    [{ internet: "satellite" }, "internet"],
    [{ tools: ["pos", "fax"] }, "tools"],
    [{ tools: "pos" }, "tools"],
    [{ city: "Atlantis" }, "city"],
    [{ city: 42 }, "city"],
  ])("rejects %j", (updates, slot) => {
    const before: Answers = { employees: 3 };
    const r = applyUpdates(before, updates, cities);
    expect(r.rejected).toEqual([slot]);
    expect(r.changed).toEqual([]);
    expect(r.answers).toEqual(before);
  });

  it("ignores null and undefined (the LLM uses null for 'not said')", () => {
    expect(applyUpdates({ employees: 3 }, { employees: null, city: undefined }, cities)).toEqual({
      answers: { employees: 3 },
      changed: [],
      rejected: [],
    });
  });

  it("a city outside our list is kept as tier 2 (the stricter rule set)", () => {
    expect(applyUpdates({}, { city: "OTHER:Shimla" }, cities).answers.city).toEqual({ name: "Shimla", tier: 2, listed: false });
    expect(applyUpdates({}, { city: "__other__" }, cities).answers.city).toEqual({ name: "", tier: 2, listed: false });
    // "OTHER:" with one of our cities is still that city
    expect(applyUpdates({}, { city: "OTHER:Bombay" }, cities).answers.city).toEqual({ name: "Mumbai", tier: 1, listed: true });
  });

  it("keeps tools in a fixed order and drops a stale business label when the kind changes", () => {
    expect(applyUpdates({}, { tools: ["messaging", "pos"] }, cities).answers.tools).toEqual(["pos", "messaging"]);
    const r = applyUpdates({ businessKind: "office", businessType: "Dental clinic" }, { businessKind: "factory" }, cities);
    expect(r.answers).toEqual({ businessKind: "factory" });
  });

  it("masks identifiers in a business label and refuses markup", () => {
    expect(cleanLabel("Shop 27XUIXG0767D1ZP")).toBe("Shop 27XU********1ZP");
    expect(cleanLabel("<script>")).toBeUndefined();
    expect(cleanLabel("x".repeat(41))).toBeUndefined();
  });
});

describe("question order and segment", () => {
  it("asks type, size, locations, city, GSTIN, internet, tools in that order", () => {
    const order: string[] = [];
    let a: Answers = {};
    const values = { businessKind: "shop", employees: 2, sites: 1, city: "Pune", gstin: "none", internet: "none", tools: [] };
    for (let slot = nextSlot(a); slot; slot = nextSlot(a)) {
      order.push(slot);
      a = applyUpdates(a, { [slot]: values[slot] }, cities).answers;
    }
    expect(order).toEqual(["businessKind", "employees", "sites", "city", "gstin", "internet", "tools"]);
    expect(isComplete(a)).toBe(true);
    expect(profileFor(a)).toEqual({ cityTier: 1, employees: 2, sites: 1, gstin: "none" });
  });

  it("maps the kind of business and its locations to a catalogue segment", () => {
    expect(segmentFor("factory", 3)).toBe("mfg");
    expect(segmentFor("office", 2)).toBe("prof");
    expect(segmentFor("shop", 1)).toBe("micro");
    expect(segmentFor("shop", 2)).toBe("multi");
    expect(segmentFor("chain", 5)).toBe("multi");
    expect(segmentFor("chain", 1)).toBe("micro");
  });

  it("refuses to build a profile from incomplete answers", () => {
    expect(() => profileFor({ employees: 2 })).toThrow("not complete");
  });
});
