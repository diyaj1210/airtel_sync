import type { Block } from "../api/quote";
import type { MessageKey } from "./en";
import type { Translate } from "./I18nProvider";

/** Turn a rule/dependency reason from the backend into a sentence in the current language. */
export function describeBlock(block: Block, t: Translate, productName: (id: string) => string): string {
  const p = block.params;
  const names = (ids: unknown, joiner: MessageKey) =>
    Array.isArray(ids) ? ids.map((id) => productName(String(id))).join(t(joiner)) : "";

  switch (block.code) {
    case "CITY_TIER":
      return t("reason.CITY_TIER");
    case "MIN_EMPLOYEES":
      return t("reason.MIN_EMPLOYEES", { min: Number(p.minEmployees) });
    case "MIN_SITES":
      return t("reason.MIN_SITES", { min: Number(p.minSites) });
    case "GSTIN_REQUIRED":
      return t(p.gstin === "inactive" ? "reason.GSTIN_REQUIRED.inactive" : "reason.GSTIN_REQUIRED.none");
    case "REQUIRES_ONE_OF":
      return t("reason.REQUIRES_ONE_OF", { products: names(p.requiresOneOf, "reason.or") });
    case "REQUIRED_BY":
      return t("reason.REQUIRED_BY", { products: names(p.products, "reason.and") });
    case "LAST_ITEM":
      return t("reason.LAST_ITEM");
    case "REPLACED_BY":
      return t("reason.REPLACED_BY", { product: productName(String(p.product)) });
    default:
      // Unknown code from a newer backend: fall back to its English message.
      return block.message;
  }
}
