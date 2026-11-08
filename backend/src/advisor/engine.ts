import type { Catalogue } from "../catalogue/catalogue.js";
import type { RuleViolation } from "../catalogue/rules.js";
import type { ProductId } from "../catalogue/types.js";
import type { City } from "../cities.js";
import type { Logger } from "../logger.js";
import { maskIdentifiers } from "../masking.js";
import type { Quote, QuoteRequest } from "../quote/quote.js";
import {
  applyUpdates,
  BUSINESS_KINDS,
  INTERNET_TYPES,
  isComplete,
  nextSlot,
  OTHER_CITY,
  SLOTS,
  TOOLS,
  type AnswerUpdates,
  type Answers,
  type Slot,
} from "./answers.js";
import {
  ackText,
  businessFacts,
  productAmounts,
  productFacts,
  productVerdicts,
  recommendationAmounts,
  recommendationFacts,
  recommendationProducts,
  templateBundleAnswer,
  templateProductAnswer,
  templateRecommendation,
  type ProductVerdict,
} from "./explain.js";
import { checkLlmText } from "./guard.js";
import { CITY_HINDI_NAMES } from "./lexicon.js";
import type { LlmGate, LlmUnderstanding } from "./llm.js";
import { GSTIN_PATTERN, parseMessage, type Intent, type Understanding } from "./parser.js";
import { recommend, selectedItems, type Recommendation } from "./recommend.js";
import { remember, type AdvisorSession } from "./sessions.js";
import { gstinLabel, internetLabel, kindLabel, toolLabel, tr, type Lang } from "./text.js";

/**
 * One advisor turn: understand the message (LLM if available, else rules), validate and store the
 * answers, then ask the next question or recommend. The rules engine decides every product and
 * price; the LLM's words are checked by the guard and replaced by templates when they fail.
 */

export type AdvisorAction = "human" | "not_interested" | "restart";
export type Choice = { slot: Slot; value: unknown } | { slot: "action"; value: AdvisorAction };

export interface AdvisorInput {
  lang: Lang;
  text?: string;
  choice?: Choice;
}

export type MessageSource = "gemini" | "rules";

export interface ProductCard {
  productId: ProductId;
  name: string;
  description: string;
  unit: string;
  unitPriceInr: number;
  setupInr: number;
  eligible: boolean | null;
  violations: RuleViolation[];
  inBundle: boolean;
  addOn: boolean;
}

export interface AdvisorMessage {
  text: string;
  source: MessageSource;
  products?: ProductCard[];
}

export interface QuickReply {
  label: string;
  choice: Choice;
}

export interface RecommendationView {
  quoteRequest: QuoteRequest;
  templateId: string;
  name: string;
  totals: Quote["totals"];
  items: { productId: ProductId; name: string; qty: number; unit: string; monthlyInr: number; setupInr: number; kind: "core" | "addon"; why: string }[];
  unavailable: Quote["unavailable"];
  whySource: MessageSource;
}

export interface AdvisorReply {
  sessionId: string;
  lang: Lang;
  messages: AdvisorMessage[];
  expecting: Slot | null;
  quickReplies: QuickReply[];
  multiSelect: boolean;
  answers: Answers;
  recommendation: RecommendationView | null;
  /** The UI should open the call-back form (handoff) or the "why not" form (not_interested). */
  action: "handoff" | "not_interested" | null;
  /** Whether the AI helper (Gemini) is answering right now. */
  mode: "gemini" | "basic";
}

export interface EngineDeps {
  catalogue: Catalogue;
  cities: readonly City[];
  gate: LlmGate;
  logger: Logger;
}

export const MAX_MESSAGE_CHARS = 500;
const STUCK_AFTER = 3;
const EMPLOYEE_CHOICES = [1, 2, 5, 10, 20];
const SITE_CHOICES = [1, 2, 3, 5, 10];

export class AdvisorEngine {
  constructor(private readonly deps: EngineDeps) {}

  private get llmOn(): boolean {
    return this.deps.gate.available() && this.deps.gate.lastFailureKind === null;
  }

