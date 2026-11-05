import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { SessionCookies, SessionUser } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

/** Only allows requests with a valid session for OWNER_EMAIL. */
export function createRequireOwner(cookies: SessionCookies, ownerEmail: string): preHandlerHookHandler {
  const owner = ownerEmail.toLowerCase();

  return async function requireOwner(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = cookies.getUser(request);
    if (user && user.email === owner) {
      request.user = user;
      return;
    }

    // Browser navigation (e.g. /connect/nutrition) goes to the sign-in page; API calls get 401
    if (request.method === "GET" && !request.url.startsWith("/api/")) {
      await reply.redirect(`/auth/google?returnTo=${encodeURIComponent(request.url)}`);
      return;
    }
    await reply.code(401).send({ error: "Sign-in required" });
  };
}
