import { expect } from "vitest";
import { profileFor } from "../../src/advisor/answers.js";
import { AdvisorEngine, type AdvisorReply, type Choice } from "../../src/advisor/engine.js";
import {
  LlmError,
  LlmGate,
  NO_LLM,
  type AdvisorLlm,
  type ExplainRequest,
  type LlmExplanation,
  type LlmUnderstanding,
  type UnderstandRequest,
} from "../../src/advisor/llm.js";
import { parseMessage } from "../../src/advisor/parser.js";
import { AdvisorSessionStore, type AdvisorSession } from "../../src/advisor/sessions.js";
import type { Lang } from "../../src/advisor/text.js";
import { findTemplate } from "../../src/catalogue/bundles.js";
import { priceBundle } from "../../src/catalogue/pricing.js";
import { checkBundle, checkProduct } from "../../src/catalogue/rules.js";
import type { BusinessProfile, Segment } from "../../src/catalogue/types.js";
import { createLogger } from "../../src/logger.js";
import { catalogue, cities } from "../testApp.js";

export { catalogue, cities };

export const silentLogger = () => createLogger({ service: "test", level: "silent" });

export function makeEngine(llm: AdvisorLlm = NO_LLM, now: () => number = () => 0) {
  const lines: string[] = [];
  const logger = createLogger({ service: "test", level: "info", sink: (l) => lines.push(l) });
  const gate = new LlmGate(llm, () => undefined, now);
  const engine = new AdvisorEngine({ catalogue, cities, gate, logger });
  const sessions = new AdvisorSessionStore(now);
  return { engine, sessions, gate, logLines: lines };
}

export type Step = string | Choice;

/** Run a whole chat: start, then each step (typed text or a quick-reply choice). */
export async function runChat(
  engine: AdvisorEngine,
  sessions: AdvisorSessionStore,
  lang: Lang,
  steps: readonly Step[],
): Promise<{ session: AdvisorSession; replies: AdvisorReply[] }> {
  const session = sessions.create(lang);
  const replies: AdvisorReply[] = [await engine.start(session)];
  for (const step of steps) {
    replies.push(await engine.handle(session, typeof step === "string" ? { lang, text: step } : { lang, choice: step }));
  }
  return { session, replies };
}

/** Every product in a recommendation passes every catalogue rule, and the price is the engine's. */
export function expectSafeRecommendation(reply: AdvisorReply, segment: Segment, profile: BusinessProfile) {
  const rec = reply.recommendation;
  expect(rec, "a recommendation").not.toBeNull();
  expect(rec!.quoteRequest.segment).toBe(segment);
  expect(rec!.quoteRequest.profile).toEqual(profile);

  const lines = rec!.items.map((i) => ({ productId: i.productId, qty: i.qty }));
  const check = checkBundle(catalogue, lines, profile);
  expect(check.lines.filter((l) => !l.eligible), "ineligible lines").toEqual([]);

  // Only products of the segment's bundle (core or add-on) are ever recommended.
  const template = findTemplate(segment, "standard")!;
  const allowed = new Set([
    ...template.lines(profile).flatMap((l) => [l.productId, ...(l.fallback ?? []).map((f) => f.productId)]),
    ...template.addOns.map((a) => a.productId),
  ]);
  for (const id of lines.map((l) => l.productId)) expect(allowed.has(id), `${id} belongs to ${template.id}`).toBe(true);

  // No product the rules engine rejects for this business is in it.
  const ids = lines.map((l) => l.productId);
  for (const p of catalogue.products) {
    if (checkProduct(p, profile, ids).length > 0) expect(ids).not.toContain(p.id);
  }

  // Prices are the catalogue's list prices.
  const price = priceBundle(catalogue, lines);
  expect(rec!.totals.monthlyInr).toBe(price.monthlyInr);
  expect(rec!.totals.setupInr).toBe(price.setupInr);
  expect(rec!.totals.contractMonths).toBe(price.contractMonths);
  expect(rec!.totals.installDays).toBe(price.installDays);
  for (const item of rec!.items) {
    expect(item.monthlyInr).toBe(catalogue.get(item.productId).priceMinInr * item.qty);
    expect(item.why.length).toBeGreaterThan(0);
  }
}

/** The profile the session ended with (to compare with the scenario's expected profile). */
export const finalProfile = (session: AdvisorSession) => profileFor(session.answers);

// ---------------------------------------------------------------- fake LLMs (no network, no credits)

/** Reads messages like the rules do (so a scenario gives the same facts) but talks via callbacks. */
export function fakeLlm(opts: {
  understand?: (req: UnderstandRequest) => Partial<LlmUnderstanding> | Promise<Partial<LlmUnderstanding>>;
  explain?: (req: ExplainRequest) => LlmExplanation | Promise<LlmExplanation>;
}): AdvisorLlm & { calls: { understand: UnderstandRequest[]; explain: ExplainRequest[] } } {
  const calls = { understand: [] as UnderstandRequest[], explain: [] as ExplainRequest[] };
  return {
    calls,
    status: async () => ({ enabled: true, provider: "fake", model: "fake-1" }),
    async understand(req) {
      calls.understand.push(req);
      const kind = req.known.kind as AdvisorSession["answers"]["businessKind"] | null;
      const local = parseMessage(req.message, {
        expecting: req.expecting,
        answers: kind ? { businessKind: kind } : {},
        cities,
        catalogue,
      });
      const extra = opts.understand ? await opts.understand(req) : {};
      return { updates: local.updates, intent: local.intent, offTopic: false, productIds: local.productIds, ack: null, ...extra };
    },
    async explain(req) {
      calls.explain.push(req);
      if (!opts.explain) throw new LlmError("upstream");
      return opts.explain(req);
    },
  };
}

/** Writes correct text from the facts it is given, in the right language. */
export function honestLlm() {
  return fakeLlm({
    understand: (req) => ({ ack: req.lang === "hi" ? "धन्यवाद, जानकारी मिल गई।" : "Thanks, got it." }),
    explain: (req) => {
      const facts = req.facts as {
        bundle?: { name: string; monthlyPrice: string; products: { productId: string; name: string }[] } | null;
      };
      const bundle = facts.bundle;
      if (req.task === "recommendation" && bundle) {
        return {
          text:
            req.lang === "hi"
              ? `आपके व्यवसाय के लिए ${bundle.name} सही है, कीमत ${bundle.monthlyPrice}/महीना।`
              : `${bundle.name} suits your business at ${bundle.monthlyPrice}/month.`,
          lines: bundle.products.map((p) => ({
            productId: p.productId,
            why: req.lang === "hi" ? `${p.name} आपके रोज़ के काम में मदद करेगा।` : `${p.name} helps your daily work.`,
          })),
        };
      }
      return { text: req.lang === "hi" ? "हमारी टीम का कोई व्यक्ति इसमें मदद कर सकता है।" : "A person from our team can help with that.", lines: [] };
    },
  });
}

/** Tries everything a misbehaving model could: other products, fake prices, discounts, links. */
export function lyingLlm() {
  const everyProduct = catalogue.products.map((p) => p.name).join(", ");
  return fakeLlm({
    understand: () => ({
      ack: "Great! Get Managed SD-WAN and Internet Leased Line 100 for just ₹99 with a 50% discount at www.example.com",
      productIds: ["P10", "P06", "P99"],
    }),
    explain: () => ({
      text: `Buy ${everyProduct}. Total ₹1 per month, 90% off! Call 9876543210.`,
      lines: catalogue.products.map((p) => ({ productId: p.id, why: `Take Managed SD-WAN too, only ₹5.` })),
    }),
  });
}
