import { randomBytes } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { staffByCode, type StaffMember, type StaffRole } from "./staff.js";

/**
 * MOCK staff sign-in for the back-office: a demo account is picked from the list (no password in
 * the prototype; a real rollout uses the company's staff login). The token is random, kept in
 * memory, sent as "Authorization: Bearer <token>", expires after 8 hours and is never logged
 * (the logger redacts "authorization" and "token").
 */

export const STAFF_SESSION_MS = 8 * 60 * 60 * 1000;
export const MAX_STAFF_SESSIONS = 200;
const TOKEN_RE = /^[0-9a-f]{48}$/;

interface StaffSession {
  staff: StaffMember;
  expiresMs: number;
}

export class StaffSessions {
  private readonly sessions = new Map<string, StaffSession>();

  constructor(
    private readonly nowMs: () => number,
    private readonly newToken: () => string = () => randomBytes(24).toString("hex"),
  ) {}

  signIn(code: unknown): { token: string; staff: StaffMember; expiresMs: number } | null {
    const staff = staffByCode(code);
    if (!staff) return null;
    this.sweep();
    while (this.sessions.size >= MAX_STAFF_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!);
    let token = this.newToken();
    while (this.sessions.has(token)) token = this.newToken();
    const expiresMs = this.nowMs() + STAFF_SESSION_MS;
    this.sessions.set(token, { staff, expiresMs });
    return { token, staff, expiresMs };
  }

  get(token: string): StaffMember | undefined {
    if (!TOKEN_RE.test(token)) return undefined;
    const s = this.sessions.get(token);
    if (!s) return undefined;
    if (s.expiresMs <= this.nowMs()) {
      this.sessions.delete(token);
      return undefined;
    }
    return s.staff;
  }

  signOut(token: string): boolean {
    return this.sessions.delete(token);
  }

  private sweep(): void {
    const now = this.nowMs();
    for (const [token, s] of this.sessions) if (s.expiresMs <= now) this.sessions.delete(token);
  }
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const m = /^Bearer ([0-9a-f]{48})$/.exec(header.trim());
  return m?.[1] ?? null;
}

/** The signed-in staff member (set by requireStaff). */
export const staffOf = (res: Response): StaffMember => res.locals.staff as StaffMember;

/** 401 without a valid session; 403 when the role may not use this endpoint. */
export function requireStaff(sessions: StaffSessions, roles: readonly StaffRole[]): RequestHandler {
  return (req, res, next) => {
    const token = bearerToken(req);
    const staff = token ? sessions.get(token) : undefined;
    if (!staff) return void res.status(401).json({ error: "sign_in_required" });
    if (!roles.includes(staff.role)) return void res.status(403).json({ error: "not_allowed_for_role" });
    res.locals.staff = staff;
    next();
  };
}
