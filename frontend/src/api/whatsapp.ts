/** Calls for the MOCK WhatsApp channel (backend/src/channels). The simulator plays the WhatsApp side. */
import type { DocType } from "./kyc";

export interface WaButton {
  id: string;
  title: string;
}
export interface WaMessage {
  id: number;
  text: string;
  buttons?: WaButton[];
  list?: { button: string; rows: WaButton[] };
  expectsPhoto?: DocType;
}

export class WhatsAppError extends Error {
  constructor(readonly status: number) {
    super(`whatsapp ${status}`);
  }
}

type FetchFn = typeof fetch;

async function post(fetchFn: FetchFn, url: string, phone: string, body: BodyInit, contentType: string): Promise<WaMessage[]> {
  let res: Response;
  try {
    res = await fetchFn(url, { method: "POST", headers: { "content-type": contentType, accept: "application/json", "x-wa-from": phone }, body });
  } catch {
    throw new WhatsAppError(0);
  }
  if (!res.ok) throw new WhatsAppError(res.status);
  return ((await res.json()) as { replies: WaMessage[] }).replies;
}

export const sendText = (phone: string, text: string, voice: boolean, fetchFn: FetchFn = fetch) =>
  post(fetchFn, "/api/channels/whatsapp/messages", phone, JSON.stringify({ text, ...(voice ? { voice: true } : {}) }), "application/json");

export const tapButton = (phone: string, buttonId: string, fetchFn: FetchFn = fetch) =>
  post(fetchFn, "/api/channels/whatsapp/messages", phone, JSON.stringify({ buttonId }), "application/json");

export const sendPhoto = (phone: string, image: { bytes: Uint8Array<ArrayBuffer>; type: string }, fetchFn: FetchFn = fetch) =>
  post(fetchFn, "/api/channels/whatsapp/photo", phone, image.bytes, image.type);

/** DEMO: a sample applicant's document image (data/raw/kyc_documents). */
export async function sampleDocument(sampleId: string, doc: DocType, fetchFn: FetchFn = fetch): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string }> {
  const res = await fetchFn(`/api/kyc/samples/${encodeURIComponent(sampleId)}/documents/${doc}`);
  if (!res.ok) throw new WhatsAppError(res.status);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type")?.split(";")[0] ?? "image/png" };
}
