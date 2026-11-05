import type { FastifyReply, FastifyRequest } from "fastify";
import type { LoginTransaction } from "./google.js";

export const SESSION_COOKIE = "intake_session";
export const LOGIN_COOKIE = "intake_login";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const LOGIN_TTL_SECONDS = 60 * 10;

export interface SessionUser {
  email: string;
  name: string | null;
  picture: string | null;
}

interface SessionPayload extends SessionUser {
  /** Expiry, seconds since epoch. Checked server-side in addition to the cookie's Max-Age. */
  exp: number;
}

export interface CookieSettings {
  secure: boolean;
}

/** Session and login-transaction cookies, signed with SESSION_SECRET via @fastify/cookie. */
export class SessionCookies {
  constructor(
    private readonly settings: CookieSettings,
    private readonly now: () => number = Date.now,
  ) {}

  private options(maxAge: number) {
    return { path: "/", httpOnly: true, sameSite: "lax" as const, secure: this.settings.secure, signed: true, maxAge };
  }

  private read<T>(request: FastifyRequest, name: string): T | null {
    const raw = request.cookies[name];
    if (!raw) return null;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || unsigned.value === null) return null;
    try {
      return JSON.parse(Buffer.from(unsigned.value, "base64url").toString("utf8")) as T;
    } catch {
      return null;
    }
  }

  private write(reply: FastifyReply, name: string, value: unknown, maxAge: number): void {
    reply.setCookie(name, Buffer.from(JSON.stringify(value)).toString("base64url"), this.options(maxAge));
  }

  getUser(request: FastifyRequest): SessionUser | null {
    const session = this.read<SessionPayload>(request, SESSION_COOKIE);
    if (!session || typeof session.exp !== "number" || session.exp * 1000 < this.now()) return null;
    return { email: session.email, name: session.name, picture: session.picture };
  }

  setUser(reply: FastifyReply, user: SessionUser): void {
    const payload: SessionPayload = { ...user, exp: Math.floor(this.now() / 1000) + SESSION_TTL_SECONDS };
    this.write(reply, SESSION_COOKIE, payload, SESSION_TTL_SECONDS);
  }

  clearUser(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  getLogin(request: FastifyRequest): LoginTransaction | null {
    return this.read<LoginTransaction>(request, LOGIN_COOKIE);
  }

  setLogin(reply: FastifyReply, transaction: LoginTransaction): void {
    this.write(reply, LOGIN_COOKIE, transaction, LOGIN_TTL_SECONDS);
  }

  clearLogin(reply: FastifyReply): void {
    reply.clearCookie(LOGIN_COOKIE, { path: "/" });
  }
}
