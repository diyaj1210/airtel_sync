import type { AdvisorEngine, AdvisorReply, Choice, RecommendationView } from "../advisor/engine.js";
import { LEAD_REASONS, type LeadReason, type LeadStore } from "../advisor/leads.js";
import { MAX_TURNS, type AdvisorSession, type AdvisorSessionStore } from "../advisor/sessions.js";
import type { Lang } from "../advisor/text.js";
import { attributionStaff } from "../backoffice/staff.js";
import type { Catalogue } from "../catalogue/catalogue.js";
import type { KycIssue } from "../kyc/checks.js";
import { DOC_TYPES, DocumentReadError, type DocType, type DocumentReader } from "../kyc/documents.js";
import { startEsign, verifyEsign } from "../kyc/esign.js";
import { checkGstin, maskGstin } from "../kyc/identifiers.js";
import type { Registries } from "../kyc/registry.js";
import { evaluateCase, type CaseEvaluation } from "../kyc/review.js";
import { parseBusiness } from "../kyc/routes.js";
import type { SampleApplicant } from "../kyc/samples.js";
import type { KycCase, KycCaseStore } from "../kyc/store.js";
import { agreementFor, blockedProducts } from "../kyc/view.js";
import type { Logger } from "../logger.js";
import { checkout } from "../orders/checkout.js";
import type { Order, OrderStore } from "../orders/store.js";
import { currentStageIndex, nextStage } from "../orders/tracker.js";
import { buildQuote } from "../quote/quote.js";
import type { QuoteStore } from "../quote/store.js";
import { formatDate, formatInr, hasText, wa, type ChannelKey } from "./text.js";

/**
 * WhatsApp channel (step 8; solution_outline_chat/02-whatsapp-voice.md). MOCK WhatsApp Business
 * API: in production Meta posts each customer message to a webhook and the bot answers through
 * the send API; here the simulator in the app posts the messages and shows the answers.
 *
 * The bot only moves the conversation along. Every decision is made by the same code the app
 * uses: the advisor engine (and so the rules engine) for the bundle, buildQuote for the price,
 * parseBusiness / evaluateCase for KYC, verifyEsign for the MOCK e-sign, checkout() and the order
 * store for the MOCK payment and the tracker. Nothing is decided here.
 *
 * One conversation per phone number, in memory, deleted after 24 hours without a message (the
 * WhatsApp customer-care window) or when the owner types "stop".
 */

export interface WaButton {
  id: string;
  title: string;
}

export interface WaMessage {
  id: number;
  text: string;
  /** Reply buttons (WhatsApp allows at most 3). */
  buttons?: WaButton[];
  /** A list message (at most 10 rows), opened with the `button` label. */
  list?: { button: string; rows: WaButton[] };
  /** DEMO aid for the simulator: the document the bot is waiting for a photo of. */
  expectsPhoto?: DocType;
}

export type WaInput =
  | { type: "text"; text: string; voice?: boolean }
  | { type: "button"; id: string }
  | { type: "image"; bytes: Uint8Array<ArrayBuffer>; contentType: string };

type Step = "language" | "advisor" | "handoff" | "why_not" | "consent" | "name" | "gstin" | "udyam" | "docs" | "review" | "esign" | "pay" | "order";

export interface Conversation {
  phone: string;
  lang: Lang;
  step: Step;
  /** Step to return to after a call-back question. */
  resume: Step;
  attributionCode: string | null;
  advisorSessionId: string | null;
  quickReplies: Choice[];
  recommendation: RecommendationView | null;
  quoteId: string | null;
  caseId: string | null;
  orderId: string | null;
  draft: { applicantName?: string; gstin?: string | null };
  expectsDoc: DocType | null;
  /** The last question's buttons / list, shown again when an answer is not understood. */
  lastPrompt: Omit<WaMessage, "id" | "text"> | null;
  nextId: number;
  lastSeenMs: number;
  busy: boolean;
}

export interface WhatsAppDeps {
  engine: AdvisorEngine;
  advisorSessions: AdvisorSessionStore;
  leadStore: LeadStore;
  catalogue: Catalogue;
  quoteStore: QuoteStore;
  kycStore: KycCaseStore;
  registries: Registries;
  samples: SampleApplicant[];
  reader: DocumentReader;
  orderStore: OrderStore;
  today: () => string;
  nowMs: () => number;
  logger: Logger;
}

export const IDLE_MS = 24 * 60 * 60 * 1000;
export const MAX_CONVERSATIONS = 500;
const TITLE_MAX = 24;
const REF_RE = /\b(PTR|SLS)-\d{2}\b/i;
const OTP_RE = /^\d{6}$/;
const WHY_NOT: LeadReason[] = LEAD_REASONS.filter((r) => r !== "asked_for_human" && r !== "advisor_could_not_understand");

