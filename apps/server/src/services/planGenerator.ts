import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Message, MessageParam } from "@anthropic-ai/sdk/resources/messages";
import {
  DAY_ALTERNATIVE_JSON_SCHEMA,
  GENERATED_MACROS_JSON_SCHEMA,
  GENERATED_MEAL_JSON_SCHEMA,
  GENERATED_PLAN_JSON_SCHEMA,
  WEEKDAYS,
  generatedMacrosSchema,
  generatedMealSchema,
  toPlannedMeal,
  dayAlternativeSchema,
  type DayAlternativeAnswer,
  type DayBudget,
  type PlannedFoodNutrients,
  type MealPlan,
  type PlannedFood,
  type PlannedMeal,
  type Weekday,
  checkPlan,
  describeProblems,
  generatedPlanSchema,
  toMealPlan,
  type Language,
  type PlanDraft,
  type PlanPreferences,
  type PlanTargets,
} from "@intake/shared";
import { LANGUAGE_NAMES, RecognitionError, failureOf } from "./mealRecognition.js";

export type StreamingClient = Pick<Anthropic["messages"], "stream">;

/** What the plan is built from; only these are sent to the AI. */
export interface PlanGeneratorInput {
  preferences: PlanPreferences;
  targets: PlanTargets;
  /** From Il tuo fabbisogno, when filled in. */
  profile: { sex: string; age: number; heightCm: number; weightKg: number | null; goal: string } | null;
  /** Descriptions of recent meals, only with "Impara dai miei pasti". */
  recentMeals: string[];
  validFrom: string;
}

export interface PlanGeneratorOptions {
  apiKey: string;
  /** Impostazioni › Funzioni › Modello per i piani. */
  model: () => string;
  client?: StreamingClient;
  language?: () => Language;
  log?: { info(details: object, message: string): void; warn(details: object, message: string): void };
}

/**
 * A week is long: 7 days × up to 7 meals with their foods. Thinking counts toward max_tokens, so the effort is low
 * (the answer is structured and the checks catch mistakes) and the room is large; at 32 000 tokens with medium effort
 * a long list of notes could run out before the JSON was complete.
 */
const MAX_TOKENS = 64_000;
const TIMEOUT_MS = 10 * 60_000;

const DIETS: Record<string, string> = { omnivore: "omnivore", vegetarian: "vegetarian (no meat, no fish)", pescatarian: "pescatarian (fish yes, no meat)", vegan: "vegan (no animal products)" };

const system = (language: Language) =>
  [
    "You write a one-week meal plan for a healthy adult who tracks food in a personal diary, using realistic home cooking.",
    "Each day must reach the daily targets: calories within 5% and at least the protein; keep carbohydrates, fat and fiber close to their targets.",
    "Give every food a quantity (grams or millilitres for anything weighed, a count unit such as pz for eggs or fruit) and estimate the nutrients of each meal from standard food composition tables (CREA, USDA).",
    "Follow the constraints strictly: never use an allergen or intolerance, avoid disliked foods, respect the diet, the variety limits, the cooking time and the free meals (free: true, no foods, all nutrients zero).",
    "Spread the calories sensibly across the slots (snacks lighter than lunch and dinner) and repeat ingredients across the week to keep shopping simple, without repeating whole dishes beyond the limits.",
    "Do not give medical advice; this is a food plan for a healthy adult.",
    `Write every dish, food and note in ${LANGUAGE_NAMES[language]}.`,
  ].join(" ");

const dayAlternativeSystemFor = (language: Language) =>
  [
    "You estimate the nutrients of the foods of one meal for a healthy adult, from standard food composition tables.",
    "Give each food's nutrients for the amount it is given, never per 100 g. Keep the sugars consistent: added sugar is part of sugar and whole foods have none.",
    `Write nothing but the requested values; any text is in ${LANGUAGE_NAMES[language]}.`,
  ].join(" ");

