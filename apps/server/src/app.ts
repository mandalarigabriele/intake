import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health.js";

export interface AppOptions {
  /** Directory with the built web app. Static serving is skipped when it does not exist. */
  webDistDir?: string;
  logger?: boolean;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, trustProxy: true });

  await app.register(healthRoutes, { prefix: "/api" });

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
