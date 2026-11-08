import type { Catalogue } from "../catalogue/catalogue.js";
import { checkProduct, type RuleViolation } from "../catalogue/rules.js";
import type { BusinessProfile, ProductId } from "../catalogue/types.js";
import type { QuoteItem } from "../quote/quote.js";
import { isComplete, profileFor, type Answers } from "./answers.js";
import { BUSINESS_TYPES, CITY_HINDI_NAMES } from "./lexicon.js";
import { selectedItems, type Recommendation } from "./recommend.js";
import {
  days,
  describeProduct,
  gstinLabel,
  inr,
  internetLabel,
  kindLabel,
  months,
  productWhy,
  reasonText,
  toolLabel,
  tr,
  unitText,
  type Lang,
} from "./text.js";

/**
 * Everything the advisor says about products and prices is built here from the rules engine's
 * output: the facts handed to the LLM (which may only reword them), the template sentences used
 * without an LLM, and the products / amounts a reply is allowed to contain.
 */

const CONNECTIVITY = new Set(["P01", "P02", "P03", "P04", "P05", "P06"]);

// ---------------------------------------------------------------- answers in words

export function cityName(lang: Lang, answers: Answers): string {
  const city = answers.city;
  if (!city) return "";
  if (!city.listed) return city.name || (lang === "hi" ? "आपका शहर" : "your city");
  return lang === "hi" ? (CITY_HINDI_NAMES[city.name] ?? city.name) : city.name;
}

export function businessName(lang: Lang, answers: Answers): string {
  const type = answers.businessType;
  if (type) {
    if (lang === "en" || /[ऀ-ॿ]/.test(type)) return type;
    // A known English label ("Kirana store") has a Hindi one; "X chain" -> "X चेन".
    const base = type.replace(/ chain$/, "");
    const known = BUSINESS_TYPES.find((b) => b.en === base);
    if (known) return base === type ? known.hi : `${known.hi} चेन`;
  }
  return answers.businessKind ? tr(lang, `recommend.business.${answers.businessKind}`) : "";
}

const countText = (lang: Lang, key: "employees" | "sites", n: number) =>
  n === 1 ? tr(lang, `ack.${key}.one`) : tr(lang, `ack.${key}`, { n });

/** "Noted: Dental clinic, 5 people, Kochi." for the slots that just changed. */
export function ackText(lang: Lang, answers: Answers, changed: readonly string[]): string | null {
  const facts: string[] = [];
  for (const slot of changed) {
    switch (slot) {
      case "businessKind":
        facts.push(businessName(lang, answers) || kindLabel(lang, answers.businessKind!));
        break;
      case "employees":
        facts.push(countText(lang, "employees", answers.employees!));
        break;
      case "sites":
        facts.push(countText(lang, "sites", answers.sites!));
        break;
      case "city":
        facts.push(
          answers.city!.listed
            ? cityName(lang, answers)
            : answers.city!.name
              ? tr(lang, "ack.city.unlisted", { city: answers.city!.name })
              : tr(lang, "ack.city.unlistedNoName"),
        );
        break;
      case "gstin":
        facts.push(gstinLabel(lang, answers.gstin!));
        break;
      case "internet":
        facts.push(internetLabel(lang, answers.internet!));
        break;
      case "tools":
        facts.push(
          answers.tools!.length === 0
            ? tr(lang, "ack.tools.none")
            : tr(lang, "ack.tools", { tools: answers.tools!.map((t) => toolLabel(lang, t)).join(tr(lang, "listJoin")) }),
        );
        break;
    }
  }
  return facts.length > 0 ? tr(lang, "ack", { facts: facts.join(tr(lang, "listJoin")) }) : null;
}

// ---------------------------------------------------------------- recommendation

export interface RecommendationText {
  /** The chat bubble. */
  text: string;
  /** Why each selected product is in the bundle. */
  whys: Record<ProductId, string>;
}

function whyFor(lang: Lang, answers: Answers, rec: Recommendation, item: QuoteItem): string {
  const suggestion = rec.suggested.find((s) => s.productId === item.productId);
  if (suggestion) return tr(lang, `because.${suggestion.because}`);
  const why = productWhy(lang, item.productId);
  return CONNECTIVITY.has(item.productId) && answers.internet ? `${why} ${tr(lang, `internet.context.${answers.internet}`)}` : why;
}

