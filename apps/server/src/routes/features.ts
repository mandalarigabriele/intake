import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { FeatureKey, FeaturesResponse } from "@intake/shared";
import type { FeatureStore } from "../db/featureStore.js";

export interface FeatureRoutesOptions {
  features: FeatureStore;
  gymApps: FeaturesResponse["gymApps"];
  /** Whether ANTHROPIC_API_KEY is set (photo and text recognition; used only while photoMeals is on). */
  recognition?: boolean;
  requireOwner: preHandlerHookHandler;
}

const updateSchema = z
  .object({ setupDone: z.boolean(), training: z.boolean(), health: z.boolean(), reminders: z.boolean(), water: z.boolean(), photoMeals: z.boolean() })
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
  { keys: ["water"], prefix: /^\/api\/water(\/|\?|$)/ },
  // Photo meals: the recognition, the kept photos and the AI opinion on the needs (logging a meal, the favorites and
  // the needs calculation stay with Alimentazione); plan generation, the nutrient estimate and the dish alternative
  { keys: ["photoMeals"], prefix: /^\/api\/meals\/(recognize|photos)(\/|\?|$)|^\/api\/meals\/[^/?]+\/photos?(\/|\?|$)|^\/api\/needs\/ai(\/|\?|$)|^\/api\/plans\/(generate|generation|estimate)(\/|\?|$)|^\/api\/plans\/\d+\/alternative(\/|\?|$)|^\/api\/days\/[^/?]+\/alternative(\/|\?|$)/ },
];

/** The part that hides an API URL right now, or null when the route is served (Alimentazione and the rest). */
export function blockedBy(url: string, enabled: (key: FeatureKey) => boolean): FeatureKey | null {
  const route = FEATURE_ROUTES.find((r) => r.prefix.test(url));
  return route && !route.keys.some(enabled) ? route.keys[0]! : null;
}

export const featureRoutes: FastifyPluginAsync<FeatureRoutesOptions> = async (app, { features, gymApps, recognition = false, requireOwner }) => {
  const response = (): FeaturesResponse => {
    const stored = features.get();
    return { ...stored, gymApps, recognition: recognition && stored.photoMeals, recognitionConfigured: recognition };
  };

  app.get("/features", { preHandler: requireOwner }, async () => response());

  app.put("/features", { preHandler: requireOwner }, async (request, reply) => {
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_features" });
    features.set(parsed.data);
    return response();
  });
};
