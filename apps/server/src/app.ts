import { existsSync } from "node:fs";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { GoogleSignInPort } from "./auth/google.js";
import { createRequireOwner } from "./auth/requireOwner.js";
import { SessionCookies } from "./auth/session.js";
import type { NutritionConnectionPort } from "./mcp/connection.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { nutritionApiRoutes, nutritionConnectRoutes } from "./routes/nutrition.js";

export interface AuthOptions {
  google: GoogleSignInPort;
  ownerEmail: string;
  sessionSecret: string;
  /** Secure cookies require HTTPS; true whenever PUBLIC_BASE_URL is https. */
  secureCookies: boolean;
  now?: () => number;
}

export interface AppOptions {
  /** Directory with the built web app. Static serving is skipped when it does not exist. */
  webDistDir?: string;
  logger?: boolean;
  /** Google sign-in; required for every owner-only route. */
  auth?: AuthOptions;
  /** Nutrition MCP connection; its routes are only registered together with `auth`. */
  nutrition?: NutritionConnectionPort;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, trustProxy: true });

  await app.register(healthRoutes, { prefix: "/api" });

  if (options.nutrition && !options.auth) {
    throw new Error("Nutrition routes need authentication options");
  }

  if (options.auth) {
    const { google, ownerEmail, sessionSecret, secureCookies, now } = options.auth;
    await app.register(fastifyCookie, { secret: sessionSecret });
    const cookies = new SessionCookies({ secure: secureCookies }, now);
    const requireOwner = createRequireOwner(cookies, ownerEmail);

    await app.register(authRoutes, { google, cookies, ownerEmail, requireOwner });

    if (options.nutrition) {
      await app.register(nutritionConnectRoutes, { connection: options.nutrition, requireOwner });
      await app.register(nutritionApiRoutes, { prefix: "/api", connection: options.nutrition, requireOwner });
    }
  }

  const { webDistDir } = options;
  if (webDistDir && existsSync(webDistDir)) {
    // The app shell, manifest and icons are public; all data comes from owner-only API routes
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
