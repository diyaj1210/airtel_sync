import { randomBytes } from "node:crypto";
import type { ProductId } from "../catalogue/types.js";
import type { Answers, Slot } from "./answers.js";
import type { LlmTurn } from "./llm.js";
import type { Recommendation } from "./recommend.js";
import type { Lang } from "./text.js";

/**
 * Advisor chats, kept in memory (prototype). A session holds only business facts and the
 * last few chat lines with identifiers masked; it expires after 2 hours without a message.
 */

export interface AdvisorSession {
  id: string;
  lang: Lang;
  answers: Answers;
  expecting: Slot | null;
  /** Last turns (masked), given to the LLM as context. */
  history: LlmTurn[];
  recommendation: Recommendation | null;
  /** Why each recommended product is in the bundle (shown on the card). */
  whys: Record<ProductId, string>;
  whySource: "gemini" | "rules";
  /** Messages in a row the advisor did not understand. */
  unclearStreak: number;
  /** The advisor offered a person because it could not understand. */
  stuck: boolean;
  /** Products the owner asked about that the rules engine said they cannot buy. */
  askedUnavailable: ProductId[];
  turns: number;
  leadId: string | null;
  busy: boolean;
  lastSeenMs: number;
}

export const SESSION_ID_RE = /^S-[0-9a-f]{16}$/;
export const MAX_HISTORY = 8;
export const MAX_TURNS = 60;

export class AdvisorSessionStore {
  private readonly sessions = new Map<string, AdvisorSession>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly options: { maxSessions: number; idleMs: number } = { maxSessions: 500, idleMs: 2 * 60 * 60 * 1000 },
    private readonly newId: () => string = () => `S-${randomBytes(8).toString("hex")}`,
  ) {}

  create(lang: Lang): AdvisorSession {
    this.sweep();
    if (this.sessions.size >= this.options.maxSessions) {
      // Drop the least recently used chat (Map keeps insertion order; touch() re-inserts).
      const oldest = this.sessions.keys().next().value;
      if (oldest !== undefined) this.sessions.delete(oldest);
    }
    let id = this.newId();
    while (this.sessions.has(id)) id = this.newId();
    const session: AdvisorSession = {
      id,
      lang,
      answers: {},
      expecting: null,
      history: [],
      recommendation: null,
      whys: {},
      whySource: "rules",
      unclearStreak: 0,
      stuck: false,
      askedUnavailable: [],
      turns: 0,
      leadId: null,
      busy: false,
      lastSeenMs: this.now(),
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): AdvisorSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (this.now() - session.lastSeenMs > this.options.idleMs) {
      this.sessions.delete(id);
      return undefined;
    }
    return session;
  }

  touch(session: AdvisorSession): void {
    session.lastSeenMs = this.now();
    this.sessions.delete(session.id);
    this.sessions.set(session.id, session);
  }

  get size(): number {
    return this.sessions.size;
  }

  private sweep(): void {
    for (const [id, s] of this.sessions) if (this.now() - s.lastSeenMs > this.options.idleMs) this.sessions.delete(id);
  }
}

export function remember(session: AdvisorSession, turn: LlmTurn): void {
  session.history.push({ role: turn.role, text: turn.text.slice(0, 400) });
  if (session.history.length > MAX_HISTORY) session.history.splice(0, session.history.length - MAX_HISTORY);
}
