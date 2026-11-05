import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { NutritionConnectionPort } from "../mcp/connection.js";

export interface NutritionRoutesOptions {
  connection: NutritionConnectionPort;
  requireOwner: preHandlerHookHandler;
}

/** One-time Nutrition OAuth connection: browser routes under /connect/nutrition. */
export const nutritionConnectRoutes: FastifyPluginAsync<NutritionRoutesOptions> = async (app, { connection, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.get("/connect/nutrition", async (request, reply) => {
    const result = await connection.startAuthorization();
    if (result.status === "authorized") return reply.redirect("/?nutrition=connected");
    request.log.info("Redirecting to Nutrition authorization");
    return reply.redirect(result.url.href);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/connect/nutrition/callback",
    async (request, reply) => {
      const { code, state, error } = request.query;
      if (error || !code) {
        request.log.warn({ error }, "Nutrition authorization was not granted");
        return reply.redirect("/?nutrition=error");
      }
      try {
        await connection.finishAuthorization(code, state);
      } catch (err) {
        request.log.error({ err }, "Nutrition authorization failed");
        return reply.redirect("/?nutrition=error");
      }
      request.log.info("Nutrition account connected");
      return reply.redirect("/?nutrition=connected");
    },
  );
};

/** JSON routes under /api/nutrition. */
export const nutritionApiRoutes: FastifyPluginAsync<NutritionRoutesOptions> = async (app, { connection, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.get("/nutrition/status", async () => ({ connected: connection.isConnected() }));

  app.post("/nutrition/disconnect", async () => {
    await connection.disconnect();
    return { connected: false };
  });
};