const splitFoodsSchema = z.object({
  foods: z.array(
    z.object({
      kcal: z.number().nonnegative(),
      protein: z.number().nonnegative(),
      carbs: z.number().nonnegative(),
      fat: z.number().nonnegative(),
      fiber: z.number().nonnegative(),
      sugar: z.number().nonnegative(),
      addedSugar: z.number().nonnegative(),
    }),
  ),
});

const SPLIT_FOODS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["foods"],
  properties: {
    foods: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kcal", "protein", "carbs", "fat", "fiber", "sugar", "addedSugar"],
        properties: {
          kcal: { type: "number" },
          protein: { type: "number", description: "grams" },
          carbs: { type: "number", description: "grams" },
          fat: { type: "number", description: "grams" },
          fiber: { type: "number", description: "grams" },
          sugar: { type: "number", description: "grams" },
          addedSugar: { type: "number", description: "grams, part of sugar" },
        },
      },
    },
  },
} as const;

const splitDaySchema = z.object({
  meals: z.array(z.object({ key: z.number().int(), foods: splitFoodsSchema.shape.foods })),
});

const SPLIT_DAY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["meals"],
  properties: {
    meals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "foods"],
        properties: {
          key: { type: "number", description: "the key of the meal, as given" },
          foods: SPLIT_FOODS_JSON_SCHEMA.properties.foods,
        },
      },
    },
  },
} as const;

/** The WHO healthy diet guidance the day's alternative follows (it is a food suggestion for a healthy adult, not medical advice). */
const dayAlternativeSystem = (language: Language) =>
  [
    "You suggest one alternative dish for a single meal of today, for a healthy adult who tracks food in a personal diary, using realistic home cooking.",
    "Aim for the calories and protein of the budget you are given (within about 10%) and keep carbohydrates, fat and fiber near theirs, so the whole day stays on its goals.",
    "Follow the WHO healthy diet guidance: free sugars under 10% of energy, saturated fat under 10% of energy, no industrial trans fat, little salt (sodium under 2 g a day overall), at least 400 g of fruit and vegetables a day overall, fiber from whole grains and legumes, mostly unsaturated fats, and little processed meat.",
    "Keep the week in mind: if the week so far is under or over its goals, lean slightly the other way without going outside the budget.",
    "Obey the constraints strictly: never use an allergen or intolerance, avoid disliked foods, respect the diet and the cooking time. If the person lists ingredients they have, use them as the base.",
    "Give every food a quantity (grams or millilitres for anything weighed, pz for pieces) and the nutrients of that quantity, from standard composition tables (CREA, USDA). Do not give medical advice.",
    `Write the dish, the foods and the reason in ${LANGUAGE_NAMES[language]}.`,
  ].join(" ");

function userMessage({ preferences: p, targets, profile, recentMeals }: PlanGeneratorInput): string {
  const data = {
    dailyTargets: targets,
    slots: p.slots.map(({ id, label, time, type }) => ({ id, label, time, type })),
    freeMeals: p.freeMeals,
    constraints: {
      diet: DIETS[p.diet],
      allergiesAndIntolerances: p.allergies,
      dislikedFoods: p.dislikes,
      sameDishAtMostPerWeek: p.maxSameMealPerWeek,
      sameBreakfastEveryDayIsFine: p.sameBreakfastOk,
      neverTheSameDishTwiceInADay: p.noRepeatSameDay,
      maxCookingMinutesOnWeekdays: p.cookingMinutes,
      lunchCanBeYesterdaysDinnerLeftovers: p.leftovers,
      seasonalProduce: p.seasonal,
    },
    person: profile,
  };
  const notes = p.notes.trim();
  const habits = recentMeals.length ? `\n\nWhat I usually eat (recent meals):\n- ${recentMeals.join("\n- ")}` : "";
  return `Plan my week.\n${JSON.stringify(data, null, 2)}${notes ? `\n\nMy notes: ${notes}` : ""}${habits}`;
}

/**
 * "Genera con l'IA" (Piano): asks Claude for a week of meals with a structured output, streamed (a week takes a
 * while), converts it to an Intake plan and checks it. When a day misses its targets or a constraint is broken, the
 * problems go back to the model once for a corrected plan; what is still wrong is returned with the draft.
 */
