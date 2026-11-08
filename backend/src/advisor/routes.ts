import { Router } from "express";
import { parseAttribution } from "../backoffice/staff.js";
import { maskIdentifiers } from "../masking.js";
import { AdvisorEngine, MAX_MESSAGE_CHARS, parseChoice, type AdvisorInput } from "./engine.js";
import { LEAD_REASONS, leadView, MAX_NOTE, parseIndianMobile, type LeadReason, type LeadStore } from "./leads.js";
import { AdvisorSessionStore, MAX_TURNS, SESSION_ID_RE } from "./sessions.js";
import { ADVISOR_LANGS, type Lang } from "./text.js";

/**
 *   GET  /api/advisor/status                    is the AI helper on? (provider + model, never the key)
 *   POST /api/advisor/sessions                  { lang, attributionCode? } -> new chat: greeting + first question
 *   POST /api/advisor/sessions/:id/messages     { lang, text } or { lang, choice } -> advisor reply
 *   POST /api/advisor/sessions/:id/lead         { reason, phone?, callbackConsent?, note? } -> lead for the back-office
 * The leads are listed only in the back-office, behind the staff sign-in (GET /api/backoffice/leads).
 */
export function advisorRouter(engine: AdvisorEngine, sessions: AdvisorSessionStore, leads: LeadStore, llmStatus: () => Promise<unknown>): Router {
  const router = Router();
  const isLang = (v: unknown): v is Lang => (ADVISOR_LANGS as readonly unknown[]).includes(v);
  const body = (b: unknown) => (typeof b === "object" && b !== null && !Array.isArray(b) ? (b as Record<string, unknown>) : null);

  router.get("/advisor/status", async (_req, res) => {
    res.json(await llmStatus());
  });

  router.post("/advisor/sessions", async (req, res) => {
    const b = body(req.body) ?? {};
    const lang = b.lang ?? "en";
    if (!isLang(lang)) return void res.status(400).json({ error: "invalid_request", details: ["lang must be en or hi"] });
    const attribution = parseAttribution(b.attributionCode);
    if (!attribution.ok) return void res.status(400).json({ error: "invalid_request", details: ["attributionCode is not a partner or sales code"] });
    const session = sessions.create(lang, attribution.code);
    res.status(201).json(await engine.start(session));
  });

  router.post("/advisor/sessions/:sessionId/messages", async (req, res) => {
    const session = SESSION_ID_RE.test(req.params.sessionId) ? sessions.get(req.params.sessionId) : undefined;
    if (!session) return void res.status(404).json({ error: "session_not_found" });

    const b = body(req.body);
    const errors: string[] = [];
    let input: AdvisorInput | null = null;
    if (!b) errors.push("body must be a JSON object");
    else {
      const lang = b.lang ?? session.lang;
      if (!isLang(lang)) errors.push("lang must be en or hi");
      const hasText = b.text !== undefined;
      const hasChoice = b.choice !== undefined;
      if (hasText === hasChoice) errors.push("send exactly one of text or choice");
      if (hasText && (typeof b.text !== "string" || b.text.trim() === "" || b.text.length > MAX_MESSAGE_CHARS)) {
        errors.push(`text must be 1 to ${MAX_MESSAGE_CHARS} characters`);
      }
      const choice = hasChoice ? parseChoice(b.choice) : null;
      if (hasChoice && !choice) errors.push("choice is not valid");
      if (errors.length === 0 && isLang(lang)) input = hasText ? { lang, text: b.text as string } : { lang, choice: choice! };
    }
    if (!input) return void res.status(400).json({ error: "invalid_request", details: errors });
    if (session.turns >= MAX_TURNS) return void res.status(429).json({ error: "too_many_messages" });
    if (session.busy) return void res.status(409).json({ error: "busy" });

    session.busy = true;
    try {
      sessions.touch(session);
      res.json(await engine.handle(session, input));
    } finally {
      session.busy = false;
    }
  });

  router.post("/advisor/sessions/:sessionId/lead", (req, res) => {
    const session = SESSION_ID_RE.test(req.params.sessionId) ? sessions.get(req.params.sessionId) : undefined;
    if (!session) return void res.status(404).json({ error: "session_not_found" });
    const b = body(req.body);
    if (!b) return void res.status(400).json({ error: "invalid_request", details: ["body must be a JSON object"] });

    const errors: string[] = [];
    const reason = b.reason;
    if (!(LEAD_REASONS as readonly unknown[]).includes(reason)) errors.push(`reason must be one of ${LEAD_REASONS.join(", ")}`);
    const consent = b.callbackConsent === true;
    if (b.callbackConsent !== undefined && typeof b.callbackConsent !== "boolean") errors.push("callbackConsent must be true or false");
    let phone: string | null = null;
    if (b.phone !== undefined && b.phone !== null && b.phone !== "") {
      phone = parseIndianMobile(b.phone);
      if (!phone) errors.push("phone must be a 10-digit Indian mobile number");
      else if (!consent) errors.push("callbackConsent must be true to leave a phone number");
    }
    if (reason === "asked_for_human" && !phone) errors.push("a phone number is needed for a call back");
    let note: string | null = null;
    if (b.note !== undefined && b.note !== null) {
      if (typeof b.note !== "string" || b.note.length > MAX_NOTE) errors.push(`note must be text of at most ${MAX_NOTE} characters`);
      else note = b.note.trim() || null;
    }
    if (errors.length > 0) return void res.status(400).json({ error: "invalid_request", details: errors.map(maskIdentifiers) });

    const { lead, created } = leads.save(session, { reason: reason as LeadReason, note, phone, callbackConsent: consent });
    const view = leadView(lead);
    res.status(created ? 201 : 200).json({ leadId: view.leadId, reason: view.reason, phoneMasked: view.phoneMasked });
  });

  return router;
}