  /** First message of a chat. Asks the LLM service whether it is configured (no Gemini call). */
  async start(session: AdvisorSession): Promise<AdvisorReply> {
    const status = await this.deps.gate.llm.status();
    if (!status.enabled) this.deps.gate.block("disabled");
    const lang = session.lang;
    const messages: AdvisorMessage[] = [{ text: tr(lang, "greeting"), source: "rules" }];
    if (!this.llmOn) messages.push({ text: tr(lang, "basicMode"), source: "rules" });
    this.ask(session, messages);
    return this.reply(session, messages);
  }

  async handle(session: AdvisorSession, input: AdvisorInput): Promise<AdvisorReply> {
    const { catalogue, cities, gate, logger } = this.deps;
    session.lang = input.lang;
    session.turns++;
    const lang = session.lang;
    const messages: AdvisorMessage[] = [];
    let usedLlm = false;

    // 1. Understand
    let understanding: Understanding;
    let llmAck: string | null = null;
    let offTopic = false;
    if (input.choice) {
      understanding = this.fromChoice(input.choice);
      remember(session, { role: "owner", text: this.choiceLabel(lang, input.choice) });
    } else {
      const text = (input.text ?? "").trim();
      const masked = maskIdentifiers(text);
      const local = parseMessage(text, { expecting: session.expecting, answers: session.answers, cities, catalogue });
      const fromLlm = this.rulesAreEnough(local, text, session.expecting) ? null : await gate.call((llm) =>
        llm.understand({
          lang,
          expecting: session.expecting,
          known: businessFacts(session.answers),
          cities: cities.map((c) => c.name),
          products: catalogue.products.map((p) => ({ id: p.id, name: p.name, description: p.description })),
          recentTurns: session.history.slice(-6),
          message: masked,
        }),
      );
      remember(session, { role: "owner", text: masked });
      if (fromLlm) {
        usedLlm = true;
        understanding = this.mergeLlm(fromLlm, local, text, session.expecting);
        llmAck = fromLlm.ack;
        offTopic = fromLlm.offTopic;
      } else {
        understanding = local;
      }
    }

    if (understanding.intent === "restart") {
      this.reset(session);
      messages.push({ text: tr(lang, "restarted"), source: "rules" });
      this.ask(session, messages);
      return this.reply(session, messages, null, usedLlm);
    }

    // 2. Validate and store the answers (the only way facts reach the rules engine)
    const applied = applyUpdates(session.answers, understanding.updates, cities);
    session.answers = applied.answers;
    if (applied.changed.length > 0) session.unclearStreak = 0;

    if (understanding.intent === "human") {
      messages.push({ text: tr(lang, "handoff"), source: "rules" });
      return this.reply(session, messages, "handoff", usedLlm);
    }
    if (understanding.intent === "not_interested") {
      messages.push({ text: tr(lang, "notInterested"), source: "rules" });
      return this.reply(session, messages, "not_interested", usedLlm);
    }

    // 3. Acknowledge (LLM words if they pass the guard, else the template)
    // A question gets an answer, not an acknowledgement ("Sure!" before "not available" misleads).
    const isQuestion = understanding.intent === "product_question" || understanding.intent === "bundle_question";
    const ack = llmAck && !isQuestion ? this.guarded(lang, llmAck, new Set(), new Set(), 300) : null;
    if (ack) messages.push({ text: ack, source: "gemini" });
    else if (applied.changed.length > 0) {
      const t = ackText(lang, session.answers, applied.changed);
      if (t) messages.push({ text: t, source: "rules" });
    }
    for (const slot of applied.rejected) {
      messages.push({ text: tr(lang, slot === "employees" ? "rejected.employees" : slot === "sites" ? "rejected.sites" : "rejected"), source: "rules" });
    }

    // 4. Answer a question
    const intent: Intent = understanding.intent;
    const recBefore = session.recommendation;
    const willRecommend = isComplete(session.answers) && (applied.changed.length > 0 || !recBefore);
    if (intent === "product_question" && understanding.productIds.length > 0 && !willRecommend) {
      messages.push(await this.answerProducts(session, understanding.productIds, input.text ?? ""));
      usedLlm ||= messages.at(-1)!.source === "gemini";
    } else if (intent === "bundle_question" && !willRecommend) {
      messages.push(await this.answerBundle(session, input.text ?? ""));
      usedLlm ||= messages.at(-1)!.source === "gemini";
    } else if (intent === "greeting" && !ack) {
      messages.push({ text: tr(lang, "greetingBack"), source: "rules" });
    } else if ((intent === "unclear" || (intent === "answer" && !ack)) && applied.changed.length === 0 && applied.rejected.length === 0) {
      if (!offTopic) session.unclearStreak++;
      if (!ack) messages.push({ text: tr(lang, "unclear"), source: "rules" });
      if (session.unclearStreak >= STUCK_AFTER) {
        session.stuck = true;
        messages.push({ text: tr(lang, "stuck"), source: "rules" });
      }
    }

    // 5. Recommend once every answer is known (again whenever an answer changes)
    if (willRecommend) {
      try {
        const rec = recommend(catalogue, session.answers);
        const explained = await this.explainRecommendation(session, rec);
        if (recBefore) messages.push({ text: tr(lang, "recommend.updated"), source: "rules" });
        messages.push(explained.message);
        usedLlm ||= explained.message.source === "gemini";
        session.recommendation = rec;
        session.whys = explained.whys;
        session.whySource = explained.whySource;
        // A product question asked in the same message is answered against the new bundle.
        if (intent === "product_question" && understanding.productIds.length > 0) {
          messages.push(await this.answerProducts(session, understanding.productIds, input.text ?? ""));
        }
      } catch (err) {
        session.recommendation = null;
        logger.error("advisor could not build a bundle", { sessionId: session.id, error: err });
        messages.push({ text: tr(lang, "noBundle"), source: "rules" });
      }
    }

    // 6. Next question
    this.ask(session, messages);
    for (const m of messages) remember(session, { role: "advisor", text: m.text });
    logger.info("advisor turn", {
      sessionId: session.id,
      turn: session.turns,
      intent,
      changed: applied.changed,
      rejected: applied.rejected,
      expecting: session.expecting,
      llm: usedLlm ? "used" : gate.lastFailureKind ?? (gate.available() ? "not needed" : "paused"),
      recommended: session.recommendation?.quote.templateId ?? null,
    });
    return this.reply(session, messages, null, usedLlm);
  }

