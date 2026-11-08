import { describe, expect, it } from "vitest";
import { addressesMatch, levenshtein, namesMatch, proprietorOf, similarity, simplifyAddress, simplifyName } from "../../src/kyc/match.js";

describe("name and address matching", () => {
  it("simplifies names: case, punctuation, '&', common abbreviations", () => {
    expect(simplifyName("Vindhya Tours & Travels")).toBe("vindhya tours and travels");
    expect(simplifyName("Trinity Bake House Pvt. Ltd.")).toBe("trinity bake house private limited");
    expect(simplifyName("Neha Kaur (Prop. Vindhya)")).toBe("neha kaur prop vindhya");
  });

  it("measures edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(similarity("", "")).toBe(1);
    expect(similarity("abcd", "abce")).toBe(0.75);
  });

  it("tolerates a small OCR slip but not a different word", () => {
    expect(namesMatch("Harmony Dental Care", "Harmony Dental Care")).toBe(true);
    expect(namesMatch("Harmony Dental Carc", "Harmony Dental Care")).toBe(true);
    expect(namesMatch("Trinity Bake House Pvt Ltd", "Trinity Bake House Private Limited")).toBe(true);
    expect(namesMatch("Vindhya Tours and Travels", "Vindhya Tours & Travels")).toBe(true);
    // K07: the certificate's legal name names another business.
    expect(namesMatch("Neha Banerjee (Prop. Shri Physio Clinic)", "Neha Banerjee (Prop. Neelgiri Physio Clinic)")).toBe(false);
    expect(namesMatch("Nisha Arora", "Fatima Menon")).toBe(false);
    expect(namesMatch("", "x")).toBe(false);
    expect(namesMatch(null, "x")).toBe(false);
  });

  it("compares addresses on letters and digits, so a mid-word wrap does not matter", () => {
    expect(simplifyAddress("Kolkata, West Be ngal - 347550")).toBe("kolkatawestbengal347550");
    expect(addressesMatch("Shop/Unit 71, Market Yard, Jaipur, Rajasthan-194057", "Shop/Unit 71, Market Yard, Jaipur, Rajasthan - 194057")).toBe(true);
    expect(addressesMatch("Shop/Unit 71, Market Yard, Jaipur", "Shop/Unit 12, Civil Lines, Nagpur")).toBe(false);
    expect(addressesMatch(null, "x")).toBe(false);
  });

  it("finds the proprietor in a proprietorship legal name", () => {
    expect(proprietorOf("Neha Kaur (Prop. Vindhya Tours & Travels)")).toBe("Neha Kaur");
    expect(proprietorOf("Joseph Shah (Proprietor Harmony Dental Care)")).toBe("Joseph Shah");
    expect(proprietorOf("Kaveri Stays LLP")).toBeNull();
    expect(proprietorOf(null)).toBeNull();
  });
});
