import { existsSync } from "node:fs";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { GoogleSignInPort } from "./auth/google.js";
import { createRequireOwner } from "./auth/requireOwner.js";
import { SessionCookies } from "./auth/session.js";
import { NotConnectedError, RateLimitedError, type NutritionConnectionPort } from "./mcp/connection.js";
import { ToolError } from "./mcp/nutritionApi.js";
import { ParseError } from "./parsers/common.js";
import type { PlanStore } from "./db/planStore.js";
import { dayRoutes, type DayRoutesOptions } from "./routes/days.js";
import { mealRoutes, type MealRoutesOptions } from "./routes/meals.js";
import { insightRoutes, type InsightRoutesOptions } from "./routes/insight.js";
import { planRoutes } from "./routes/plans.js";
import { pushRoutes, type PushRoutesOptions } from "./routes/push.js";
import { workoutRoutes, type WorkoutRoutesOptions } from "./routes/workouts.js";
import { HevyError } from "./hevy/hevyApi.js";
import { weekRoutes, type WeekRoutesOptions } from "./routes/weeks.js";
import { profileRoutes, type ProfileRoutesOptions } from "./routes/profile.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { appleHealthRoutes, type AppleHealthRoutesOptions } from "./routes/appleHealth.js";
import { healthIngestRoutes, type HealthIngestRoutesOptions } from "./routes/healthIngest.js";
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
  /** Parsed Nutrition data access for the day routes; registered together with `auth`. */
  api?: DayRoutesOptions["api"];
  /** Logged meal writes (edit, delete, favorite, repeat); registered together with `auth`. */
  mealsApi?: MealRoutesOptions["api"];
  /** Daily insight ("Dai tuoi dati"); registered together with `auth`. */
  insightApi?: InsightRoutesOptions["api"];
  /** Week overview and weigh-ins; registered together with `auth`. */
  weekApi?: WeekRoutesOptions["api"];
  /** Profilo and weigh-ins; registered together with `auth`. */
  profile?: Omit<ProfileRoutesOptions, "requireOwner">;
  /** Meal plan storage; registered together with `api`. */
  plans?: PlanStore;
  /** Reminders (Web Push); registered together with `auth`. */
  push?: Omit<PushRoutesOptions, "requireOwner">;
  /** Hevy workouts; registered together with `auth`. */
  workouts?: Omit<WorkoutRoutesOptions, "requireOwner">;
  /** Apple Health import and status; registered together with `auth`. */
  appleHealth?: Omit<AppleHealthRoutesOptions, "requireOwner">;
  /** Automatic uploads from Health Auto Export; token-protected, outside Google sign-in. */
  healthIngest?: HealthIngestRoutesOptions;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, trustProxy: true });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof NotConnectedError) {
      return reply.code(409).send({ error: "nutrition_not_connected", message: error.message });
    }
    if (error instanceof RateLimitedError) {
      request.log.warn({ retryAfter: error.retryAfterSeconds }, "Nutrition rate limit reached");
      return reply
        .code(503)
        .header("retry-after", String(error.retryAfterSeconds))
        .send({ error: "nutrition_rate_limited", retryAfter: error.retryAfterSeconds });
    }
    if (error instanceof HevyError) {
      request.log.error({ err: error }, "Hevy request failed");
      return reply.code(502).send({ error: "hevy_unavailable", message: "Hevy did not answer as expected" });
    }
    if (error instanceof ToolError || error instanceof ParseError) {
      request.log.error({ err: error }, "Nutrition MCP request failed");
      return reply.code(502).send({ error: "nutrition_unavailable", message: "The Nutrition server returned an unexpected response" });
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) request.log.error({ err: error }, "Request failed");
    return reply.code(status).send({ error: status >= 500 ? "internal_error" : (error as Error).message });
  });

  await app.register(healthRoutes, { prefix: "/api" });
  if (options.healthIngest) {
    await app.register(healthIngestRoutes, { prefix: "/api", ...options.healthIngest });
  }

  if ((options.nutrition || options.api || options.mealsApi || options.weekApi || options.insightApi || options.push || options.workouts || options.appleHealth) && !options.auth) {
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
    if (options.workouts) {
      await app.register(workoutRoutes, { prefix: "/api", ...options.workouts, requireOwner });
    }
    if (options.appleHealth) {
      await app.register(appleHealthRoutes, { prefix: "/api", ...options.appleHealth, requireOwner });
    }
    if (options.push) {
      await app.register(pushRoutes, { prefix: "/api", ...options.push, requireOwner });
    }
    if (options.insightApi) {
      await app.register(insightRoutes, { prefix: "/api", api: options.insightApi, requireOwner });
    }
    if (options.weekApi) {
      await app.register(weekRoutes, { prefix: "/api", api: options.weekApi, plans: options.plans, requireOwner });
    }
    if (options.profile) {
      await app.register(profileRoutes, { prefix: "/api", ...options.profile, requireOwner });
    }
    if (options.mealsApi) {
      await app.register(mealRoutes, { prefix: "/api", api: options.mealsApi, requireOwner });
    }
    if (options.api) {
      await app.register(dayRoutes, { prefix: "/api", api: options.api, plans: options.plans, requireOwner });
      if (options.plans) {
        await app.register(planRoutes, { prefix: "/api", plans: options.plans, api: options.api, requireOwner });
      }
    }
  }

  const { webDistDir } = options;
  if (webDistDir && existsSync(webDistDir)) {
    // The app shell, manifest and icons are public; all data comes from owner-only API routes
    // wildcard: files are looked up per request, so a rebuilt web app is served without a restart
    await app.register(fastifyStatic, { root: webDistDir, wildcard: true });

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
