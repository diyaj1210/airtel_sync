import { describe, expect, it } from "vitest";
import { applyUpdates, BUSINESS_KINDS, segmentFor, TOOLS, type Answers, type Tool } from "../../src/advisor/answers.js";
import { recommend, selectedItems } from "../../src/advisor/recommend.js";
import type { Lang } from "../../src/advisor/text.js";
import { checkBundle } from "../../src/catalogue/rules.js";
import type { BusinessProfile, CityTier, GstinStatus, ProductId, Segment } from "../../src/catalogue/types.js";
import {
  catalogue,
  cities,
  expectSafeRecommendation,
  finalProfile,
  honestLlm,
  lyingLlm,
  makeEngine,
  runChat,
  type Step,
} from "./helpers.js";

/**
 * R2.10: judges run 15 advisor scenarios live (PDF p.4). Each scenario below is a real chat, run
 * three ways: no LLM (rules only), an honest LLM and a lying LLM. In every run the advisor must
 * reach the expected business facts and recommend only products the rules engine allows.
 */

interface Scenario {
  name: string;
  lang: Lang;
  steps: Step[];
  segment: Segment;
  profile: BusinessProfile;
  templateId: string;
  /** Must be in the recommendation. */
  includes?: ProductId[];
  /** Must not be in the recommendation (the rules engine leaves them out). */
  excludes?: ProductId[];
  /** Add-ons suggested from the current-tools answer. */
  suggested?: ProductId[];
}

const p = (cityTier: CityTier, employees: number, sites: number, gstin: GstinStatus): BusinessProfile => ({ cityTier, employees, sites, gstin });

