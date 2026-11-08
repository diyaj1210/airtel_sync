import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { REPO_ROOT } from "../../src/config.js";
import { DocumentReadError, parseReading, type DocType, type DocumentReader, type DocumentReading } from "../../src/kyc/documents.js";
import { loadRegistries } from "../../src/kyc/registry.js";
import { loadSamples, sampleImagePath } from "../../src/kyc/samples.js";

/**
 * What the OCR really reads from data/raw/kyc_documents (written by `python -m app.kyc.fixture`;
 * the ai-service test test_kyc.py re-reads every image and checks this file still matches).
 */
export const FIXTURE_PATH = resolve(REPO_ROOT, "ai-service", "tests", "fixtures", "kyc_readings.json");
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, Record<string, unknown>>;

export const registries = loadRegistries();
export const samples = new Map(loadSamples().map((s) => [s.id, s]));

export function sampleDocuments(id: string): Partial<Record<DocType, DocumentReading>> {
  const s = samples.get(id)!;
  return Object.fromEntries(s.documents.map((d) => [d, parseReading(fixture[id]![d], d)]));
}

export const sampleImage = (id: string, doc: DocType) => readFileSync(sampleImagePath(id, doc));

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * Stands in for the ai-service: recognises the real sample images by their bytes and answers with
 * the recorded OCR reading. Anything else is "not an image" (as the ai-service would say).
 */
export function recordedReader(): DocumentReader & { calls: number } {
  const byHash = new Map<string, Record<string, unknown>>();
  for (const s of samples.values()) for (const d of s.documents) byHash.set(sha(sampleImage(s.id, d)), fixture[s.id]![d] as Record<string, unknown>);
  const reader = {
    calls: 0,
    async read(image: Uint8Array<ArrayBuffer>, _contentType: string, docType: DocType) {
      reader.calls += 1;
      const recorded = byHash.get(sha(image));
      if (!recorded) throw new DocumentReadError("not_an_image");
      // The slot decides docType; detectedType says what the image really is.
      return parseReading({ ...recorded, docType }, docType);
    },
  };
  return reader;
}
