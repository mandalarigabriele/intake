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

/** API routes of each optional part; while the part is off they answer 404 "feature_disabled". */
const FEATURE_ROUTES: Array<{ key: FeatureKey; prefix: RegExp }> = [
  { key: "training", prefix: /^\/api\/(training|workouts|hevy-sync)(\/|\?|$)/ },
  { key: "health", prefix: /^\/api\/health\// },
  { key: "reminders", prefix: /^\/api\/push(\/|\?|$)/ },
];

/** The part an API URL belongs to, or null for Alimentazione and the rest of the app. */
export function featureOf(url: string): FeatureKey | null {
  return FEATURE_ROUTES.find((r) => r.prefix.test(url))?.key ?? null;
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
