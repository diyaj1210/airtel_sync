import express, { Router, type Request, type Response } from "express";
import { parseIndianMobile } from "../advisor/leads.js";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "../kyc/documents.js";
import type { WaInput, WhatsAppBot } from "./whatsapp.js";

/**
 * MOCK WhatsApp Business API webhook (step 8). The simulator in the app plays the WhatsApp side.
 *
 *   POST /api/channels/whatsapp/messages   header x-wa-from: <10-digit mobile>
 *                                          { text, voice? } or { buttonId }        -> { mock, replies }
 *   POST /api/channels/whatsapp/photo      header x-wa-from; body = the photo (image/png|jpeg|webp, <= 8 MB)
 *
 * The phone number travels in a header (not the URL, so it never reaches the request log) and is
 * never logged or sent back. Message text is never logged.
 */

export const MAX_WA_TEXT = 500;
const BUTTON_ID_RE = /^[a-z]+(?::[A-Za-z0-9_]{1,40})?$/;

export function whatsappRouter(bot: WhatsAppBot): Router {
  const router = Router();

  const from = (req: Request, res: Response): string | null => {
    const phone = parseIndianMobile(req.headers["x-wa-from"]);
    if (!phone) res.status(400).json({ error: "invalid_from", details: ["x-wa-from must be a 10-digit Indian mobile number"] });
    return phone;
  };

  const answer = async (res: Response, phone: string, input: WaInput) => {
    const replies = await bot.receive(phone, input);
    if (!replies) return void res.status(409).json({ error: "busy" });
    res.json({ mock: true, replies });
  };

  router.post("/channels/whatsapp/messages", async (req, res) => {
    const phone = from(req, res);
    if (!phone) return;
    const b = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>;
    const hasText = b.text !== undefined;
    const hasButton = b.buttonId !== undefined;
    if (hasText === hasButton) return void res.status(400).json({ error: "invalid_request", details: ["send exactly one of text or buttonId"] });
    if (hasText) {
      if (typeof b.text !== "string" || b.text.trim() === "" || b.text.length > MAX_WA_TEXT) {
        return void res.status(400).json({ error: "invalid_request", details: [`text must be 1 to ${MAX_WA_TEXT} characters`] });
      }
      if (b.voice !== undefined && typeof b.voice !== "boolean") return void res.status(400).json({ error: "invalid_request", details: ["voice must be true or false"] });
      return answer(res, phone, { type: "text", text: b.text, voice: b.voice === true });
    }
    if (typeof b.buttonId !== "string" || !BUTTON_ID_RE.test(b.buttonId)) return void res.status(400).json({ error: "invalid_request", details: ["buttonId is not valid"] });
    return answer(res, phone, { type: "button", id: b.buttonId });
  });

  router.post("/channels/whatsapp/photo", express.raw({ type: [...IMAGE_TYPES], limit: MAX_IMAGE_BYTES }), async (req, res) => {
    const phone = from(req, res);
    if (!phone) return;
    const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (!(IMAGE_TYPES as readonly string[]).includes(contentType) || !Buffer.isBuffer(req.body)) return void res.status(415).json({ error: "unsupported_type" });
    if (req.body.length === 0) return void res.status(400).json({ error: "empty_upload" });
    return answer(res, phone, { type: "image", bytes: new Uint8Array(req.body), contentType });
  });

  return router;
}