export class PlanGenerator {
  private readonly client: StreamingClient;

  constructor(private readonly options: PlanGeneratorOptions) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, timeout: TIMEOUT_MS }).messages;
  }

  async generate(input: PlanGeneratorInput, onProgress: (round: number, daysDone: number) => void = () => {}): Promise<PlanDraft> {
    const messages: MessageParam[] = [{ role: "user", content: userMessage(input) }];
    let draft = await this.round(input, messages, 1, onProgress);
    const problems = describeProblems(draft.draft.checks, input.targets);
    if (problems.length === 0) return draft.draft;
    // One correction round with the problems found by the checks
    messages.push({ role: "assistant", content: draft.text });
    messages.push({ role: "user", content: `The plan has these problems:\n- ${problems.join("\n- ")}\nAnswer with the complete corrected plan, fixing them and keeping the rest.` });
    draft = await this.round(input, messages, 2, onProgress);
    return draft.draft;
  }

  /**
   * "Sostituisci": another dish for one meal of a draft, in the same slot, close to its calories and protein so the day
   * stays on target, different from the other dishes of the week. Small and quick: one meal, no correction round.
   */
  async replaceMeal(input: { preferences: PlanPreferences; targets: PlanTargets; plan: MealPlan; day: Weekday; index: number; note: string }): Promise<PlannedMeal> {
    const current = input.plan.days[input.day].meals[input.index];
    if (!current) throw new RecognitionError("failed", "No such meal");
    const others = WEEKDAYS.flatMap((d) => input.plan.days[d].meals.map((m) => m.description).filter(Boolean)) as string[];
    const macros = "macros" in current && current.macros ? current.macros : null;
    const request = {
      replace: { day: input.day, meal: current.title, time: current.time, current: current.description ?? null, kcal: macros?.kcal ?? null, protein: macros?.protein ?? null },
      dailyTargets: input.targets,
      constraints: {
        diet: DIETS[input.preferences.diet],
        allergiesAndIntolerances: input.preferences.allergies,
        dislikedFoods: input.preferences.dislikes,
        maxCookingMinutesOnWeekdays: input.preferences.cookingMinutes,
      },
      dishesAlreadyInTheWeek: others,
    };
    const wish = input.note.trim();
    const text = `Replace this one meal with a different dish of about the same calories and protein, not already in the week.\n${JSON.stringify(request, null, 2)}${wish ? `\n\nMy wish for it: ${wish}` : ""}\nAnswer with the meal only; use "${current.title}" as the slot.`;
    const answer = await this.ask([{ role: "user", content: text }], GENERATED_MEAL_JSON_SCHEMA, "replace");
    const parsed = generatedMealSchema.safeParse(answer.json);
    if (!parsed.success) throw new RecognitionError("unreadable", "Claude API answer did not match the meal schema");
    return toPlannedMeal({ ...parsed.data, free: false }, { title: current.title, time: current.time, type: current.type });
  }

  /**
   * "Alternativa" in the Timeline: another dish for one planned meal of today only, sized on what is left of the day's
   * goals and checked against the week so far. Nothing is saved: the person confirms it on the meal screen.
   */
  async suggestForDay(input: {
    preferences: PlanPreferences;
    meal: { title: string; time: string; currentDish: string | null };
    goals: Record<keyof DayBudget, number | null>;
    eaten: Record<keyof DayBudget, number>;
    budget: DayBudget;
    otherMealsLeft: Array<{ title: string; kcal: number | null; protein: number | null }>;
    week: { days: number; avgKcal: number; avgProtein: number } | null;
    note: string;
  }): Promise<DayAlternativeAnswer> {
    const p = input.preferences;
    const request = {
      replace: { meal: input.meal.title, time: input.meal.time, currentDish: input.meal.currentDish },
      budgetForThisMeal: input.budget,
      dailyGoals: input.goals,
      eatenSoFarToday: input.eaten,
      otherPlannedMealsStillToEat: input.otherMealsLeft,
      weekSoFar: input.week,
      constraints: { diet: DIETS[p.diet], allergiesAndIntolerances: p.allergies, dislikedFoods: p.dislikes, maxCookingMinutesOnWeekdays: p.cookingMinutes },
    };
    const wish = input.note.trim();
    const text = `Suggest one alternative dish for this meal, only for today.\n${JSON.stringify(request, null, 2)}${wish ? `\n\nWhat I have or prefer: ${wish}` : ""}`;
    const answer = await this.ask([{ role: "user", content: text }], DAY_ALTERNATIVE_JSON_SCHEMA, "day alternative", undefined, dayAlternativeSystem(this.options.language?.() ?? "it"));
    const parsed = dayAlternativeSchema.safeParse(answer.json);
    if (!parsed.success) throw new RecognitionError("unreadable", "Claude API answer did not match the alternative schema");
    return parsed.data;
  }

  /**
   * "Ricalcola con l'IA": the nutrients of a meal estimated from its foods and amounts (standard composition tables).
   * One small request; the answer is never saved by itself, the person confirms it in the editor.
   */
  async estimateMacros(input: { description: string; foods: PlannedFood[] }): Promise<{ kcal: number; protein: number; carbs: number; fat: number; fiber: number; sugar: number; addedSugar: number }> {
    const list = input.foods.map((f) => ({ name: f.name, ...(f.quantity !== undefined ? { amount: f.quantity, unit: f.unit ?? "" } : {}) }));
    const text = `Estimate the nutrients of this whole meal from its foods and amounts, using standard food composition tables (CREA, USDA). Foods without an amount are a normal portion.\n${JSON.stringify({ dish: input.description || undefined, foods: list }, null, 2)}\nAnswer with the nutrients only.`;
    const answer = await this.ask([{ role: "user", content: text }], GENERATED_MACROS_JSON_SCHEMA, "estimate");
    const parsed = generatedMacrosSchema.safeParse(answer.json);
    if (!parsed.success) throw new RecognitionError("unreadable", "Claude API answer did not match the nutrients schema");
    return parsed.data;
  }

  /**
   * "Dividi in alimenti con l'IA" for a plan saved before per-food values: the nutrients of each food estimated from its
   * amount, and scaled so the foods add up to the meal's totals already in the plan (the totals stay the reference).
   * Nothing is saved here; the person confirms in the app.
   */
  async splitFoodValues(input: { description: string; foods: PlannedFood[]; totals: { kcal: number; protein: number; carbs: number; fat: number; fiber: number; sugar?: number; addedSugar?: number } }): Promise<PlannedFoodNutrients[]> {
    const list = input.foods.map((f) => ({ name: f.name, ...(f.quantity !== undefined ? { amount: f.quantity, unit: f.unit ?? "" } : {}) }));
    const text = `Estimate the nutrients of each food of this meal, for the amount given (not per 100 g), from standard food composition tables (CREA, USDA). Foods without an amount are a normal portion.\n${JSON.stringify({ dish: input.description || undefined, foods: list, mealTotals: input.totals }, null, 2)}\nAnswer with one entry per food, in the same order. The sum of the foods should match the meal totals; keep them close.`;
    const answer = await this.ask([{ role: "user", content: text }], SPLIT_FOODS_JSON_SCHEMA, "split food values", undefined, dayAlternativeSystemFor(this.options.language?.() ?? "it"));
    const parsed = splitFoodsSchema.safeParse(answer.json);
    if (!parsed.success || parsed.data.foods.length !== input.foods.length) throw new RecognitionError("unreadable", "Claude API answer did not match the food split");
    return parsed.data.foods;
  }

  /**
   * "Dividi tutta la settimana in alimenti": the food values of every meal of one day that still lacks them, in one
   * request (one request per day, not per meal). Each meal's foods are estimated and must add up to its totals.
   */
  async splitDayFoodValues(meals: Array<{ key: number; description: string; foods: PlannedFood[]; totals: { kcal: number; protein: number; carbs: number; fat: number; fiber: number; sugar?: number; addedSugar?: number } }>): Promise<Array<{ key: number; foods: PlannedFoodNutrients[] }>> {
    const payload = meals.map((m) => ({ key: m.key, dish: m.description || undefined, foods: m.foods.map((f) => ({ name: f.name, ...(f.quantity !== undefined ? { amount: f.quantity, unit: f.unit ?? "" } : {}) })), mealTotals: m.totals }));
    const text = `Estimate the nutrients of each food of these meals, for the amount given (not per 100 g), from standard food composition tables (CREA, USDA). Foods without an amount are a normal portion. For each meal answer with its key and one entry per food, in the same order. The foods of each meal should add up to that meal's totals; keep them close.\n${JSON.stringify(payload, null, 2)}`;
    const answer = await this.ask([{ role: "user", content: text }], SPLIT_DAY_JSON_SCHEMA, "split day food values", undefined, dayAlternativeSystemFor(this.options.language?.() ?? "it"));
    const parsed = splitDaySchema.safeParse(answer.json);
    if (!parsed.success) throw new RecognitionError("unreadable", "Claude API answer did not match the day split");
    const byKey = new Map(parsed.data.meals.map((m) => [m.key, m.foods]));
    return meals.map((m) => {
      const foods = byKey.get(m.key);
      if (!foods || foods.length !== m.foods.length) throw new RecognitionError("unreadable", "Claude API answer lost a meal or a food of the day split");
      return { key: m.key, foods };
    });
  }

  /** One structured-output request, streamed; returns the parsed JSON and the raw text. */
  private async ask(messages: MessageParam[], schema: unknown, what: string, onText?: (streamed: string) => void, systemText?: string): Promise<{ json: unknown; text: string }> {
    const model = this.options.model();
    let streamed = "";
    let response: Message;
    try {
      const stream = this.client.stream({
        model,
        max_tokens: MAX_TOKENS,
        system: systemText ?? system(this.options.language?.() ?? "it"),
        output_config: { effort: "low", format: { type: "json_schema", schema: schema as Record<string, unknown> } },
        messages,
      });
      stream.on("text", (delta) => {
        streamed += delta;
        onText?.(streamed);
      });
      response = await stream.finalMessage();
    } catch (error) {
      const why = error instanceof APIError ? `Claude API error ${error.status ?? "-"} ${error.type ?? ""}: ${error.message}` : `Claude API not reachable: ${error instanceof Error ? error.message : String(error)}`;
      throw new RecognitionError(failureOf(error), why);
    }
    this.options.log?.info({ model, what, stopReason: response.stop_reason, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }, "plan generation");
    if (response.stop_reason === "refusal") throw new RecognitionError("refused", "Claude declined to write the plan");
    if (response.stop_reason === "max_tokens") throw new RecognitionError("unreadable", "Claude API answer was cut at max_tokens");
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    try {
      return { json: JSON.parse(text), text };
    } catch {
      throw new RecognitionError("unreadable", "Claude API answer is not JSON");
    }
  }

  private async round(input: PlanGeneratorInput, messages: MessageParam[], round: number, onProgress: (round: number, daysDone: number) => void): Promise<{ draft: PlanDraft; text: string }> {
    onProgress(round, 0);
    // Each day object carries one "day" key: a cheap count of the days written so far
    const { json, text } = await this.ask(messages, GENERATED_PLAN_JSON_SCHEMA, `plan round ${round}`, (streamed) => onProgress(round, Math.min(7, (streamed.match(/"day"\s*:/g) ?? []).length)));
    const parsed = generatedPlanSchema.safeParse(json);
    if (!parsed.success) throw new RecognitionError("unreadable", "Claude API answer did not match the plan schema");
    let plan;
    try {
      plan = toMealPlan(parsed.data, input.preferences.slots, input.validFrom);
    } catch {
      throw new RecognitionError("unreadable", "Claude API answer is not a valid plan");
    }
    onProgress(round, 7);
    return { draft: { plan, checks: checkPlan(plan, input.targets, input.preferences), targets: input.targets, rounds: round }, text };
  }
}