const reasonsText = (catalogue: Catalogue, lang: Lang, violations: readonly RuleViolation[]) =>
  violations.map((v) => reasonText(catalogue, lang, v)).join(" ");

export function templateRecommendation(catalogue: Catalogue, lang: Lang, answers: Answers, rec: Recommendation): RecommendationText {
  const { quote } = rec;
  const items = selectedItems(rec);
  const whys = Object.fromEntries(items.map((i) => [i.productId, whyFor(lang, answers, rec, i)]));
  const lines = [
    tr(lang, "recommend.intro", {
      business: businessName(lang, answers),
      city: cityName(lang, answers),
      employees: countText(lang, "employees", answers.employees!),
      sites: countText(lang, "sites", answers.sites!),
      bundle: quote.name,
      monthly: inr(quote.totals.monthlyInr),
    }),
    tr(lang, "recommend.terms", {
      setup: inr(quote.totals.setupInr),
      contract: months(lang, quote.totals.contractMonths),
      days: days(lang, quote.totals.installDays),
    }),
    ...rec.suggested.map((s) => `• ${tr(lang, "recommend.added", { name: catalogue.get(s.productId).name, because: tr(lang, `because.${s.because}`) })}`),
  ];
  if (quote.unavailable.length > 0) {
    lines.push(
      tr(lang, "recommend.unavailable", {
        list: quote.unavailable.map((u) => `${u.name} (${reasonsText(catalogue, lang, u.violations)})`).join(tr(lang, "listJoin")),
      }),
    );
  }
  lines.push(tr(lang, "recommend.close"));
  return { text: lines.join("\n"), whys };
}

/** Facts for the LLM: the business (no identifiers) and the bundle the rules engine built. */
export function recommendationFacts(catalogue: Catalogue, answers: Answers, rec: Recommendation) {
  const { quote } = rec;
  return {
    business: businessFacts(answers),
    bundle: {
      name: quote.name,
      monthlyPrice: inr(quote.totals.monthlyInr),
      oneTimeSetup: inr(quote.totals.setupInr),
      contract: months("en", quote.totals.contractMonths),
      readyIn: days("en", quote.totals.installDays),
      products: selectedItems(rec).map((i) => ({
        productId: i.productId,
        name: i.name,
        description: i.description,
        quantity: i.qty,
        unit: i.unit,
        monthly: inr(i.monthlyInr),
        oneTimeSetup: inr(i.setupInr),
        addedBecause: rec.suggested.find((s) => s.productId === i.productId)?.because ?? null,
      })),
      notAvailable: quote.unavailable.map((u) => ({
        name: u.name,
        reasons: u.violations.map((v) => reasonText(catalogue, "en", v)),
      })),
    },
  };
}

export function businessFacts(answers: Answers) {
  return {
    type: answers.businessType ?? answers.businessKind ?? null,
    kind: answers.businessKind ?? null,
    employees: answers.employees ?? null,
    locations: answers.sites ?? null,
    city: answers.city ? (answers.city.listed ? answers.city.name : answers.city.name || "a city not in our list") : null,
    cityTier: answers.city?.tier ?? null,
    gstin: answers.gstin ?? null,
    currentInternet: answers.internet ?? null,
    toolsInUse: answers.tools ?? null,
  };
}

/** Amounts a text about this recommendation may quote. */
export function recommendationAmounts(rec: Recommendation): Set<number> {
  const amounts = new Set<number>([rec.quote.totals.monthlyInr, rec.quote.totals.setupInr]);
  for (const i of selectedItems(rec)) [i.monthlyInr, i.unitPriceInr, i.setupInr].forEach((a) => amounts.add(a));
  return amounts;
}

export const recommendationProducts = (rec: Recommendation) => new Set(selectedItems(rec).map((i) => i.productId));

// ---------------------------------------------------------------- questions about products

export interface ProductVerdict {
  productId: ProductId;
  name: string;
  description: string;
  unit: string;
  unitPriceInr: number;
  setupInr: number;
  /** null = not known yet (the answers are not complete). */
  eligible: boolean | null;
  /** Why it is not available (when eligible = false), or who can get it (when eligible = null). */
  violations: RuleViolation[];
  inBundle: boolean;
  /** It is an add-on of the recommended bundle that can be switched on in the quote. */
  addOn: boolean;
}

