import { describe, expect, it } from "vitest";
import type { Answers, Slot } from "../../src/advisor/answers.js";
import { hasWord, matchCity, normalise } from "../../src/advisor/lexicon.js";
import { parseMessage, productsMentioned } from "../../src/advisor/parser.js";
import { catalogue, cities } from "./helpers.js";

const parse = (text: string, expecting: Slot | null = null, answers: Answers = {}) =>
  parseMessage(text, { expecting, answers, cities, catalogue });

describe("word matching", () => {
  it("matches Latin keywords as whole words, with * for any ending", () => {
    expect(hasWord(normalise("We have 3 branches"), "branch*")).toBe(true);
    expect(hasWord(normalise("I'll call"), "ill")).toBe(false);
    expect(hasWord(normalise("lab"), "lab")).toBe(true);
    expect(hasWord(normalise("label"), "lab")).toBe(false);
  });

  it("matches Hindi keywords at the start of a word with any ending, or as a whole word with $", () => {
    expect(hasWord(normalise("दुकानें"), "दुकान")).toBe(true);
    expect(hasWord(normalise("चेन्नई"), "चेन$")).toBe(false);
    expect(hasWord(normalise("रेस्टोरेंट चेन"), "चेन$")).toBe(true);
    expect(hasWord(normalise("हैदराबाद"), "है$")).toBe(false);
    expect(hasWord(normalise("मेरा फ़ाइबर"), "फाइबर")).toBe(true); // nukta folded
    expect(hasWord(normalise("हाँ"), "हां")).toBe(true); // chandrabindu folded
  });

  it("finds cities by English name, old name or Hindi name", () => {
    expect(matchCity("we are in Bombay", cities)?.name).toBe("Mumbai");
    expect(matchCity("बेंगलुरु में", cities)?.name).toBe("Bengaluru");
    expect(matchCity("Vizag", cities)?.name).toBe("Visakhapatnam");
    expect(matchCity("कोच्चि", cities)?.name).toBe("Kochi");
    expect(matchCity("Atlantis", cities)).toBeUndefined();
  });
});

describe("parseMessage: business facts", () => {
  it("reads type, size and city from one English sentence", () => {
    expect(parse("I run a dental clinic in Kochi with 5 people", "businessKind").updates).toEqual({
      businessKind: "office",
      businessType: "Dental clinic",
      employees: 5,
      city: "Kochi",
    });
  });

  it("reads Hindi with Devanagari digits and number words", () => {
    expect(parse("जयपुर में मेरी किराना दुकान है, ५ लोग काम करते हैं").updates).toMatchObject({
      businessKind: "shop",
      businessType: "Kirana store",
      employees: 5,
      city: "Jaipur",
    });
    expect(parse("तीन शाखाएं हैं", "sites", { businessKind: "chain" }).updates.sites).toBe(3);
  });

  it("reads Hinglish", () => {
    expect(parse("meri Lucknow mein 2 dukaan hai, 8 log kaam karte hai").updates).toMatchObject({
      businessKind: "shop",
      sites: 2,
      employees: 8,
      city: "Lucknow",
    });
  });

  it("treats a chain word as a chain and keeps the shop type in the label", () => {
    expect(parse("pharmacy chain").updates).toMatchObject({ businessKind: "chain", businessType: "Pharmacy chain" });
    expect(parse("रेस्टोरेंट चेन").updates.businessKind).toBe("chain");
    expect(parse("diagnostic lab in चेन्नई").updates).toMatchObject({ businessKind: "office", city: "Chennai" });
  });

  it("does not overwrite a known business type with a later 'shops' or 'offices' count", () => {
    expect(parse("2 offices", "sites", { businessKind: "office" }).updates).toEqual({ sites: 2 });
  });

  it("takes a bare number only for the question asked", () => {
    expect(parse("12", "employees").updates).toEqual({ employees: 12 });
    expect(parse("3", "sites").updates).toEqual({ sites: 3 });
    expect(parse("12", "gstin").updates).toEqual({});
  });

  it("counts a range as its lower end, and 'just me' as 1", () => {
    expect(parse("5-6 people").updates.employees).toBe(5);
    expect(parse("5 से 6 लोग").updates.employees).toBe(5);
    expect(parse("sweet shop, just me").updates.employees).toBe(1);
    expect(parse("me and my brother run it").updates.employees).toBe(2);
    expect(parse("मैं और मेरा भाई चलाते हैं").updates.employees).toBe(2);
  });

  it("tells people from locations: '3 shops with 12 staff'", () => {
    expect(parse("3 shops with 12 staff").updates).toMatchObject({ sites: 3, employees: 12 });
    expect(parse("staff of 7").updates.employees).toBe(7);
  });

  it("marks a city that is not in our list", () => {
    expect(parse("Shimla", "city").updates.city).toBe("OTHER:Shimla");
    expect(parse("not in the list", "city").updates.city).toBe("__other__");
    expect(parse("what is this?", "city").updates.city).toBeUndefined();
  });
});

