import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { GoogleSignInPort } from "../auth/google.js";
import type { SessionCookies } from "../auth/session.js";

export interface AuthRoutesOptions {
  google: GoogleSignInPort;
  cookies: SessionCookies;
  ownerEmail: string;
  requireOwner: preHandlerHookHandler;
}

/** Only same-site paths are allowed as a post-login destination (prevents open redirects). */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.startsWith("/auth/")) return "/";
  return value;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, { google, cookies, ownerEmail, requireOwner }) => {
  const owner = ownerEmail.toLowerCase();

  app.get<{ Querystring: { returnTo?: string } }>("/auth/google", async (request, reply) => {
    const { url, transaction } = google.createLogin(safeReturnTo(request.query.returnTo));
    cookies.setLogin(reply, transaction);
    return reply.redirect(url.href);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/auth/callback", async (request, reply) => {
    const transaction = cookies.getLogin(request);
    cookies.clearLogin(reply);
    const { code, state, error } = request.query;

    if (error || !code || !transaction || state !== transaction.state) {
      request.log.warn({ error, hasTransaction: Boolean(transaction) }, "Google sign-in was not completed");
      return reply.redirect("/?signin=error");
    }

    let identity;
    try {
      identity = await google.completeLogin(code, transaction);
    } catch (err) {
      request.log.error({ err }, "Google sign-in failed");
      return reply.redirect("/?signin=error");
    }

    if (identity.email !== owner) {
      request.log.warn({ email: identity.email }, "Sign-in refused: not the owner account");
      return reply.redirect("/?signin=denied");
    }

    cookies.setUser(reply, { email: identity.email, name: identity.name, picture: identity.picture });
    request.log.info("Owner signed in");
    return reply.redirect(transaction.returnTo);
  });

  app.post("/auth/logout", async (_request, reply) => {
    cookies.clearUser(reply);
    return { signedIn: false };
  });

  app.get("/api/me", { preHandler: requireOwner }, async (request) => ({ user: request.user }));
};