const SCENARIOS: Scenario[] = [
  {
    name: "dental clinic in Kochi, no GSTIN, uses WhatsApp (English)",
    lang: "en",
    steps: ["Hi, I run a dental clinic in Kochi with 5 people", "1", "no gst", "we use mobile hotspot", "only whatsapp, no billing"],
    segment: "prof",
    profile: p(2, 5, 1, "none"),
    templateId: "office-pro",
    includes: ["P02", "P09", "P16", "P20"],
    excludes: ["P12", "P13", "P15", "P03"],
  },
  {
    name: "kirana store in Jaipur, no GSTIN, no tools (Hindi)",
    lang: "hi",
    steps: ["मेरी जयपुर में किराना दुकान है, 3 लोग काम करते हैं", "एक", "नहीं", "मोबाइल हॉटस्पॉट", "कुछ नहीं"],
    segment: "micro",
    profile: p(2, 3, 1, "none"),
    templateId: "dukaan-digital-starter",
    includes: ["P04", "P07", "P22"],
    excludes: ["P15", "P14"],
    suggested: ["P19", "P23"],
  },
  {
    name: "bakery in Mumbai with GSTIN, already bills and uses WhatsApp",
    lang: "en",
    steps: ["We are a bakery in Mumbai", "4", "1", "yes it is active", "home broadband", "billing software and whatsapp"],
    segment: "micro",
    profile: p(1, 4, 1, "active"),
    templateId: "dukaan-digital-starter",
    suggested: ["P23", "P15"],
    excludes: ["P19"],
  },
  {
    name: "pharmacy chain with 6 branches in Pune, GSTIN, 40 staff",
    lang: "en",
    steps: ["pharmacy chain", "40 staff", "6 branches", "Pune", "GST registered and active", "broadband", "pos and cctv"],
    segment: "multi",
    profile: p(1, 40, 6, "active"),
    templateId: "chain-connect",
    includes: ["P02", "P10", "P13", "P23", "P09"],
  },
  {
    name: "restaurant chain, 2 outlets in Indore, no GSTIN: SD-WAN and toll-free left out",
    lang: "en",
    steps: ["restaurant chain with 2 outlets in Indore", "15 people", "we don't have GST", "business broadband", "none"],
    segment: "multi",
    profile: p(2, 15, 2, "none"),
    templateId: "chain-connect",
    excludes: ["P10", "P13", "P15", "P21"],
  },
  {
    name: "Hinglish: 2 shops in Lucknow become a chain",
    lang: "en",
    steps: ["meri Lucknow mein 2 dukaan hai, 8 log kaam karte hai", "haan", "mobile data", "whatsapp"],
    segment: "multi",
    profile: p(2, 8, 2, "active"),
    templateId: "chain-connect",
    excludes: ["P10"],
    includes: ["P13"],
  },
  {
    name: "auto-parts factory in Coimbatore, 45 workers, leased line, GSTIN",
    lang: "en",
    steps: ["auto parts manufacturing unit", "45 workers", "1", "Coimbatore", "yes", "leased line", "email"],
    segment: "mfg",
    profile: p(2, 45, 1, "active"),
    templateId: "factory-connect",
    includes: ["P05", "P21", "P24"],
    excludes: ["P02", "P11"],
  },
  {
    name: "small furniture workshop without GSTIN: leased line swapped for fibre + static IP",
    lang: "en",
    steps: ["furniture workshop in Nagpur", "6", "1", "no", "none", "none of these"],
    segment: "mfg",
    profile: p(2, 6, 1, "none"),
    templateId: "factory-connect",
    includes: ["P02", "P11", "P20"],
    excludes: ["P05", "P21", "P24"],
  },
  {
    name: "factory with a cancelled GSTIN in Surat",
    lang: "en",
    steps: ["textile factory in Surat with 30 workers", "1", "our GST was cancelled", "leased line", "cctv"],
    segment: "mfg",
    profile: p(2, 30, 1, "inactive"),
    templateId: "factory-connect",
    excludes: ["P05", "P21", "P24"],
  },
  {
    name: "CA firm in Delhi, 12 people, GSTIN",
    lang: "en",
    steps: ["CA firm", "12 employees", "1 office", "New Delhi", "yes we have GSTIN", "business broadband", "email"],
    segment: "prof",
    profile: p(1, 12, 1, "active"),
    templateId: "office-pro",
    includes: ["P02", "P16", "P17", "P20", "P09"],
  },
  {
    name: "coaching centre in Patna with a suspended GSTIN (Hindi)",
    lang: "hi",
    steps: ["पटना में कोचिंग सेंटर है", "3", "1", "हाँ, पर रद्द हो गया है", "घर का ब्रॉडबैंड", "ईमेल"],
    segment: "prof",
    profile: p(2, 3, 1, "inactive"),
    templateId: "office-pro",
    excludes: ["P12", "P14", "P03"],
  },
  {
    name: "salon in a city not in our list (treated as tier 2)",
    lang: "en",
    steps: ["salon", "2", "1", "Shimla", "no", "mobile hotspot", "none"],
    segment: "micro",
    profile: p(2, 2, 1, "none"),
    templateId: "dukaan-digital-starter",
    suggested: ["P19", "P23"],
  },
  {
    name: "quick replies only: just me, one shop in Mumbai",
    lang: "en",
    steps: [
      { slot: "businessKind", value: "shop" },
      { slot: "employees", value: 1 },
      { slot: "sites", value: 1 },
      { slot: "city", value: "Mumbai" },
      { slot: "gstin", value: "none" },
      { slot: "internet", value: "none" },
      { slot: "tools", value: [] },
    ],
    segment: "micro",
    profile: p(1, 1, 1, "none"),
    templateId: "dukaan-digital-starter",
    includes: ["P04", "P07", "P22"],
  },
  {
    name: "gym chain with 12 branches in Bengaluru, 120 staff",
    lang: "en",
    steps: ["gym chain in Bangalore", "120", "12", "active gstin", "broadband", "pos, email, cctv and whatsapp"],
    segment: "multi",
    profile: p(1, 120, 12, "active"),
    templateId: "chain-connect",
    includes: ["P10", "P13", "P02"],
    suggested: ["P15"],
  },
  {
    name: "hotel group with 3 hotels in Vizag, no GSTIN",
    lang: "en",
    steps: ["we run 3 hotels in Vizag", "20 staff", "no GST", "broadband", "cctv"],
    segment: "multi",
    profile: p(2, 20, 3, "none"),
    templateId: "chain-connect",
    excludes: ["P10", "P13"],
  },
  {
    name: "Devanagari digits: ५ लोग, diagnostic lab in Chennai",
    lang: "hi",
    steps: ["चेन्नई में डायग्नोस्टिक लैब", "५ लोग", "२", "हाँ GST है", "ब्रॉडबैंड", "कैमरा और ईमेल"],
    segment: "prof",
    profile: p(1, 5, 2, "active"),
    templateId: "office-pro",
    includes: ["P02", "P09"],
  },
  {
    name: "a range counts as the lower end (5-6 people)",
    lang: "en",
    steps: ["boutique in Ahmedabad", "5-6 people", "1", "no", "mobile hotspot", "whatsapp"],
    segment: "micro",
    profile: p(1, 5, 1, "none"),
    templateId: "dukaan-digital-starter",
    excludes: ["P15"],
  },
  {
    name: "one shop owner with GSTIN who chats with customers gets the WhatsApp API",
    lang: "en",
    steps: ["sweet shop in Kolkata, just me", "1", "yes", "mobile hotspot", "whatsapp and billing"],
    segment: "micro",
    profile: p(1, 1, 1, "active"),
    templateId: "dukaan-digital-starter",
    suggested: ["P23", "P15"],
  },
  {
    name: "law office in Hyderabad, size corrected after the recommendation",
    lang: "en",
    steps: ["law office in Hyderabad", "4", "1", "yes", "broadband", "email", "actually we are 12 people"],
    segment: "prof",
    profile: p(1, 12, 1, "active"),
    templateId: "office-pro",
  },
  {
    name: "a GSTIN typed as a number counts as 'has a GSTIN' (never stored)",
    lang: "en",
    steps: ["printing press in Ludhiana with 14 workers", "1", "27XUIXG0767D1ZP", "leased line", "none"],
    segment: "mfg",
    profile: p(2, 14, 1, "active"),
    templateId: "factory-connect",
    includes: ["P05"],
  },
  {
    name: "the owner asks about an ineligible product mid-chat, then finishes",
    lang: "en",
    steps: ["kirana store in Nashik", "2", "1", "can I get SD-WAN?", "no", "hotspot", "none"],
    segment: "micro",
    profile: p(2, 2, 1, "none"),
    templateId: "dukaan-digital-starter",
    excludes: ["P10"],
  },
];