describe("parseMessage: GSTIN", () => {
  it.each([
    ["yes", "active"],
    ["haan", "active"],
    ["हाँ है", "active"],
    ["no", "none"],
    ["नहीं है", "none"],
    ["we don't have GST", "none"],
    ["it was cancelled", "inactive"],
    ["हाँ, पर रद्द हो गया है", "inactive"],
    ["suspended", "inactive"],
  ])("%s -> %s", (text, gstin) => {
    expect(parse(text, "gstin").updates.gstin).toBe(gstin);
  });

  it("a GSTIN-shaped number means 'has a GSTIN', whatever was asked", () => {
    expect(parse("my gstin is 27XUIXG0767D1ZP", "employees").updates.gstin).toBe("active");
  });

  it("a question about GST is not an answer", () => {
    expect(parse("why do I need GST without a shop?", "employees").updates.gstin).toBeUndefined();
  });
});

describe("parseMessage: current internet and tools", () => {
  it.each([
    ["mobile hotspot", "mobile_hotspot"],
    ["jio dongle", "mobile_hotspot"],
    ["home wifi", "home_broadband"],
    ["fibre broadband", "business_broadband"],
    ["leased line", "leased_line"],
    ["none", "none"],
    ["कुछ नहीं", "none"],
    ["मोबाइल हॉटस्पॉट", "mobile_hotspot"],
  ])("internet: %s -> %s", (text, internet) => {
    expect(parse(text, "internet").updates.internet).toBe(internet);
  });

  it("reads tools per clause, so a 'no' only cancels its own clause", () => {
    expect(parse("no CCTV, but we use billing software and whatsapp", "tools").updates.tools).toEqual(["pos", "messaging"]);
    expect(parse("none of these", "tools").updates.tools).toEqual([]);
    expect(parse("कैमरा और ईमेल", "tools").updates.tools).toEqual(["email", "cctv"]);
  });

  it("does not read tools from a question about a product", () => {
    expect(parse("do you have CCTV?", null).updates.tools).toBeUndefined();
  });
});

describe("parseMessage: intents and products", () => {
  it.each([
    ["I want to talk to a real person", "human"],
    ["please call me", "human"],
    ["किसी से बात करनी है", "human"],
    ["not interested", "not_interested"],
    ["start over", "restart"],
    ["hello", "greeting"],
    ["asdfgh", "unclear"],
    ["how much is it?", "bundle_question"],
    ["कितना खर्च होगा?", "bundle_question"],
  ])("%s -> %s", (text, intent) => {
    expect(parse(text, "employees").intent).toBe(intent);
  });

  it("finds the products a question is about", () => {
    expect(parse("can I get static ip?").productIds).toEqual(["P11"]);
    expect(parse("क्या SD-WAN मिल सकता है?").productIds).toEqual(["P10"]);
    expect(parse("Do you have a leased line?").productIds).toEqual(["P05", "P06"]);
    expect(parse("What is Backup 4G/5G Failover?").productIds).toEqual(["P09"]);
  });

  it("names at most three products", () => {
    expect(productsMentioned(normalise("fibre, sd-wan, firewall and cctv"), catalogue).length).toBeLessThanOrEqual(3);
  });

  it("an answer that also asks a question keeps both", () => {
    const u = parse("we are 5 people, can I get WhatsApp?", "employees");
    expect(u.updates.employees).toBe(5);
    expect(u.intent).toBe("product_question");
    expect(u.productIds).toEqual(["P15"]);
  });
});
