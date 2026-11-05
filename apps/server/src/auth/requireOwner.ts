import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Guards owner-only routes.
 *
 * Placeholder until Google sign-in is implemented: allows everything in development and
 * refuses in production, so a deployed instance never exposes the Nutrition connection
 * without authentication.
 */
export function createRequireOwner(isProduction: boolean) {
  return async function requireOwner(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (isProduction) {
      await reply.code(503).send({ error: "Sign-in is not implemented yet" });
    }
  };
}
