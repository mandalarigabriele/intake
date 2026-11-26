import { TARGET_WEIGHT_LIMITS, type GoalsUpdate, type ProfileView } from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { NutritionApi } from "../mcp/nutritionApi.js";

export interface ProfileRoutesOptions {
  api: Pick<NutritionApi, "clock" | "goals" | "weightTrends" | "logWeight" | "setGoals" | "setTimezone">;
  hevyConfigured: boolean;
  requireOwner: preHandlerHookHandler;
}

/** Weigh-ins shown on Profilo (one a week: about 13 points). */
const WEIGHT_WINDOW_DAYS = 90;

const grams = z.number().min(0).max(2000).nullable().optional();
/** The limits Nutrition accepts (calories up to 20,000, grams up to 2,000), checked here so a typo answers 400. */
const goalsBody = z
  .object({
    kcal: z.number().min(0).max(20_000).nullable().optional(),
    protein: grams,
    carbs: grams,
    fat: grams,
    fiber: grams,
    waterMl: z.number().min(0).max(20_000).nullable().optional(),
    /** In weightUnit (default kg), the unit of the Nutrition profile. */
    targetWeight: z.number().nullable().optional(),
    weightUnit: z.enum(["kg", "lb"]).optional(),
  })
  .strict()
  .refine(({ targetWeight, weightUnit }) => {
    if (targetWeight === undefined || targetWeight === null) return true;
    const limits = TARGET_WEIGHT_LIMITS[weightUnit ?? "kg"];
    return targetWeight >= limits.min && targetWeight <= limits.max;
  });

/**
 * An IANA zone name: "UTC", or "Area/City" with capitalised segments ("America/Argentina/Buenos_Aires", "Etc/GMT+1").
 * The shape is checked here, and the runtime must accept it too. Checking only against the runtime's list would refuse
 * valid newer names (e.g. "Asia/Kolkata") on a Node that does not list them yet; Intl alone would take "+01:00",
 * "GMT" or "europe/rome", which are not zone names.
 */
const ZONE_SHAPE = /^(UTC|[A-Z][A-Za-z_]*(\/[A-Z][A-Za-z_]*|\/[A-Za-z_]+[+-]?\d*){1,2})$/;

const knownToRuntime = (name: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
};

const timezoneBody = z
  .object({
    timezone: z
      .string()
      .max(64)
      .refine((name) => ZONE_SHAPE.test(name) && knownToRuntime(name)),
  })
  .strict();

const logWeightBody = z.object({
  weightKg: z.number().min(20).max(400),
  idempotencyKey: z.string().min(8).max(255),
});

/** Profilo (/api/profile), weigh-ins (/api/weight) and the Nutrition timezone (/api/timezone). Two Nutrition reads per visit. */
export const profileRoutes: FastifyPluginAsync<ProfileRoutesOptions> = async (app, { api, hevyConfigured, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.get("/profile", async (): Promise<ProfileView> => {
    const clock = await api.clock();
    const today = clock.localDate;
    const [goals, weight] = await Promise.all([api.goals(), api.weightTrends(WEIGHT_WINDOW_DAYS, today)]);
    return {
      today,
      weight,
      goals: { kcal: goals.kcal, protein: goals.protein, carbs: goals.carbs, fat: goals.fat, fiber: goals.fiber, waterMl: goals.waterMl },
      hevyConfigured,
      timezone: clock.timezone,
    };
  });

  // The Nutrition profile timezone decides "today" and the time of new meals; a new account starts on UTC.
  // Changed only when the user taps "Usa …" (Oggi or Profilo), never on its own.
  app.post("/timezone", async (request, reply) => {
    const body = timezoneBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid timezone" });
    await api.setTimezone(body.data.timezone);
    return { timezone: body.data.timezone };
  });

  // Goals live in Nutrition (set_nutrition_goals): the same ones Claude reads and changes in chat
  app.put("/goals", async (request, reply) => {
    const body = goalsBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid goals" });
    const update: GoalsUpdate = body.data;
    await api.setGoals(update);
    return { ok: true };
  });

  app.post("/weight", async (request, reply) => {
    const body = logWeightBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid weight" });
    await api.logWeight(body.data.weightKg, body.data.idempotencyKey);
    return reply.code(201).send({ ok: true });
  });
};
