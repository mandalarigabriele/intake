import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { createRequireOwner } from "./auth/requireOwner.js";
import type { NutritionConnectionPort } from "./mcp/connection.js";
import { healthRoutes } from "./routes/health.js";
import { nutritionApiRoutes, nutritionConnectRoutes } from "./routes/nutrition.js";

export interface AppOptions {
  /** Directory with the built web app. Static serving is skipped when it does not exist. */
  webDistDir?: string;
  logger?: boolean;
  isProduction?: boolean;
  /** Nutrition MCP connection; the Nutrition routes are only registered when provided. */
  nutrition?: NutritionConnectionPort;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, trustProxy: true });
  const requireOwner = createRequireOwner(options.isProduction ?? false);

  await app.register(healthRoutes, { prefix: "/api" });

  if (options.nutrition) {
    await app.register(nutritionConnectRoutes, { connection: options.nutrition, requireOwner });
    await app.register(nutritionApiRoutes, { prefix: "/api", connection: options.nutrition, requireOwner });
  }

  const { webDistDir } = options;
  if (webDistDir && existsSync(webDistDir)) {
    await app.register(fastifyStatic, { root: webDistDir, wildcard: false });

    // Single-page app: unknown non-API GET routes fall back to index.html
    app.setNotFoundHandler((request, reply) => {
      const isApi = /^\/(api|auth|connect)(\/|$)/.test(request.url);
      if (request.method === "GET" && !isApi) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
  }

  return app;
}