const MODES = [
  { name: "rules only (no key)", llm: () => undefined },
  { name: "honest LLM", llm: honestLlm },
  { name: "lying LLM", llm: lyingLlm },
] as const;

describe("advisor scenarios (R2.10: at least 15 varied businesses)", () => {
  it("has at least 15 scenarios covering every segment, both languages and all GSTIN states", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(SCENARIOS.map((s) => s.segment))).toEqual(new Set(["micro", "prof", "multi", "mfg"]));
    expect(new Set(SCENARIOS.map((s) => s.lang))).toEqual(new Set(["en", "hi"]));
    expect(new Set(SCENARIOS.map((s) => s.profile.gstin))).toEqual(new Set(["active", "inactive", "none"]));
    expect(new Set(SCENARIOS.map((s) => s.profile.cityTier))).toEqual(new Set([1, 2]));
  });

  for (const mode of MODES) {
    describe(mode.name, () => {
      it.each(SCENARIOS)("$name", async (s) => {
        const fake = mode.llm();
        const { engine, sessions } = makeEngine(fake);
        const { session, replies } = await runChat(engine, sessions, s.lang, s.steps);
        const last = replies.at(-1)!;

        expect(finalProfile(session)).toEqual(s.profile);
        expectSafeRecommendation(last, s.segment, s.profile);
        expect(last.recommendation!.templateId).toBe(s.templateId);
        const ids = last.recommendation!.items.map((i) => i.productId);
        for (const id of s.includes ?? []) expect(ids).toContain(id);
        for (const id of s.excludes ?? []) expect(ids).not.toContain(id);
        if (s.suggested) expect(last.recommendation!.quoteRequest.include).toEqual(s.suggested);
        expect(last.expecting).toBeNull();

        // Every reply is in the owner's language.
        for (const r of replies) {
          for (const m of r.messages) {
            if (s.lang === "hi") expect(m.text, m.text).toMatch(/[ऀ-ॿ]/);
          }
        }

        if (mode.name === "lying LLM") {
          // Nothing the lying model wrote reached the owner.
          for (const m of replies.flatMap((r) => r.messages)) {
            expect(m.source).toBe("rules");
            expect(m.text).not.toMatch(/₹99\b|₹1 per|discount|% off|www\.|9876543210/);
          }
          for (const item of last.recommendation!.items) expect(item.why).not.toMatch(/₹5|SD-WAN/);
        }
        if (mode.name === "honest LLM") {
          expect(last.recommendation!.whySource).toBe("gemini");
          expect(replies.flatMap((r) => r.messages).some((m) => m.source === "gemini")).toBe(true);
        }
      });
    });
  }

  it("the same chat gives the same recommendation with and without an LLM", async () => {
    for (const s of SCENARIOS) {
      const outcomes = [];
      for (const mode of MODES) {
        const { engine, sessions } = makeEngine(mode.llm());
        const { replies } = await runChat(engine, sessions, s.lang, s.steps);
        const rec = replies.at(-1)!.recommendation!;
        outcomes.push({ request: rec.quoteRequest, items: rec.items.map((i) => [i.productId, i.qty]), totals: rec.totals });
      }
      expect(outcomes[1], s.name).toEqual(outcomes[0]);
      expect(outcomes[2], s.name).toEqual(outcomes[0]);
    }
  });
});

