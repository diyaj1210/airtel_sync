import { describe, expect, it } from "vitest";
import { amountsIn, checkLlmText, cleanLlmText, devanagariShare, productsNamedIn } from "../../src/advisor/guard.js";
import type { Lang } from "../../src/advisor/text.js";
import { catalogue } from "./helpers.js";

const ctx = (lang: Lang, products: string[], amounts: number[]) => ({
  lang,
  catalogue,
  allowedProducts: new Set(products),
  allowedAmounts: new Set(amounts),
  maxLength: 900,
});

describe("checkLlmText", () => {
  const office = ctx("en", ["P02", "P09"], [4215, 1500, 1499]);

  it("passes a correct explanation", () => {
    expect(checkLlmText("Biz Fibre 300 and Backup 4G/5G Failover keep you online for ₹4,215/month.", office)).toEqual({
      ok: true,
      text: "Biz Fibre 300 and Backup 4G/5G Failover keep you online for ₹4,215/month.",
    });
  });

  it.each([
    ["names a product the rules engine did not allow", "Also take Managed SD-WAN."],
    ["uses another name for it", "You should add SD-WAN for your branches."],
    ["names a leased line", "A leased line would be better."],
    ["invents a price", "Only ₹3,999 per month."],
    ["invents a price written as Rs", "Rs 999 only"],
    ["invents a price as /month", "Just 2,000/month."],
    ["offers a discount", "You get a 20% off welcome offer."],
    ["offers cashback", "Plus cashback on your first bill."],
    ["contains a link", "See www.example.com"],
    ["contains a phone number", "Call 9876543210"],
    ["contains a GSTIN", "Your GSTIN 27XUIXG0767D1ZP is fine"],
    ["contains markup", "<b>Great</b>"],
    ["is empty", "   "],
    ["is in Hindi when English was asked", "यह बंडल आपके लिए सही है।"],
  ])("rejects text that %s", (_why, text) => {
    expect(checkLlmText(text, office).ok).toBe(false);
  });

  it("rejects English text when Hindi was asked, accepts Hindi with English product names", () => {
    const hi = ctx("hi", ["P02"], [1499]);
    expect(checkLlmText("This bundle is right for you.", hi).ok).toBe(false);
    expect(checkLlmText("Biz Fibre 300 से आपका पूरा काम तेज़ चलेगा, सिर्फ़ ₹1,499/महीना में।", hi).ok).toBe(true);
  });

  it("allows a name that appears inside an allowed product's own description", () => {
    // P02's description says "static IP optional"
    expect(checkLlmText("Biz Fibre 300 comes with an optional static IP.", ctx("en", ["P02"], [])).ok).toBe(true);
    expect(checkLlmText("Add a Static IP too.", ctx("en", ["P01"], [])).ok).toBe(false);
  });

  it("rejects text longer than the limit and non-strings", () => {
    expect(checkLlmText("a".repeat(901), office).ok).toBe(false);
    expect(checkLlmText(42, office).ok).toBe(false);
  });

  it("lists the problems", () => {
    const r = checkLlmText("Managed SD-WAN for ₹1", office);
    expect(r).toEqual({
      ok: false,
      problems: ["names products the rules engine did not allow here: P10", "amounts not computed by the price engine: 1"],
    });
  });
});

describe("helpers", () => {
  it("finds rupee amounts in every common form, including Devanagari digits", () => {
    expect(amountsIn("₹4,215/month, setup Rs. 1,500 and 299 rupees, ₹१,४९९")).toEqual([4215, 1500, 1499, 299, 4215]);
    expect(amountsIn("1,000 conversations, 300 Mbps, 12 months")).toEqual([]);
  });

  it("measures how much of the text is in Devanagari", () => {
    expect(devanagariShare("नमस्ते")).toBe(1);
    expect(devanagariShare("hello")).toBe(0);
  });

  it("finds products by name or alias", () => {
    expect(productsNamedIn("biz fibre 300 and a firewall", catalogue, new Set())).toEqual(["P02", "P21"]);
  });

  it("removes markdown", () => {
    expect(cleanLlmText("**Office Pro**\n\n\n\n* fast\n- safe")).toBe("Office Pro\n\n• fast\n• safe");
  });
});