  // ------------------------------------------------------------ understanding

  private fromChoice(choice: Choice): Understanding {
    if (choice.slot === "action") return { updates: {}, intent: choice.value, productIds: [] };
    const updates: AnswerUpdates = { [choice.slot]: choice.value };
    return { updates, intent: "answer", productIds: [] };
  }

  private choiceLabel(lang: Lang, choice: Choice): string {
    const match = this.quickReplies(lang, choice.slot === "action" ? null : choice.slot).find(
      (q) => JSON.stringify(q.choice) === JSON.stringify(choice),
    );
    return match?.label ?? (choice.slot === "tools" && Array.isArray(choice.value) ? choice.value.join(", ") : String(choice.value)).slice(0, 80);
  }

  /**
   * A short, plain answer to the question just asked ("5", "Kochi", "no GST") or a request for a
   * person needs no LLM: answering it by rules is instant and saves free-plan quota. Sentences,
   * questions and anything the rules did not fully understand go to the LLM.
   */
  private rulesAreEnough(local: Understanding, text: string, expecting: Slot | null): boolean {
    if (local.intent === "human" || local.intent === "restart") return true;
    const short = text.length <= 30 && text.split(/\s+/).length <= 4 && !text.includes("?");
    return short && local.intent === "answer" && expecting !== null && local.updates[expecting] !== undefined;
  }

  /** LLM understanding, with the rules' reading filling the answer to the question just asked. */
  private mergeLlm(llm: LlmUnderstanding, local: Understanding, rawText: string, expecting: Slot | null): Understanding {
    const updates: AnswerUpdates = { ...llm.updates };
    if (expecting && updates[expecting] === undefined && local.updates[expecting] !== undefined) {
      updates[expecting] = local.updates[expecting];
    }
    // A GSTIN-shaped number in the raw text means "has a GSTIN" (the LLM only saw it masked).
    if (GSTIN_PATTERN.test(rawText)) updates.gstin = "active";
    const productIds = llm.productIds.filter((id) => this.deps.catalogue.has(id));
    let intent = llm.intent;
    if (intent === "product_question" && productIds.length === 0) {
      if (local.productIds.length > 0) productIds.push(...local.productIds);
      else intent = "bundle_question";
    }
    // Safety: a request for a person is honoured even if the model missed it.
    if (local.intent === "human" || local.intent === "restart") intent = local.intent;
    return { updates, intent, productIds };
  }

