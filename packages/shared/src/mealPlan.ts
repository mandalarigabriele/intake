import { z } from "zod";

/**
 * Meal plan file format.
 *
 * A plan is generated in the Claude Fitness project and uploaded to Intake.
 * It becomes active from `validFrom` onward; earlier versions are kept as history.
 *
 * The optional nutrients mirror the fields the Nutrition MCP server tracks, so that
 * meals logged with "Mark as eaten as planned" are complete. A nutrient left out is
 * stored by the server as "not measured" and that day drops out of its averages.
 */

export const MEAL_PLAN_SCHEMA_VERSION = 1;

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

const grams = z.number().nonnegative();

export const plannedMacrosSchema = z
  .strictObject({
    kcal: z.number().nonnegative().describe("Energy in kcal"),
    protein: grams.describe("Protein in grams"),
    carbs: grams.describe("Carbohydrates in grams"),
    fat: grams.describe("Total fat in grams"),
    fiber: grams.describe("Fiber in grams"),
    sugar: grams.optional().describe("Total sugar in grams. Must be given together with addedSugar."),
    addedSugar: grams
      .optional()
      .describe("Added sugar in grams, part of sugar (never more than sugar). Must be given together with sugar."),
    saturatedFat: grams.optional().describe("Saturated fat in grams, part of fat (never more than fat)"),
    sodiumMg: z.number().nonnegative().optional().describe("Sodium in milligrams (not salt: 1 g of salt is about 400 mg of sodium)"),
    caffeineMg: z.number().nonnegative().optional().describe("Caffeine in milligrams, only for caffeine sources"),
  })
  .refine((m) => (m.sugar === undefined) === (m.addedSugar === undefined), {
    message: "sugar and addedSugar must be given together",
    path: ["addedSugar"],
  })
  .refine((m) => m.sugar === undefined || m.addedSugar === undefined || m.addedSugar <= m.sugar, {
    message: "addedSugar cannot exceed sugar",
    path: ["addedSugar"],
  })
  .refine((m) => m.saturatedFat === undefined || m.saturatedFat <= m.fat, {
    message: "saturatedFat cannot exceed fat",
    path: ["saturatedFat"],
  });

export const plannedFoodSchema = z.strictObject({
  name: z.string().trim().min(1),
  quantity: z.number().positive(),
  unit: z.string().trim().min(1).describe('Unit of the quantity, e.g. "g", "ml", "piece"'),
});

export const plannedMealSchema = z.strictObject({
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM (24-hour)")
    .describe("Local time of the meal, HH:MM (24-hour)"),
  title: z.string().trim().min(1),
  foods: z.array(plannedFoodSchema).min(1),
  macros: plannedMacrosSchema.describe("Estimated nutrients for the whole meal"),
});

export const plannedDaySchema = z.strictObject({
  meals: z.array(plannedMealSchema),
});

export const mealPlanSchema = z
  .strictObject({
    schemaVersion: z.literal(MEAL_PLAN_SCHEMA_VERSION),
    validFrom: z.iso.date().describe("First day the plan is active, YYYY-MM-DD"),
    days: z.strictObject({
      monday: plannedDaySchema,
      tuesday: plannedDaySchema,
      wednesday: plannedDaySchema,
      thursday: plannedDaySchema,
      friday: plannedDaySchema,
      saturday: plannedDaySchema,
      sunday: plannedDaySchema,
    }),
  })
  .meta({
    title: "Intake meal plan",
    description: "Weekly meal plan for Intake. Becomes active from validFrom onward.",
  });

export type PlannedMacros = z.infer<typeof plannedMacrosSchema>;
export type PlannedFood = z.infer<typeof plannedFoodSchema>;
export type PlannedMeal = z.infer<typeof plannedMealSchema>;
export type PlannedDay = z.infer<typeof plannedDaySchema>;
export type MealPlan = z.infer<typeof mealPlanSchema>;

/** JSON Schema of the meal plan file, for use outside Intake (e.g. in the Claude Fitness project). */
export function mealPlanJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(mealPlanSchema, { target: "draft-2020-12" }) as Record<string, unknown>;
}
