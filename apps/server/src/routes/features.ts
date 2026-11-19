import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { FeatureKey, FeaturesResponse } from "@intake/shared";
import type { FeatureStore } from "../db/featureStore.js";

export interface FeatureRoutesOptions {
  features: FeatureStore;
  gymApps: FeaturesResponse["gymApps"];
  requireOwner: preHandlerHookHandler;
}

const updateSchema = z
  .object({ setupDone: z.boolean(), training: z.boolean(), health: z.boolean(), reminders: z.boolean() })
  .partial()
  .strict();

/**
 * API routes of the optional parts; while every part listed for a route is off it answers 404 "feature_disabled".
 * The workouts list serves both Allenamenti (gym app) and Salute (Apple Health sessions).
 */
const FEATURE_ROUTES: Array<{ keys: FeatureKey[]; prefix: RegExp }> = [
  { keys: ["training"], prefix: /^\/api\/(training|hevy-sync)(\/|\?|$)/ },
  { keys: ["training", "health"], prefix: /^\/api\/workouts(\/|\?|$)/ },
  { keys: ["health"], prefix: /^\/api\/health\// },
  { keys: ["reminders"], prefix: /^\/api\/push(\/|\?|$)/ },
];

/** The part that hides an API URL right now, or null when the route is served (Alimentazione and the rest). */
export function blockedBy(url: string, enabled: (key: FeatureKey) => boolean): FeatureKey | null {
  const route = FEATURE_ROUTES.find((r) => r.prefix.test(url));
  return route && !route.keys.some(enabled) ? route.keys[0]! : null;
}

export const featureRoutes: FastifyPluginAsync<FeatureRoutesOptions> = async (app, { features, gymApps, requireOwner }) => {
  const response = (): FeaturesResponse => ({ ...features.get(), gymApps });

  app.get("/features", { preHandler: requireOwner }, async () => response());

  app.put("/features", { preHandler: requireOwner }, async (request, reply) => {
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_features" });
    features.set(parsed.data);
    return response();
  });
};