  // ------------------------------------------------------------ answers

  private guarded(lang: Lang, text: string, products: ReadonlySet<ProductId>, amounts: ReadonlySet<number>, maxLength: number): string | null {
    const result = checkLlmText(text, { lang, catalogue: this.deps.catalogue, allowedProducts: products, allowedAmounts: amounts, maxLength });
    if (!result.ok) {
      this.deps.logger.warn("advisor rejected LLM text", { problems: result.problems });
      return null;
    }
    return result.text;
  }

  private async answerProducts(session: AdvisorSession, productIds: ProductId[], question: string): Promise<AdvisorMessage> {
    const { catalogue, gate } = this.deps;
    const lang = session.lang;
    const rec = session.recommendation;
    const verdicts = productVerdicts(catalogue, lang, session.answers, rec, productIds);
    for (const v of verdicts) if (v.eligible === false && !session.askedUnavailable.includes(v.productId)) session.askedUnavailable.push(v.productId);
    const cards = verdicts.map(toCard);
    const template = templateProductAnswer(catalogue, lang, verdicts);

    // The verdict for a product the business cannot buy is always the rules' sentence; the LLM may
    // explain around it but may not name that product.
    const notAvailable = verdicts.filter((v) => v.eligible === false);
    const others = verdicts.filter((v) => v.eligible !== false);
    const out = await gate.call((llm) =>
      llm.explain({ lang, task: "answer", question: maskIdentifiers(question), facts: productFacts(catalogue, session.answers, rec, verdicts) }),
    );
    if (out) {
      const allowed = new Set([...others.map((v) => v.productId), ...(rec ? recommendationProducts(rec) : [])]);
      const text = this.guarded(lang, out.text, allowed, productAmounts(verdicts, rec), 900);
      if (text) {
        const verdictLines = notAvailable.length > 0 ? `${templateProductAnswer(catalogue, lang, notAvailable)}\n\n` : "";
        return { text: `${verdictLines}${text}`, source: "gemini", products: cards };
      }
    }
    return { text: template, source: "rules", products: cards };
  }

  private async answerBundle(session: AdvisorSession, question: string): Promise<AdvisorMessage> {
    const { catalogue, gate } = this.deps;
    const lang = session.lang;
    const rec = session.recommendation;
    const out = await gate.call((llm) =>
      llm.explain({
        lang,
        task: "answer",
        question: maskIdentifiers(question),
        facts: rec ? recommendationFacts(catalogue, session.answers, rec) : { business: businessFacts(session.answers), bundle: null },
      }),
    );
    if (out) {
      const text = this.guarded(lang, out.text, rec ? recommendationProducts(rec) : new Set(), rec ? recommendationAmounts(rec) : new Set(), 900);
      if (text) return { text, source: "gemini" };
    }
    return { text: templateBundleAnswer(lang, rec), source: "rules" };
  }

  private async explainRecommendation(
    session: AdvisorSession,
    rec: Recommendation,
  ): Promise<{ message: AdvisorMessage; whys: Record<ProductId, string>; whySource: MessageSource }> {
    const { catalogue, gate } = this.deps;
    const lang = session.lang;
    const template = templateRecommendation(catalogue, lang, session.answers, rec);
    const out = await gate.call((llm) =>
      llm.explain({ lang, task: "recommendation", question: null, facts: recommendationFacts(catalogue, session.answers, rec) }),
    );
    if (out) {
      // Only products the rules engine put in the bundle may be named; "not included" stays on the card.
      const products = recommendationProducts(rec);
      const amounts = recommendationAmounts(rec);
      const summary = this.guarded(lang, out.text, products, amounts, 900);
      if (summary) {
        const whys = { ...template.whys };
        let llmWhys = 0;
        for (const line of out.lines) {
          if (!products.has(line.productId)) continue;
          const why = this.guarded(lang, line.why, products, amounts, 240);
          if (why) {
            whys[line.productId] = why;
            llmWhys++;
          }
        }
        return {
          message: { text: `${summary}\n${tr(lang, "recommend.close")}`, source: "gemini" },
          whys,
          whySource: llmWhys > 0 ? "gemini" : "rules",
        };
      }
    }
    return { message: { text: template.text, source: "rules" }, whys: template.whys, whySource: "rules" };
  }

  // ------------------------------------------------------------ questions and replies

