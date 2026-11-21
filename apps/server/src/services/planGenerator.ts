import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { Message, MessageParam } from "@anthropic-ai/sdk/resources/messages";
import {
  GENERATED_MEAL_JSON_SCHEMA,
  GENERATED_PLAN_JSON_SCHEMA,
  WEEKDAYS,
  generatedMealSchema,
  toPlannedMeal,
  type MealPlan,
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

  /** One structured-output request, streamed; returns the parsed JSON and the raw text. */
  private async ask(messages: MessageParam[], schema: unknown, what: string, onText?: (streamed: string) => void): Promise<{ json: unknown; text: string }> {
    const model = this.options.model();
    let streamed = "";
    let response: Message;
    try {
      const stream = this.client.stream({
        model,
        max_tokens: MAX_TOKENS,
        system: system(this.options.language?.() ?? "it"),
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
