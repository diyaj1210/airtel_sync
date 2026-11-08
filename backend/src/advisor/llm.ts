import type { AnswerUpdates, Slot } from "./answers.js";
import { INTENTS, type Intent } from "./parser.js";
import type { Lang } from "./text.js";

/**
 * The advisor's language model, reached through the ai-service (which holds the Gemini key; the
 * key never reaches the backend or the browser). The LLM only reads messages and rewords facts;
 * the backend validates everything it returns and falls back to its own rules on any failure.
 */

export interface LlmTurn {
  role: "owner" | "advisor";
  text: string;
}

export interface UnderstandRequest {
  lang: Lang;
  expecting: Slot | null;
  /** What is known so far (no names or identifiers). */
  known: Record<string, unknown>;
  cities: string[];
  products: { id: string; name: string; description: string }[];
  recentTurns: LlmTurn[];
  /** The owner's message with identifiers already masked. */
  message: string;
}

export interface LlmUnderstanding {
  updates: AnswerUpdates;
  intent: Intent;
  /** true when the model said the message is off-topic (shown with its polite redirect). */
  offTopic: boolean;
  productIds: string[];
  ack: string | null;
}

export interface ExplainRequest {
  lang: Lang;
  task: "recommendation" | "answer";
  question: string | null;
  facts: unknown;
}

export interface LlmExplanation {
  text: string;
  lines: { productId: string; why: string }[];
}

export type LlmStatus = { enabled: true; provider: string; model: string } | { enabled: false; reason: string };

export interface AdvisorLlm {
  status(): Promise<LlmStatus>;
  understand(req: UnderstandRequest): Promise<LlmUnderstanding>;
  explain(req: ExplainRequest): Promise<LlmExplanation>;
}

export const LLM_ERROR_KINDS = ["disabled", "quota", "timeout", "upstream", "bad_output", "unreachable"] as const;
export type LlmErrorKind = (typeof LLM_ERROR_KINDS)[number];

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    readonly retryAfterMs?: number,
  ) {
    super(`LLM ${kind}`);
  }
}

/** An LLM that is always off (no ai-service, or tests of the no-key mode). */
export const NO_LLM: AdvisorLlm = {
  status: async () => ({ enabled: false, reason: "not configured" }),
  understand: async () => {
    throw new LlmError("disabled");
  },
  explain: async () => {
    throw new LlmError("disabled");
  },
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);

/** Map the ai-service's understanding JSON onto our types; anything malformed is dropped. */
export function parseUnderstanding(body: unknown): LlmUnderstanding {
  if (!isObject(body)) throw new LlmError("bad_output");
  const rawIntent = body.intent;
  const offTopic = rawIntent === "other";
  const intent: Intent = offTopic ? "unclear" : (INTENTS as readonly unknown[]).includes(rawIntent) ? (rawIntent as Intent) : "unclear";
  const updates: AnswerUpdates = {};
  for (const key of ["businessKind", "businessType", "employees", "sites", "city", "gstin", "internet", "tools"] as const) {
    if (body[key] !== undefined && body[key] !== null) updates[key] = body[key];
  }
  const productIds = Array.isArray(body.productIds)
    ? body.productIds.filter((id): id is string => typeof id === "string" && /^P\d{2}$/.test(id)).slice(0, 3)
    : [];
  return { updates, intent, offTopic, productIds, ack: str(body.ack, 600) };
}

export function parseExplanation(body: unknown): LlmExplanation {
  if (!isObject(body) || typeof body.text !== "string") throw new LlmError("bad_output");
  const lines = Array.isArray(body.lines)
    ? body.lines
        .filter(isObject)
        .filter((l) => typeof l.productId === "string" && typeof l.why === "string")
        .map((l) => ({ productId: l.productId as string, why: l.why as string }))
    : [];
  return { text: body.text, lines };
}

type FetchFn = typeof fetch;

/** HTTP client for the ai-service advisor endpoints. */
export function createAiServiceLlm(baseUrl: string, timeoutMs: number, fetchFn: FetchFn = fetch): AdvisorLlm {
  async function call(path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      throw new LlmError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "unreachable");
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new LlmError(res.ok ? "bad_output" : "upstream");
    }
    if (res.ok) return json;
    const error = isObject(json) ? json.error : undefined;
    const retry = isObject(json) && typeof json.retryAfterSeconds === "number" ? json.retryAfterSeconds * 1000 : undefined;
    switch (error) {
      case "llm_disabled":
        throw new LlmError("disabled");
      case "llm_quota":
        throw new LlmError("quota", retry);
      case "llm_timeout":
        throw new LlmError("timeout");
      case "llm_bad_output":
        throw new LlmError("bad_output");
      default:
        throw new LlmError("upstream");
    }
  }

  return {
    async status() {
      try {
        const body = await call("/advisor/status");
        if (isObject(body) && body.enabled === true && typeof body.model === "string") {
          return { enabled: true, provider: typeof body.provider === "string" ? body.provider : "llm", model: body.model };
        }
        return { enabled: false, reason: isObject(body) && typeof body.reason === "string" ? body.reason : "disabled" };
      } catch (err) {
        return { enabled: false, reason: err instanceof LlmError ? err.kind : "unreachable" };
      }
    },
    understand: async (req) => parseUnderstanding(await call("/advisor/understand", req)),
    explain: async (req) => parseExplanation(await call("/advisor/explain", req)),
  };
}

/** How long to stop calling the LLM after each kind of failure (the advisor answers by rules meanwhile). */
export const COOLDOWN_MS: Record<LlmErrorKind, number> = {
  disabled: 60_000,
  quota: 60_000,
  // One-off failures (Google overloaded, a slow answer): short pause, then try again.
  timeout: 15_000,
  upstream: 10_000,
  unreachable: 15_000,
  bad_output: 0,
};

/**
 * Calls the LLM unless it recently failed. Never throws: a failure returns null and the caller
 * uses its rule-based answer. Quota errors (free plans) pause the LLM for the time Google asks.
 */
export class LlmGate {
  private blockedUntil = 0;
  private lastFailure: LlmErrorKind | null = null;

  constructor(
    readonly llm: AdvisorLlm,
    private readonly onFailure: (kind: LlmErrorKind) => void = () => undefined,
    private readonly now: () => number = () => Date.now(),
  ) {}

  available(): boolean {
    return this.now() >= this.blockedUntil;
  }

  /** The last failure, or null after a successful call. */
  get lastFailureKind(): LlmErrorKind | null {
    return this.lastFailure;
  }

  async call<T>(fn: (llm: AdvisorLlm) => Promise<T>): Promise<T | null> {
    if (!this.available()) return null;
    try {
      const result = await fn(this.llm);
      this.lastFailure = null;
      return result;
    } catch (err) {
      const kind: LlmErrorKind = err instanceof LlmError ? err.kind : "upstream";
      this.lastFailure = kind;
      this.blockedUntil = this.now() + Math.max(COOLDOWN_MS[kind], kind === "quota" && err instanceof LlmError ? (err.retryAfterMs ?? 0) : 0);
      this.onFailure(kind);
      return null;
    }
  }

  /** Mark the LLM as off without a call (status check said it is not configured). */
  block(kind: LlmErrorKind): void {
    this.lastFailure = kind;
    this.blockedUntil = this.now() + COOLDOWN_MS[kind];
  }
}