  private ask(session: AdvisorSession, messages: AdvisorMessage[]): void {
    const next = nextSlot(session.answers);
    session.expecting = next;
    if (next) messages.push({ text: tr(session.lang, `ask.${next}`), source: "rules" });
  }

  private reset(session: AdvisorSession): void {
    session.answers = {};
    session.expecting = null;
    session.recommendation = null;
    session.whys = {};
    session.whySource = "rules";
    session.unclearStreak = 0;
    session.stuck = false;
  }

  quickReplies(lang: Lang, slot: Slot | null): QuickReply[] {
    const q = (label: string, s: Slot, value: unknown): QuickReply => ({ label, choice: { slot: s, value } });
    switch (slot) {
      case "businessKind":
        return BUSINESS_KINDS.map((k) => q(kindLabel(lang, k), "businessKind", k));
      case "employees":
        return EMPLOYEE_CHOICES.map((n) => q(n === 1 ? tr(lang, "employees.justMe") : String(n), "employees", n));
      case "sites":
        return SITE_CHOICES.map((n) => q(String(n), "sites", n));
      case "city":
        return [
          ...this.deps.cities.map((c) => q(lang === "hi" ? (CITY_HINDI_NAMES[c.name] ?? c.name) : c.name, "city", c.name)),
          q(tr(lang, "city.other"), "city", OTHER_CITY),
        ];
      case "gstin":
        return (["active", "inactive", "none"] as const).map((g) => q(gstinLabel(lang, g), "gstin", g));
      case "internet":
        return INTERNET_TYPES.map((i) => q(internetLabel(lang, i), "internet", i));
      case "tools":
        return [...TOOLS.map((t) => q(toolLabel(lang, t), "tools", [t])), q(tr(lang, "tools.none"), "tools", [])];
      case null:
        return [];
    }
  }

  private reply(
    session: AdvisorSession,
    messages: AdvisorMessage[],
    action: AdvisorReply["action"] = null,
    usedLlm = false,
  ): AdvisorReply {
    const lang = session.lang;
    const quickReplies = action ? [] : this.quickReplies(lang, session.expecting);
    if (!action && session.stuck) quickReplies.push({ label: tr(lang, "action.human"), choice: { slot: "action", value: "human" } });
    return {
      sessionId: session.id,
      lang,
      messages,
      expecting: session.expecting,
      quickReplies,
      multiSelect: !action && session.expecting === "tools",
      answers: session.answers,
      recommendation: session.recommendation ? this.view(session) : null,
      action,
      mode: usedLlm || this.llmOn ? "gemini" : "basic",
    };
  }

  private view(session: AdvisorSession): RecommendationView {
    const rec = session.recommendation!;
    return {
      quoteRequest: rec.quoteRequest,
      templateId: rec.quote.templateId,
      name: rec.quote.name,
      totals: rec.quote.totals,
      items: selectedItems(rec).map((i) => ({
        productId: i.productId,
        name: i.name,
        qty: i.qty,
        unit: i.unit,
        monthlyInr: i.monthlyInr,
        setupInr: i.setupInr,
        kind: i.kind,
        why: session.whys[i.productId] ?? "",
      })),
      unavailable: rec.quote.unavailable,
      whySource: session.whySource,
    };
  }
}

function toCard(v: ProductVerdict): ProductCard {
  return {
    productId: v.productId,
    name: v.name,
    description: v.description,
    unit: v.unit,
    unitPriceInr: v.unitPriceInr,
    setupInr: v.setupInr,
    eligible: v.eligible,
    violations: v.violations,
    inBundle: v.inBundle,
    addOn: v.addOn,
  };
}

/** Validate a quick-reply choice from the client (values are re-validated by applyUpdates). */
export function parseChoice(raw: unknown): Choice | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { slot, value } = raw as Record<string, unknown>;
  if (slot === "action") {
    return value === "human" || value === "not_interested" || value === "restart" ? { slot, value } : null;
  }
  if (typeof slot !== "string" || !(SLOTS as readonly string[]).includes(slot)) return null;
  const ok =
    typeof value === "string"
      ? value.length <= 60
      : typeof value === "number"
        ? Number.isFinite(value)
        : Array.isArray(value) && value.length <= 4 && value.every((v) => typeof v === "string" && v.length <= 20);
  return ok ? { slot: slot as Slot, value } : null;
}
