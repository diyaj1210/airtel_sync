import { describe, expect, it } from "vitest";
import type { Block } from "../api/quote";
import { OTHER_CITY, toProfile, type FormValues } from "../components/BusinessForm";
import { formatDate, formatInr } from "../format";
import { catalogue } from "../test/liveBackend";
import { en, type MessageKey } from "./en";
import { hi } from "./hi";
import { interpolate, type Translate } from "./I18nProvider";
import { productDescription, TRANSLATED_PRODUCT_IDS, TRANSLATED_UNITS, unitLabel } from "./products";
import { describeBlock } from "./reasons";

const tFor =
  (dict: Record<MessageKey, string>): Translate =>
  (key, vars) =>
    interpolate(dict[key], vars);
const names: Record<string, string> = { P01: "Biz Fibre 100", P02: "Biz Fibre 300", P09: "Backup 4G/5G Failover", P23: "Cloud CCTV", P06: "Internet Leased Line 100" };
const nameOf = (id: string) => names[id] ?? id;
const block = (code: string, params: Record<string, unknown> = {}): Block => ({ code, message: `EN ${code}`, params });

describe("describeBlock", () => {
  const cases: [Block, string, string][] = [
    [block("CITY_TIER", { allowedTiers: ["1"] }), "Available only in tier-1 (large metro) cities.", "यह केवल टियर-1 (बड़े महानगर) शहरों में उपलब्ध है।"],
    [block("MIN_EMPLOYEES", { minEmployees: 10 }), "Needs at least 10 people working at the business.", "व्यवसाय में कम से कम 10 लोग काम करते हों।"],
    [block("MIN_SITES", { minSites: 3 }), "Needs at least 3 locations.", "कम से कम 3 जगहें होनी चाहिए।"],
    [block("GSTIN_REQUIRED", { gstin: "none" }), "Needs an active GSTIN.", "इसके लिए सक्रिय GSTIN ज़रूरी है।"],
    [block("GSTIN_REQUIRED", { gstin: "inactive" }), "Needs an active GSTIN; yours is cancelled or suspended.", "सक्रिय GSTIN ज़रूरी है; आपका GSTIN रद्द या निलंबित है।"],
    [block("REQUIRES_ONE_OF", { requiresOneOf: ["P01", "P02"] }), "Works only together with Biz Fibre 100 or Biz Fibre 300.", "यह केवल Biz Fibre 100 या Biz Fibre 300 के साथ काम करता है।"],
    [block("REQUIRED_BY", { products: ["P09", "P23"] }), "Can't remove: needed by Backup 4G/5G Failover and Cloud CCTV.", "हटा नहीं सकते: Backup 4G/5G Failover और Cloud CCTV को इसकी ज़रूरत है।"],
    [block("LAST_ITEM"), "A bundle needs at least one product.", "बंडल में कम से कम एक प्रोडक्ट होना चाहिए।"],
    [block("REPLACED_BY", { product: "P06" }), "Replaced by Internet Leased Line 100.", "Internet Leased Line 100 से बदला गया।"],
  ];
  it.each(cases)("%# %j", (b, english, hindi) => {
    expect(describeBlock(b, tFor(en), nameOf)).toBe(english);
    expect(describeBlock(b, tFor(hi), nameOf)).toBe(hindi);
  });

  it("falls back to the server's English message for an unknown code", () => {
    expect(describeBlock(block("SOMETHING_NEW"), tFor(hi), nameOf)).toBe("EN SOMETHING_NEW");
  });

  it("no translated reason leaves a {placeholder} unfilled", () => {
    for (const [b] of cases) {
      expect(describeBlock(b, tFor(en), nameOf)).not.toMatch(/\{\w+\}/);
      expect(describeBlock(b, tFor(hi), nameOf)).not.toMatch(/\{\w+\}/);
    }
  });
});

describe("product text", () => {
  it("has a Hindi description for every catalogue product and a label for every unit", () => {
    expect(TRANSLATED_PRODUCT_IDS.sort()).toEqual(catalogue.products.map((p) => p.id).sort());
    for (const unit of new Set(catalogue.products.map((p) => p.unit))) expect(TRANSLATED_UNITS).toContain(unit);
  });

  it("uses the catalogue description in English and the Hindi one in Hindi", () => {
    expect(productDescription("P01", "Business fibre broadband, 100 Mbps, unlimited data", "en")).toBe(
      "Business fibre broadband, 100 Mbps, unlimited data",
    );
    expect(productDescription("P01", "x", "hi")).toBe("बिज़नेस फ़ाइबर ब्रॉडबैंड, 100 Mbps, अनलिमिटेड डेटा");
    expect(unitLabel("per site", "en")).toBe("per location");
    expect(unitLabel("per camera", "hi")).toBe("प्रति कैमरा");
  });
});

describe("formatting", () => {
  it("formats rupees with Indian grouping and no decimals", () => {
    expect(formatInr(1597)).toBe("₹1,597");
    expect(formatInr(119182)).toBe("₹1,19,182");
    expect(formatInr(0)).toBe("₹0");
  });

  it("formats dates in English and Hindi", () => {
    expect(formatDate("2026-07-22", "en")).toBe("22 July 2026");
    expect(formatDate("2026-07-22", "hi")).toBe("22 जुलाई 2026");
  });

  it("interpolate leaves unknown placeholders visible", () => {
    expect(interpolate("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });
});

describe("toProfile (form -> rules engine input)", () => {
  const cities = [
    { name: "Mumbai", state: "Maharashtra", tier: 1 as const },
    { name: "Kochi", state: "Kerala", tier: 2 as const },
  ];
  const base: FormValues = { segment: "prof", city: "Mumbai", employees: "5", sites: "1", gstin: "active" };

  it("uses the tier of the chosen city", () => {
    expect(toProfile(base, cities)).toEqual({ cityTier: 1, employees: 5, sites: 1, gstin: "active" });
    expect(toProfile({ ...base, city: "Kochi" }, cities)?.cityTier).toBe(2);
  });

  it("treats a city not in the list as tier 2 (the stricter rule set)", () => {
    expect(toProfile({ ...base, city: OTHER_CITY }, cities)?.cityTier).toBe(2);
  });

  it("rejects missing or invalid answers", () => {
    expect(toProfile({ ...base, employees: "0" }, cities)).toBeNull();
    expect(toProfile({ ...base, employees: "2.5" }, cities)).toBeNull();
    expect(toProfile({ ...base, sites: "" }, cities)).toBeNull();
    expect(toProfile({ ...base, gstin: "" }, cities)).toBeNull();
    expect(toProfile({ ...base, city: "Atlantis" }, cities)).toBeNull();
  });
});
