/** KYC documents: types, and the call to the ai-service that reads an image (OCR). */

export const DOC_TYPES = ["gst_certificate", "udyam_certificate", "signatory_id", "address_proof"] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const isDocType = (v: unknown): v is DocType => typeof v === "string" && (DOC_TYPES as readonly string[]).includes(v);

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface ReadField {
  value: string | null;
  confidence: number | null;
  labelFound: boolean;
}

/** What the OCR read from one document. Held in memory only; never logged, never sent unmasked. */
export interface DocumentReading {
  docType: DocType;
  detectedType: DocType | null;
  readable: boolean;
  fields: Record<string, ReadField>;
}

export type ReadErrorKind = "unavailable" | "not_an_image" | "too_large" | "unsupported_type";

export class DocumentReadError extends Error {
  constructor(readonly kind: ReadErrorKind) {
    super(`document could not be read: ${kind}`);
    this.name = "DocumentReadError";
  }
}

export interface DocumentReader {
  read(image: Uint8Array<ArrayBuffer>, contentType: string, docType: DocType): Promise<DocumentReading>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Check the ai-service's answer field by field; anything unexpected counts as "unavailable". */
export function parseReading(body: unknown, docType: DocType): DocumentReading {
  if (!isRecord(body) || body.docType !== docType || typeof body.readable !== "boolean" || !isRecord(body.fields)) {
    throw new DocumentReadError("unavailable");
  }
  const detected = body.detectedType;
  if (detected !== null && !isDocType(detected)) throw new DocumentReadError("unavailable");
  const fields: Record<string, ReadField> = {};
  for (const [name, raw] of Object.entries(body.fields)) {
    if (!isRecord(raw)) throw new DocumentReadError("unavailable");
    const value = raw.value;
    const confidence = raw.confidence;
    if ((value !== null && typeof value !== "string") || (confidence !== null && typeof confidence !== "number")) {
      throw new DocumentReadError("unavailable");
    }
    fields[name] = { value: value === null ? null : value.slice(0, 300), confidence, labelFound: raw.labelFound === true };
  }
  return { docType, detectedType: detected as DocType | null, readable: body.readable, fields };
}

type FetchFn = typeof fetch;

export function createAiServiceReader(baseUrl: string, timeoutMs: number, fetchFn: FetchFn = fetch): DocumentReader {
  return {
    async read(image, contentType, docType) {
      let res: Response;
      try {
        res = await fetchFn(`${baseUrl}/kyc/read?docType=${docType}`, {
          method: "POST",
          headers: { "content-type": contentType },
          body: image,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new DocumentReadError("unavailable");
      }
      if (res.status === 422) throw new DocumentReadError("not_an_image");
      if (res.status === 413) throw new DocumentReadError("too_large");
      if (res.status === 415) throw new DocumentReadError("unsupported_type");
      if (!res.ok) throw new DocumentReadError("unavailable");
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new DocumentReadError("unavailable");
      }
      return parseReading(body, docType);
    },
  };
}

/** Used when the backend runs without an ai-service (tests): every read fails as "unavailable". */
export const NO_READER: DocumentReader = {
  async read() {
    throw new DocumentReadError("unavailable");
  },
};
