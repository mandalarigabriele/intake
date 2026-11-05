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
  name: z.string().trim().min(1).describe('Food, e.g. "Yogurt greco" or a free-text line such as "1 frutto"'),
  quantity: z.number().positive().optional(),
  unit: z.string().trim().min(1).optional().describe('Unit of the quantity, e.g. "g", "ml", "piece"'),
  note: z.string().trim().min(1).optional().describe('Preparation note, e.g. "a crudo"'),
});

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM (24-hour)")
  .optional()
  .describe("Local time of the meal, HH:MM (24-hour). Optional: without it Intake uses a default slot for the meal type");

const mealType = z
  .enum(MEAL_TYPES)
  .optional()
  .describe("Meal type used when logging. Optional: inferred from the title (colazione, pranzo, cena, spuntino) when missing");

const description = z.string().trim().min(1).optional().describe("Readable one-line summary of the meal");

export const fixedMealSchema = z.strictObject({
  title: z.string().trim().min(1),
  time,
  type: mealType,
  free: z.literal(false).optional(),
  description,
  foods: z.array(plannedFoodSchema).min(1),
  macros: plannedMacrosSchema
    .optional()
    .describe('Estimated nutrients for the whole meal. Needed for "Mangiato come previsto" to log complete values'),
});

export const freeMealSchema = z.strictObject({
  title: z.string().trim().min(1),
  time,
  type: mealType,
  free: z.literal(true).describe('A "free" meal with no planned foods (shown as "Libero")'),
  description,
});

export const plannedMealSchema = z.union([fixedMealSchema, freeMealSchema]);

export const plannedDaySchema = z.strictObject({
  label: z.string().trim().min(1).max(12).optional().describe('Short tag shown on the day tab, e.g. "dolce"'),
  note: z.string().trim().min(1).max(80).optional().describe('One-line note for the day, e.g. "pranzo in famiglia · cena libera"'),
  expectedProtein: z.number().nonnegative().optional().describe("Expected protein for the day in grams"),
  meals: z.array(plannedMealSchema),
});

export const mealPlanSchema = z
  .strictObject({
    schemaVersion: z.literal(MEAL_PLAN_SCHEMA_VERSION),
    validFrom: z.iso.date().describe("First day the plan is active, YYYY-MM-DD"),
    notes: z.array(z.string().trim().min(1)).optional().describe("General notes shown on the Piano page"),
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
export type FixedPlannedMeal = z.infer<typeof fixedMealSchema>;
export type MealTypeValue = (typeof MEAL_TYPES)[number];
export type PlannedDay = z.infer<typeof plannedDaySchema>;
export type MealPlan = z.infer<typeof mealPlanSchema>;

/** JSON Schema of the meal plan file, for use outside Intake (e.g. in the Claude Fitness project). */
export function mealPlanJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(mealPlanSchema, { target: "draft-2020-12" }) as Record<string, unknown>;
}
