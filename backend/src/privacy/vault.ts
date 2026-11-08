import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REPO_ROOT } from "../config.js";

/**
 * Encrypted storage of uploaded document photos (privacy feature). AES-256-GCM with the key from
 * .env (DOCUMENT_ENCRYPTION_KEY, 32 bytes as 64 hex characters or base64). Each file: 12-byte IV,
 * 16-byte auth tag, ciphertext. File names are random (no identifier in them); the folder is
 * outside any public / served folder and git-ignored. Only the operations desk can read a file
 * back (back-office), and the retention job deletes them.
 */

export interface DocumentVault {
  /** Encrypt and keep a photo; returns its file id. */
  put(bytes: Uint8Array): string;
  /** Decrypted photo, or null when deleted / unknown / tampered with. */
  get(fileId: string): Buffer | null;
  delete(fileId: string): boolean;
  has(fileId: string): boolean;
}

export const DEFAULT_DOCUMENT_DIR = resolve(REPO_ROOT, "backend", "var", "documents");
const FILE_ID_RE = /^[0-9a-f-]{36}$/;

/** The 32-byte key from the environment. Missing: null (the caller decides; see keyFromEnv). */
export function parseKey(raw: string | undefined): Buffer | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("DOCUMENT_ENCRYPTION_KEY must be 32 bytes: 64 hex characters or base64");
  return key;
}

function encrypt(key: Buffer, bytes: Uint8Array): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function decrypt(key: Buffer, blob: Buffer): Buffer | null {
  if (blob.length < 28) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
    decipher.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
  } catch {
    return null;
  }
}

/** Files on disk (the app). */
export class FileVault implements DocumentVault {
  constructor(
    private readonly dir: string,
    private readonly key: Buffer,
  ) {
    if (key.length !== 32) throw new Error("vault key must be 32 bytes");
    mkdirSync(dir, { recursive: true });
  }

  private path(fileId: string): string | null {
    return FILE_ID_RE.test(fileId) ? join(this.dir, `${fileId}.bin`) : null;
  }

  put(bytes: Uint8Array): string {
    const fileId = randomUUID();
    writeFileSync(this.path(fileId)!, encrypt(this.key, bytes), { mode: 0o600 });
    return fileId;
  }

  get(fileId: string): Buffer | null {
    const p = this.path(fileId);
    return p && existsSync(p) ? decrypt(this.key, readFileSync(p)) : null;
  }

  delete(fileId: string): boolean {
    const p = this.path(fileId);
    if (!p || !existsSync(p)) return false;
    rmSync(p);
    return true;
  }

  has(fileId: string): boolean {
    const p = this.path(fileId);
    return !!p && existsSync(p);
  }
}

/** Encrypted blobs in memory (tests and the default when no folder is configured). */
export class MemoryVault implements DocumentVault {
  private readonly blobs = new Map<string, Buffer>();

  constructor(private readonly key: Buffer = randomBytes(32)) {}

  put(bytes: Uint8Array): string {
    const fileId = randomUUID();
    this.blobs.set(fileId, encrypt(this.key, bytes));
    return fileId;
  }

  get(fileId: string): Buffer | null {
    const blob = this.blobs.get(fileId);
    return blob ? decrypt(this.key, blob) : null;
  }

  delete(fileId: string): boolean {
    return this.blobs.delete(fileId);
  }

  has(fileId: string): boolean {
    return this.blobs.has(fileId);
  }

  /** The stored (encrypted) bytes, for tests. */
  raw(fileId: string): Buffer | undefined {
    return this.blobs.get(fileId);
  }
}