/** The strictest business, to list every rule a product has before we know the business. */
const NOBODY: BusinessProfile = { cityTier: 2, employees: 1, sites: 1, gstin: "none" };

export function productVerdicts(
  catalogue: Catalogue,
  lang: Lang,
  answers: Answers,
  rec: Recommendation | null,
  productIds: readonly ProductId[],
): ProductVerdict[] {
  const bundleIds = rec ? selectedItems(rec).map((i) => i.productId) : [];
  return productIds.map((id) => {
    const p = catalogue.get(id);
    const item = rec?.quote.items.find((i) => i.productId === id);
    const known = isComplete(answers);
    // Known business: check against the recommended bundle. Unknown: list every rule the product has.
    const violations = checkProduct(p, known ? profileFor(answers) : NOBODY, known ? [...bundleIds, id] : []);
    return {
      productId: id,
      name: p.name,
      description: describeProduct(catalogue, lang, id),
      unit: p.unit,
      unitPriceInr: p.priceMinInr,
      setupInr: p.setupInr,
      eligible: known ? violations.length === 0 : null,
      violations,
      inBundle: item?.selected ?? false,
      addOn: item?.kind === "addon" && item.canToggle && !item.selected,
    };
  });
}

export function templateProductAnswer(catalogue: Catalogue, lang: Lang, verdicts: readonly ProductVerdict[]): string {
  return verdicts
    .map((v) => {
      const stop = tr(lang, "fullStop");
      const parts = [
        `${v.name}: ${v.description}${stop}`,
        `${tr(lang, "product.price", { price: inr(v.unitPriceInr), unit: unitText(lang, v.unit) })}${v.setupInr > 0 ? ` ${tr(lang, "product.setup", { setup: inr(v.setupInr) })}` : ""}${stop}`,
      ];
      if (v.eligible === true) {
        parts.push(tr(lang, "product.eligible"));
        parts.push(tr(lang, v.inBundle ? "product.inBundle" : v.addOn ? "product.addOn" : "product.notInBundle"));
      } else if (v.eligible === false) {
        parts.push(tr(lang, "product.notEligible", { reasons: reasonsText(catalogue, lang, v.violations) }));
      } else {
        parts.push(
          v.violations.length > 0
            ? tr(lang, "product.requirements", { reasons: reasonsText(catalogue, lang, v.violations) })
            : tr(lang, "product.anyone"),
        );
        parts.push(tr(lang, "product.confirmLater"));
      }
      return parts.join(" ");
    })
    .join("\n\n");
}

export function productFacts(catalogue: Catalogue, answers: Answers, rec: Recommendation | null, verdicts: readonly ProductVerdict[]) {
  return {
    business: businessFacts(answers),
    recommendedBundle: rec ? recommendationFacts(catalogue, answers, rec).bundle : null,
    askedProducts: verdicts.map((v) => ({
      name: v.name,
      description: catalogue.get(v.productId).description,
      priceFrom: `${inr(v.unitPriceInr)}/month ${v.unit}`,
      oneTimeSetup: inr(v.setupInr),
      availableForThisBusiness: v.eligible,
      ...(v.eligible === false ? { whyNotAvailable: v.violations.map((x) => reasonText(catalogue, "en", x)) } : {}),
      ...(v.eligible === null ? { whoCanGetIt: v.violations.map((x) => reasonText(catalogue, "en", x)) } : {}),
      alreadyInBundle: v.inBundle,
      canBeAddedInQuote: v.addOn,
    })),
  };
}

export function productAmounts(verdicts: readonly ProductVerdict[], rec: Recommendation | null): Set<number> {
  const amounts = rec ? recommendationAmounts(rec) : new Set<number>();
  for (const v of verdicts) [v.unitPriceInr, v.setupInr].forEach((a) => amounts.add(a));
  return amounts;
}

// ---------------------------------------------------------------- questions about the bundle

export function templateBundleAnswer(lang: Lang, rec: Recommendation | null): string {
  if (!rec) return tr(lang, "bundle.notYet");
  const t = rec.quote.totals;
  return tr(lang, "bundle.summary", {
    bundle: rec.quote.name,
    monthly: inr(t.monthlyInr),
    setup: inr(t.setupInr),
    contract: months(lang, t.contractMonths),
    days: days(lang, t.installDays),
  });
}