const COMMANDS: Record<string, readonly string[]> = {
  stop: ["stop", "delete", "delete my data", "रोकें", "रोको", "बंद करें"],
  help: ["help", "menu", "मदद", "सहायता"],
  status: ["status", "track", "स्थिति", "ट्रैक"],
  restart: ["restart", "start again", "start over", "फिर से", "फिर से शुरू"],
  person: ["person", "human", "agent", "call me", "व्यक्ति", "इंसान"],
  buy: ["buy", "ख़रीदें", "खरीदें"],
  en: ["english", "अंग्रेज़ी", "अंग्रेजी"],
  hi: ["hindi", "हिंदी", "हिन्दी"],
};
const commandOf = (text: string) => {
  const t = text.trim().toLowerCase().replace(/[.!?।]+$/, "");
  return Object.entries(COMMANDS).find(([, words]) => words.includes(t))?.[0] ?? null;
};

const title = (s: string) => (s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX - 1)}…` : s);

export class WhatsAppBot {
  private readonly conversations = new Map<string, Conversation>();

  constructor(private readonly d: WhatsAppDeps) {}

  get size(): number {
    return this.conversations.size;
  }

  conversation(phone: string): Conversation | undefined {
    return this.conversations.get(phone);
  }

  /** Handle one incoming message; returns the bot's replies. null while the previous one is still being handled. */
  async receive(phone: string, input: WaInput): Promise<WaMessage[] | null> {
    this.sweep();
    let conv = this.conversations.get(phone);
    const isNew = !conv;
    if (!conv) conv = this.create(phone);
    if (conv.busy) return null;
    conv.busy = true;
    conv.lastSeenMs = this.d.nowMs();
    try {
      const out = isNew ? this.welcome(conv, input) : await this.route(conv, input);
      this.d.logger.info("whatsapp message (MOCK)", { kind: input.type, voice: input.type === "text" && !!input.voice, step: conv.step, replies: out.length });
      return out.map((m) => ({ id: conv.nextId++, ...m }));
    } finally {
      conv.busy = false;
    }
  }

  // ---------------------------------------------------------------- dispatch

  private async route(c: Conversation, input: WaInput): Promise<Omit<WaMessage, "id">[]> {
    if (input.type === "image") return this.photo(c, input);
    if (input.type === "button") return this.button(c, input.id);
    const text = input.text.trim();
    const command = commandOf(text);
    if (command === "stop") return this.stop(c);
    if (command === "help") return [{ text: this.t(c, "help") }];
    if (command === "en" || command === "hi") {
      c.lang = command;
      const out: Omit<WaMessage, "id">[] = [{ text: this.t(c, "langChanged") }];
      if (c.step === "language") out.push(...(await this.startAdvisor(c)));
      return out;
    }
    if (command === "status") return this.status(c);
    if (command === "person") return this.askHandoff(c);
    if (command === "restart") return [{ text: this.t(c, "restart") }, ...(await this.startAdvisor(c, true))];
    if (command === "buy" && c.recommendation && !c.caseId) return this.buy(c);

    switch (c.step) {
      case "language":
        return this.welcome(c, input);
      case "advisor":
        return this.advise(c, { text });
      case "name":
        return this.name(c, text);
      case "gstin":
        return this.gstin(c, text);
      case "esign":
        if (OTP_RE.test(text)) return this.sign(c, text);
        return this.notUnderstood(c);
      default:
        return this.notUnderstood(c);
    }
  }

  private async button(c: Conversation, id: string): Promise<Omit<WaMessage, "id">[]> {
    const [kind, value = ""] = id.split(":", 2) as [string, string?];
    switch (kind) {
      case "lang":
        if (value !== "en" && value !== "hi") break;
        c.lang = value;
        return this.startAdvisor(c);
      case "qr": {
        const choice = c.step === "advisor" ? c.quickReplies[Number(value)] : undefined;
        return choice ? this.advise(c, { choice }) : this.notUnderstood(c);
      }
      case "buy":
        return c.recommendation && !c.caseId ? this.buy(c) : this.status(c);
      case "human":
        return this.askHandoff(c);
      case "handoff":
        return c.step === "handoff" ? this.handoff(c, value === "yes") : this.notUnderstood(c);
      case "notforme":
        return this.whyNotPrompt(c);
      case "why":
        return c.step === "why_not" && (WHY_NOT as string[]).includes(value) ? this.whyNot(c, value as LeadReason) : this.notUnderstood(c);
      case "consent":
        return c.step === "consent" ? this.consent(c, value === "yes") : this.notUnderstood(c);
      case "sample":
        return c.step === "name" || c.step === "gstin" || c.step === "udyam" ? this.sample(c, value) : this.notUnderstood(c);
      case "gstin":
        return c.step === "gstin" && value === "none" ? this.gstinDone(c, null) : this.notUnderstood(c);
      case "udyam":
        return c.step === "udyam" && (value === "yes" || value === "no") ? this.udyam(c, value === "yes") : this.notUnderstood(c);
      case "nodoc":
      case "check":
        return c.step === "docs" ? this.submit(c) : this.notUnderstood(c);
      case "newcode":
        return c.step === "esign" ? this.esignStart(c) : this.notUnderstood(c);
      case "pay":
        return c.step === "pay" ? this.pay(c) : this.status(c);
      case "status":
        return this.status(c);
      case "advance":
        return this.advance(c);
    }
    return this.notUnderstood(c);
  }

  // ---------------------------------------------------------------- language + advisor

  private welcome(c: Conversation, input: WaInput): Omit<WaMessage, "id">[] {
    const ref = input.type === "text" ? REF_RE.exec(input.text)?.[0] : undefined;
    const staff = ref ? attributionStaff(ref) : undefined;
    if (staff) c.attributionCode = staff.code;
    const lines = [wa("en", "welcome"), ...(staff ? [wa(c.lang, "referred", { name: staff.name })] : []), `_${wa(c.lang, "mock")}_`];
    return [this.prompt(c, { text: lines.join("\n\n"), buttons: [{ id: "lang:en", title: "English" }, { id: "lang:hi", title: "हिंदी" }] })];
  }

  private session(c: Conversation): AdvisorSession {
    const existing = c.advisorSessionId ? this.d.advisorSessions.get(c.advisorSessionId) : undefined;
    if (existing) return existing;
    const s = this.d.advisorSessions.create(c.lang, c.attributionCode);
    c.advisorSessionId = s.id;
    return s;
  }

  private async startAdvisor(c: Conversation, fresh = false): Promise<Omit<WaMessage, "id">[]> {
    if (fresh) {
      c.advisorSessionId = null;
      c.recommendation = null;
      c.quoteId = c.caseId ? c.quoteId : null;
    }
    const session = this.session(c);
    c.step = "advisor";
    return [{ text: this.t(c, "help") }, ...this.advisorReply(c, await this.d.engine.start(session))];
  }

  private async advise(c: Conversation, input: { text?: string; choice?: Choice }): Promise<Omit<WaMessage, "id">[]> {
    const session = c.advisorSessionId ? this.d.advisorSessions.get(c.advisorSessionId) : undefined;
    // An expired chat, or one at the advisor's message limit, starts again.
    if (!session || session.turns >= MAX_TURNS) return [{ text: this.t(c, "restart") }, ...(await this.startAdvisor(c, true))];
    this.d.advisorSessions.touch(session);
    return this.advisorReply(c, await this.d.engine.handle(session, { lang: c.lang, ...input }));
  }

  private advisorReply(c: Conversation, reply: AdvisorReply): Omit<WaMessage, "id">[] {
    const out: Omit<WaMessage, "id">[] = reply.messages.map((m) => ({
      text: [
        m.text,
        ...(m.products ?? []).map((p) => `• ${p.name}: ${formatInr(p.unitPriceInr)}/${p.unit}${p.eligible === false ? " ✗" : ""}`),
      ].join("\n"),
    }));
    c.quickReplies = [];
    if (reply.recommendation) {
      const r = reply.recommendation;
      c.recommendation = r;
      out.push(
        this.prompt(c, {
          text: this.t(c, "rec", {
            name: r.name,
            items: r.items.map((i) => this.t(c, "recItem", { name: i.name, qty: i.qty, monthly: formatInr(i.monthlyInr) })).join("\n"),
            monthly: formatInr(r.totals.monthlyInr),
            setup: formatInr(r.totals.setupInr),
            months: r.totals.contractMonths,
            days: r.totals.installDays,
          }),
          buttons: [
            { id: "buy", title: this.t(c, "buy") },
            { id: "human", title: title(this.t(c, "human")) },
            { id: "notforme", title: this.t(c, "notForMe") },
          ],
        }),
      );
    } else if (reply.quickReplies.length > 0) {
      c.quickReplies = reply.quickReplies.map((q) => q.choice);
      const rows = reply.quickReplies.slice(0, 10).map((q, i) => ({ id: `qr:${i}`, title: title(q.label) }));
      const last = out.pop() ?? { text: this.t(c, "pickOne") };
      const text = reply.multiSelect ? `${last.text}\n\n${this.t(c, "multiHint")}` : last.text;
      out.push(this.prompt(c, rows.length <= 3 ? { text, buttons: rows } : { text, list: { button: this.t(c, "options"), rows } }));
    }
    if (reply.action === "handoff") out.push(...this.askHandoff(c));
    if (reply.action === "not_interested") out.push(...this.whyNotPrompt(c));
    return out;
  }

  private whyNotPrompt(c: Conversation): Omit<WaMessage, "id">[] {
    c.resume = c.step === "handoff" || c.step === "why_not" ? c.resume : c.step;
    c.step = "why_not";
    return [this.prompt(c, { text: this.t(c, "whyNot"), list: { button: this.t(c, "options"), rows: WHY_NOT.map((r) => ({ id: `why:${r}`, title: this.t(c, `reason.${r}` as ChannelKey) })) } })];
  }

  private askHandoff(c: Conversation): Omit<WaMessage, "id">[] {
    if (c.step !== "handoff") c.resume = c.step === "why_not" ? c.resume : c.step;
    c.step = "handoff";
    return [this.prompt(c, { text: this.t(c, "handoffAsk"), buttons: [{ id: "handoff:yes", title: this.t(c, "handoffYes") }, { id: "handoff:no", title: this.t(c, "handoffNo") }] })];
  }

  /** A call back on the WhatsApp number, only with the owner's yes (same lead store as the app). */
  private handoff(c: Conversation, yes: boolean): Omit<WaMessage, "id">[] {
    c.step = c.resume === "language" ? "advisor" : c.resume;
    if (!yes) return [{ text: this.t(c, "handoffCancelled") }];
    const { lead } = this.d.leadStore.save(this.session(c), { reason: "asked_for_human", note: null, phone: c.phone, callbackConsent: true });
    return [{ text: this.t(c, "handoffDone", { id: lead.leadId }) }];
  }

  private whyNot(c: Conversation, reason: LeadReason): Omit<WaMessage, "id">[] {
    c.step = c.resume === "language" ? "advisor" : c.resume;
    const { lead } = this.d.leadStore.save(this.session(c), { reason, note: null, phone: null, callbackConsent: false });
    return [{ text: this.t(c, "whyNotDone", { id: lead.leadId }) }];
  }

  // ---------------------------------------------------------------- quote + consent + KYC details

  private buy(c: Conversation): Omit<WaMessage, "id">[] {
    const rec = c.recommendation!;
    // The price is computed again by the quote engine; the recommendation card is never trusted.
    const quote = this.d.quoteStore.accept(rec.quoteRequest, buildQuote(this.d.catalogue, rec.quoteRequest), c.attributionCode);
    c.quoteId = quote.quoteId;
    c.step = "consent";
    const t = (k: ChannelKey) => this.t(c, k);
    return [
      { text: this.t(c, "quoteAccepted", { id: quote.quoteId, monthly: formatInr(quote.quote.totals.monthlyInr), setup: formatInr(quote.quote.totals.setupInr), validUntil: formatDate(quote.validUntil, c.lang) }) },
      {
        text: [
          t("consentTitle"),
          `*${t("kyc.consent.whatTitle")}:* ${t("kyc.consent.what")}`,
          `*${t("kyc.consent.whyTitle")}:* ${t("kyc.consent.why")}`,
          `*${t("kyc.consent.howTitle")}:* ${t("kyc.consent.how")}`,
          `*${t("kyc.consent.keepTitle")}:* ${t("kyc.consent.keep")}`,
          t("consentWithdraw"),
        ].join("\n\n"),
      },
      this.prompt(c, { text: t("consentAsk"), buttons: [{ id: "consent:yes", title: t("agree") }, { id: "consent:no", title: t("notNow") }] }),
    ];
  }

  private consent(c: Conversation, yes: boolean): Omit<WaMessage, "id">[] {
    if (!yes) {
      c.step = "advisor";
      return [{ text: this.t(c, "consentDeclined") }];
    }
    const quote = c.quoteId ? this.d.quoteStore.get(c.quoteId) : undefined;
    // Same as the app: the case keeps the code of the partner who referred the quote.
    const kycCase = this.d.kycStore.create(c.lang, quote?.quoteId ?? null, c.attributionCode ?? quote?.attributionCode ?? null);
    c.caseId = kycCase.caseId;
    this.d.logger.info("kyc consent given", { caseId: kycCase.caseId, channel: "whatsapp" });
    return this.askName(c);
  }

  private askName(c: Conversation): Omit<WaMessage, "id">[] {
    c.step = "name";
    return [
      this.prompt(c, {
        text: `${this.t(c, "askName")}\n\n_${this.t(c, "demoPick")}_`,
        list: { button: this.t(c, "demoSample"), rows: this.d.samples.map((s) => ({ id: `sample:${s.id}`, title: `${s.id} ${title(s.applicantName)}` })) },
      }),
    ];
  }

  private name(c: Conversation, text: string): Omit<WaMessage, "id">[] {
    const parsed = parseBusiness({ applicantName: text, gstin: null, hasUdyam: false });
    if (!parsed.ok) return [this.prompt(c, { text: this.t(c, "nameInvalid") })];
    c.draft = { applicantName: parsed.value.applicantName };
    c.step = "gstin";
    return [this.prompt(c, { text: this.t(c, "askGstin"), buttons: [{ id: "gstin:none", title: this.t(c, "noGstin") }] })];
  }

  private gstin(c: Conversation, text: string): Omit<WaMessage, "id">[] {
    const checked = checkGstin(text);
    if (!checked.ok) {
      const key = `gstinProblem.${checked.problem}`;
      return [this.prompt(c, { text: this.t(c, "gstinInvalid", { problem: hasText(c.lang, key) ? this.t(c, key) : checked.problem }), buttons: [{ id: "gstin:none", title: this.t(c, "noGstin") }] })];
    }
    return this.gstinDone(c, checked.value);
  }

  private gstinDone(c: Conversation, gstin: string | null): Omit<WaMessage, "id">[] {
    c.draft.gstin = gstin;
    c.step = "udyam";
    return [this.prompt(c, { text: this.t(c, "askUdyam"), buttons: [{ id: "udyam:yes", title: this.t(c, "yes") }, { id: "udyam:no", title: this.t(c, "no") }] })];
  }

  private udyam(c: Conversation, hasUdyam: boolean): Omit<WaMessage, "id">[] {
    const k = this.kycCase(c);
    if (!k) return this.status(c);
    const parsed = parseBusiness({ applicantName: c.draft.applicantName, gstin: c.draft.gstin ?? null, hasUdyam, udyamNumber: null });
    if (!parsed.ok) return this.askName(c);
    k.business = parsed.value;
    k.sampleId = null;
    return this.afterBusiness(c, k);
  }

  /** DEMO: a sample applicant K01-K12 (same as the app's DEMO box). */
  private sample(c: Conversation, id: string): Omit<WaMessage, "id">[] {
    const k = this.kycCase(c);
    const s = this.d.samples.find((x) => x.id === id);
    if (!k || !s) return this.notUnderstood(c);
    k.business = { applicantName: s.applicantName, gstin: s.gstin, hasUdyam: s.hasUdyam, udyamNumber: null };
    k.sampleId = s.id;
    return this.afterBusiness(c, k);
  }

  private afterBusiness(c: Conversation, k: KycCase): Omit<WaMessage, "id">[] {
    const gst = this.evaluate(k).registry.gst;
    const lookup = gst
      ? this.t(c, "registry", { name: gst.legalName, gstin: maskGstin(gst.gstin), status: this.t(c, `kyc.gstStatus.${gst.status}` as ChannelKey) })
      : this.t(c, "registryNone");
    return [{ text: lookup }, ...this.nextDocument(c, k)];
  }

  // ---------------------------------------------------------------- documents + result

  private nextDocument(c: Conversation, k: KycCase): Omit<WaMessage, "id">[] {
    const ev = this.evaluate(k);
    const doc = DOC_TYPES.find((d) => ev.documents[d].need === "required" && !k.documents[d]);
    if (!doc) return this.submit(c);
    return [this.askDoc(c, doc)];
  }

  private askDoc(c: Conversation, doc: DocType, extra = ""): Omit<WaMessage, "id"> {
    c.step = "docs";
    c.expectsDoc = doc;
    const text = `${extra ? `${extra}\n\n` : ""}${this.t(c, "askDoc", { doc: this.t(c, `kyc.doc.${doc}` as ChannelKey) })}`;
    return this.prompt(c, { text, expectsPhoto: doc, buttons: [{ id: "nodoc", title: this.t(c, "noDoc") }] });
  }

  private async photo(c: Conversation, input: Extract<WaInput, { type: "image" }>): Promise<Omit<WaMessage, "id">[]> {
    const k = this.kycCase(c);
    const doc = c.expectsDoc;
    if (c.step !== "docs" || !k || !doc || k.esign?.signed) return [{ text: this.t(c, "photoNotNow") }];
    const docName = this.t(c, `kyc.doc.${doc}` as ChannelKey);
    try {
      const reading = await this.d.reader.read(input.bytes, input.contentType, doc);
      if (!this.d.kycStore.get(k.caseId)) return [{ text: this.t(c, "stopped") }];
      k.documents[doc] = reading;
      this.d.logger.info("kyc document read", { caseId: k.caseId, docType: doc, readable: reading.readable, channel: "whatsapp" });
      if (!reading.readable) return [this.askDoc(c, doc, this.t(c, "docUnreadable", { doc: docName }))];
      if (k.submitted) return [{ text: this.t(c, "docRead", { doc: docName }) }, ...this.submit(c)];
      return [{ text: this.t(c, "docRead", { doc: docName }) }, ...this.nextDocument(c, k)];
    } catch (err) {
      if (!(err instanceof DocumentReadError)) throw err;
      this.d.logger.warn("kyc document not read", { caseId: k.caseId, docType: doc, reason: err.kind, channel: "whatsapp" });
      return [this.prompt(c, { text: this.t(c, err.kind === "unavailable" ? "ocrDown" : "docNotImage"), expectsPhoto: doc, buttons: [{ id: "nodoc", title: this.t(c, "noDoc") }] })];
    }
  }

  private submit(c: Conversation): Omit<WaMessage, "id">[] {
    const k = this.kycCase(c);
    if (!k || !k.business) return this.status(c);
    k.submitted = true;
    const ev = this.evaluate(k);
    this.d.logger.info("kyc checked", { caseId: k.caseId, status: ev.status, issues: ev.issues.map((i) => i.code), channel: "whatsapp" });
    return [{ text: this.t(c, "checking") }, ...this.result(c, k, ev)];
  }

  private issueLines(c: Conversation, issues: KycIssue[]): string {
    return issues.map((i) => `• ${this.issueText(c, i)}`).join("\n");
  }

  private result(c: Conversation, k: KycCase, ev: CaseEvaluation): Omit<WaMessage, "id">[] {
    const fixes = ev.issues.filter((i) => i.severity === "fix");
    const reviews = ev.issues.filter((i) => i.severity === "review");
    const head = (s: "pass" | "fix_needed" | "manual_review" | "rejected") => `*${this.t(c, `kyc.result.${s}`)}*\n${this.t(c, `kyc.result.${s}.body`)}`;
    const blocked = blockedProducts(ev, k.quoteId ? this.d.quoteStore.get(k.quoteId) : undefined, this.d.catalogue);
    const blockedLine = blocked.length > 0 ? [this.t(c, "kyc.result.blocked", { products: blocked.map((p) => p.name).join(", ") })] : [];
    switch (ev.status) {
      case "pass":
        return [{ text: [head("pass"), ...blockedLine].join("\n\n") }, ...this.esignStart(c)];
      case "manual_review":
        c.step = "review";
        return [this.prompt(c, { text: [head("manual_review"), `${this.t(c, "teamChecks")}\n${this.issueLines(c, reviews)}`, ...blockedLine, this.t(c, "review")].join("\n\n"), buttons: [{ id: "status", title: this.t(c, "statusButton") }] })];
      case "rejected":
        c.step = "review";
        return [
          this.prompt(c, {
            text: [head("rejected"), ...(ev.review?.note ? [this.t(c, "kyc.result.reviewNote", { note: ev.review.note })] : [])].join("\n\n"),
            buttons: [{ id: "human", title: title(this.t(c, "human")) }, { id: "status", title: this.t(c, "statusButton") }],
          }),
        ];
      default: {
        // Fix needed: say what to do, and wait for the photo of the first document to fix.
        const text = [head("fix_needed"), `${this.t(c, "whatToDo")}\n${this.issueLines(c, fixes)}`, ...(reviews.length ? [`${this.t(c, "teamChecks")}\n${this.issueLines(c, reviews)}`] : [])].join("\n\n");
        const doc = fixes.find((i) => i.doc)?.doc ?? null;
        c.step = "docs";
        c.expectsDoc = doc;
        return [this.prompt(c, { text, ...(doc ? { expectsPhoto: doc } : {}), buttons: [{ id: "check", title: this.t(c, "checkAgain") }] })];
      }
    }
  }

  private issueText(c: Conversation, issue: KycIssue): string {
    const vars: Record<string, string | number> = {};
    const opt = (key: string, fallback: string) => (hasText(c.lang, key) ? this.t(c, key) : fallback);
    if (issue.doc) vars.doc = this.t(c, `kyc.doc.${issue.doc}` as ChannelKey);
    for (const [name, value] of Object.entries(issue.params)) {
      if (typeof value === "number") vars[name] = value;
      else if (typeof value === "string") {
        if (name === "detected") vars.detected = opt(`kyc.doc.${value}`, value);
        else if (name === "field") vars.field = opt(`kyc.fieldName.${value}`, value);
        else if (name === "status") vars.status = opt(`kyc.gstStatus.${value}`, value);
        else vars[name] = /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value, c.lang) : value;
      }
    }
    let key = `kyc.issue.${issue.code}`;
    if (issue.code === "DOC_MISSING" && issue.params.orNumber === true) key += ".orNumber";
    if (issue.code === "CERT_GSTIN_MISMATCH" && issue.params.checksumValid === false) key += ".invalid";
    return hasText(c.lang, key) ? this.t(c, key, vars) : issue.code;
  }

  // ---------------------------------------------------------------- MOCK e-sign, MOCK payment, tracker

  private esignStart(c: Conversation): Omit<WaMessage, "id">[] {
    const k = this.kycCase(c);
    if (!k) return this.status(c);
    const ev = this.evaluate(k);
    if (!k.submitted || ev.status !== "pass" || k.esign?.signed) return this.status(c);
    k.esign = startEsign(this.d.nowMs());
    const quote = k.quoteId ? this.d.quoteStore.get(k.quoteId) : undefined;
    const a = agreementFor(k, ev, quote, this.d.today());
    c.step = "esign";
    return [
      this.prompt(c, {
        text: this.t(c, "esign", {
          business: a.business,
          bundle: a.quote?.bundle ?? "",
          monthly: formatInr(a.quote?.monthlyInr ?? 0),
          setup: formatInr(a.quote?.setupInr ?? 0),
          months: a.quote?.contractMonths ?? 0,
          otp: k.esign.otp,
        }),
        buttons: [{ id: "newcode", title: this.t(c, "newCode") }],
      }),
    ];
  }

  private sign(c: Conversation, otp: string): Omit<WaMessage, "id">[] {
    const k = this.kycCase(c);
    if (!k?.esign) return this.status(c);
    const quote = k.quoteId ? this.d.quoteStore.get(k.quoteId) : undefined;
    const outcome = verifyEsign(k.esign, otp, agreementFor(k, this.evaluate(k), quote, this.d.today()), this.d.nowMs(), this.d.today());
    if (!outcome.ok) {
      if (outcome.error === "wrong_otp") return [this.prompt(c, { text: this.t(c, "esignWrong", { left: outcome.attemptsLeft }), buttons: [{ id: "newcode", title: this.t(c, "newCode") }] })];
      return [this.prompt(c, { text: this.t(c, "esignExpired"), buttons: [{ id: "newcode", title: this.t(c, "newCode") }] })];
    }
    this.d.logger.info("kyc e-signed (MOCK)", { caseId: k.caseId, channel: "whatsapp" });
    return [{ text: this.t(c, "signed", { ref: outcome.state.signed!.reference }) }, ...this.payPrompt(c, k)];
  }

  private checkoutFor(k: KycCase) {
    const quote = k.quoteId ? this.d.quoteStore.get(k.quoteId) : undefined;
    return { quote, result: checkout(k, this.evaluate(k), quote, this.d.catalogue, this.d.today(), this.d.orderStore.forCase(k.caseId)?.orderId ?? null) };
  }

  private payPrompt(c: Conversation, k: KycCase): Omit<WaMessage, "id">[] {
    const { result } = this.checkoutFor(k);
    if (!result.canPay) {
      c.step = "pay";
      return [{ text: this.t(c, `pay.block.${result.block}` as ChannelKey, { products: result.blockedProducts.map((p) => p.name).join(", ") }) }];
    }
    c.step = "pay";
    return [
      this.prompt(c, {
        text: this.t(c, "pay", { total: formatInr(result.dueNowInr), setup: formatInr(result.setupInr), monthly: formatInr(result.monthlyInr) }),
        buttons: [{ id: "pay", title: this.t(c, "payButton") }],
      }),
    ];
  }

  private pay(c: Conversation): Omit<WaMessage, "id">[] {
    const k = this.kycCase(c);
    if (!k) return this.status(c);
    const { quote, result } = this.checkoutFor(k);
    if (!result.canPay || !quote) return this.payPrompt(c, k);
    const order = this.d.orderStore.place({
      caseId: k.caseId,
      quoteId: quote.quoteId,
      quote: quote.quote,
      method: "upi",
      placedOn: this.d.today(),
      kycVerifiedOn: k.esign!.signed!.signedOn,
      attributionCode: k.attributionCode ?? quote.attributionCode,
    });
    this.d.logger.info("order placed (MOCK payment)", { orderId: order.orderId, caseId: k.caseId, method: "upi", totalInr: order.payment.totalInr, channel: "whatsapp" });
    c.orderId = order.orderId;
    c.step = "order";
    return [{ text: this.t(c, "paid", { ref: order.payment.reference, id: order.orderId, readyOn: formatDate(order.readyOn, c.lang) }) }, this.tracker(c, order)];
  }

  private tracker(c: Conversation, order: Order): Omit<WaMessage, "id"> {
    const now = order.stages[currentStageIndex(order.stages)]!;
    const next = nextStage(order.stages);
    const stage = (s: string) => this.t(c, `track.stage.${s}` as ChannelKey);
    const text = [
      this.t(c, "trackerTitle", { id: order.orderId, readyOn: formatDate(order.readyOn, c.lang) }),
      this.t(c, "trackerNow", { stage: stage(now.stage) }),
      next ? this.t(c, "trackerNext", { stage: stage(next.stage), date: formatDate(next.expectedOn, c.lang) }) : this.t(c, "trackerDone"),
      order.lines.map((l) => this.t(c, "trackerLine", { name: l.name, date: formatDate(l.expectedOn, c.lang) })).join("\n"),
    ].join("\n");
    return this.prompt(c, { text, buttons: [{ id: "status", title: this.t(c, "statusButton") }, ...(next ? [{ id: "advance", title: this.t(c, "advance") }] : [])] });
  }

  private advance(c: Conversation): Omit<WaMessage, "id">[] {
    const order = c.orderId ? this.d.orderStore.get(c.orderId) : undefined;
    if (!order) return this.status(c);
    if (this.d.orderStore.advance(order)) this.d.logger.info("order stage (MOCK)", { orderId: order.orderId, stage: order.stages[currentStageIndex(order.stages)]!.stage, channel: "whatsapp" });
    return [this.tracker(c, order)];
  }

  // ---------------------------------------------------------------- status, stop, helpers

  /** "status" at any time: the order, else the KYC, else the quote. A reviewer's decision is picked up here. */
  private status(c: Conversation): Omit<WaMessage, "id">[] {
    const order = c.orderId ? this.d.orderStore.get(c.orderId) : undefined;
    if (order) return [this.tracker(c, order)];
    const k = this.kycCase(c);
    if (k) {
      if (!k.business) return this.askName(c);
      const ev = this.evaluate(k);
      if (k.esign?.signed) return this.payPrompt(c, k);
      if (k.submitted) return this.result(c, k, ev);
      return this.nextDocument(c, k);
    }
    const quote = c.quoteId ? this.d.quoteStore.get(c.quoteId) : undefined;
    if (quote) return [{ text: this.t(c, "statusQuote", { id: quote.quoteId, monthly: formatInr(quote.quote.totals.monthlyInr) }), buttons: [{ id: "buy", title: this.t(c, "buy") }] }];
    return [{ text: this.t(c, "statusNothing") }];
  }

  /** "stop": consent withdrawn. The KYC case and everything in it is deleted, and so is the chat. */
  private stop(c: Conversation): Omit<WaMessage, "id">[] {
    if (c.caseId && this.d.kycStore.delete(c.caseId)) this.d.logger.info("kyc consent withdrawn, case deleted", { caseId: c.caseId, channel: "whatsapp" });
    this.conversations.delete(c.phone);
    return [{ text: c.orderId ? `${this.t(c, "stopped")}\n${this.t(c, "stoppedOrder", { id: c.orderId })}` : this.t(c, "stopped") }];
  }

  private notUnderstood(c: Conversation): Omit<WaMessage, "id">[] {
    return [{ text: this.t(c, "notUnderstood"), ...(c.lastPrompt ?? {}) }];
  }

  /** A message that asks something: remembered so it can be shown again. */
  private prompt(c: Conversation, m: Omit<WaMessage, "id">): Omit<WaMessage, "id"> {
    const { text: _text, ...rest } = m;
    c.lastPrompt = rest.buttons || rest.list || rest.expectsPhoto ? rest : null;
    return m;
  }

  private kycCase(c: Conversation): KycCase | undefined {
    const k = c.caseId ? this.d.kycStore.get(c.caseId) : undefined;
    if (c.caseId && !k) c.caseId = null; // withdrawn in the app
    return k;
  }

  private evaluate(k: KycCase): CaseEvaluation {
    return evaluateCase(k, this.d.registries, this.d.today());
  }

  private t(c: Conversation, key: string, vars?: Record<string, string | number>): string {
    return wa(c.lang, key as ChannelKey, vars);
  }

  private create(phone: string): Conversation {
    while (this.conversations.size >= MAX_CONVERSATIONS) this.conversations.delete(this.conversations.keys().next().value!);
    const conv: Conversation = {
      phone,
      lang: "en",
      step: "language",
      resume: "advisor",
      attributionCode: null,
      advisorSessionId: null,
      quickReplies: [],
      recommendation: null,
      quoteId: null,
      caseId: null,
      orderId: null,
      draft: {},
      expectsDoc: null,
      lastPrompt: null,
      nextId: 1,
      lastSeenMs: this.d.nowMs(),
      busy: false,
    };
    this.conversations.set(phone, conv);
    return conv;
  }

  private sweep(): void {
    const now = this.d.nowMs();
    for (const [phone, conv] of this.conversations) if (now - conv.lastSeenMs > IDLE_MS && !conv.busy) this.conversations.delete(phone);
  }
}