describe("recommendation invariant over every kind of business", () => {
  it("never contains an ineligible product, for 2,304 combinations of answers", () => {
    const toolSets: Tool[][] = [[], ["pos"], ["messaging"], [...TOOLS]];
    let checked = 0;
    for (const kind of BUSINESS_KINDS)
      for (const employees of [1, 3, 5, 10, 25, 60])
        for (const sites of [1, 2, 3, 8])
          for (const tier of [1, 2] as const)
            for (const gstin of ["active", "inactive", "none"] as const)
              for (const tools of toolSets) {
                const city = cities.find((c) => c.tier === tier)!.name;
                const { answers } = applyUpdates(
                  {} as Answers,
                  { businessKind: kind, employees, sites, city, gstin, internet: "mobile_hotspot", tools },
                  cities,
                );
                const rec = recommend(catalogue, answers);
                const profile = { cityTier: tier, employees, sites, gstin };
                expect(rec.quoteRequest.segment).toBe(segmentFor(kind, sites));
                const lines = selectedItems(rec).map((i) => ({ productId: i.productId, qty: i.qty }));
                const check = checkBundle(catalogue, lines, profile);
                expect(check.valid, `${kind} ${employees}/${sites}/${tier}/${gstin} ${tools}`).toBe(true);
                // Suggestions follow the tools answer.
                for (const s of rec.suggested) {
                  if (s.productId === "P19") expect(tools).not.toContain("pos");
                  if (s.productId === "P23") expect(tools).not.toContain("cctv");
                  if (s.productId === "P15") expect(tools).toContain("messaging");
                }
                checked++;
              }
    expect(checked).toBe(2304);
  });
});
