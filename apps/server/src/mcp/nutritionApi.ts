import type { ClockInfo, NutritionGoals } from "@intake/shared";
import {
  parseClock,
  parseGoalProgress,
  parseGoals,
  parseMeals,
  parseNutritionSummary,
  parseWeightTrends,
  type GoalProgress,
  type NutritionSummary,
  type WeightTrend,
  type Parsed,
  type ParsedMeals,
} from "../parsers/index.js";
import type { ToolResult } from "./connection.js";

/** Fields accepted by log_meal / update_meal (snake_case as the tool expects). */
export interface MealWriteFields {
  description?: string;
  meal_type?: string;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  saturated_fat_g?: number;
  fiber_g?: number;
  sugar_g?: number;
  added_sugar_g?: number;
  caffeine_mg?: number;
  sodium_mg?: number;
  logged_at?: string;
  idempotency_key?: string;
  items?: Array<Record<string, unknown>>;
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/** The tool returned an error result (e.g. invalid arguments). */
export class ToolError extends Error {
  constructor(
    readonly tool: string,
    message: string,
  ) {
    super(`${tool}: ${message}`);
    this.name = "ToolError";
  }
}

export interface ToolCaller {
  callTool(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
}

type WarningLogger = (tool: string, warnings: string[]) => void;

export interface NutritionApiOptions {
  /** How long identical read calls are answered from memory (default 30 s). */
  cacheTtlMs?: number;
  /** How long the profile timezone is reused to compute the clock locally (default 1 h). */
  timezoneTtlMs?: number;
  now?: () => Date;
}

/** Tools that change data; any of them clears the read cache. */
const WRITE_TOOL = /^(log_|update_|delete_|save_|set_|bulk_)/;

/** Local date and time in an IANA timezone, as get_current_time would report them. */
export function clockIn(timezone: string, at: Date): ClockInfo {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return {
    timezone,
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localTime: `${parts.hour}:${parts.minute}:${parts.second}`,
    utc: at.toISOString(),
  };
}

/**
 * Typed, parsed access to the Nutrition MCP tools Intake uses.
 *
 * The Nutrition server allows 60 requests per minute, so identical reads within a few seconds are
 * served from a short in-memory cache (concurrent identical calls share one request) and the clock
 * is computed locally from the profile timezone. Nothing is persisted; any write clears the cache.
 */
export class NutritionApi {
  private readonly cache = new Map<string, { expires: number; result: Promise<ToolResult> }>();
  private timezone: { name: string; fetchedAt: number } | null = null;
  private readonly cacheTtlMs: number;
  private readonly timezoneTtlMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly caller: ToolCaller,
    private readonly onWarnings: WarningLogger = () => {},
    options: NutritionApiOptions = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
    this.timezoneTtlMs = options.timezoneTtlMs ?? 60 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
  }

  mealsByDate(date: string): Promise<ParsedMeals> {
    return this.callText("get_meals_by_date", { date, detail: "full" }, parseMeals);
  }

  goals(): Promise<NutritionGoals> {
    return this.callText("get_nutrition_goals", {}, parseGoals);
  }

  /** Current date and time in the Nutrition profile's timezone (asks the server at most once an hour). */
  async clock(): Promise<ClockInfo> {
    const now = this.now();
    if (this.timezone && now.getTime() - this.timezone.fetchedAt < this.timezoneTtlMs) {
      return clockIn(this.timezone.name, now);
    }
    const clock = await this.callText("get_current_time", {}, parseClock);
    this.timezone = { name: clock.timezone, fetchedAt: now.getTime() };
    return clock;
  }

  /** Daily goals and totals (including water) from structured content. */
  goalProgress(date: string): Promise<GoalProgress> {
    return this.callStructured("get_goal_progress", { date }, parseGoalProgress);
  }

  /** Daily totals for a date range (at most 92 days), from structured content. */
  summary(startDate: string, endDate: string): Promise<NutritionSummary> {
    return this.callStructured("get_nutrition_summary", { start_date: startDate, end_date: endDate }, parseNutritionSummary);
  }

  /** Daily weigh-ins over `days` days ending on `endDate`, from structured content. */
  weightTrends(days: number, endDate: string): Promise<WeightTrend> {
    return this.callStructured("get_weight_trends", { days, end_date: endDate }, parseWeightTrends);
  }

  /** Logs a weigh-in now, in kilograms. */
  async logWeight(weightKg: number, idempotencyKey: string): Promise<void> {
    await this.call("log_weight", { weight: weightKg, unit: "kg", idempotency_key: idempotencyKey });
  }

  /** Meals of a date range (at most 31 days), with full detail. */
  mealsByRange(startDate: string, endDate: string): Promise<ParsedMeals> {
    return this.callText("get_meals_by_date_range", { start_date: startDate, end_date: endDate, detail: "full" }, parseMeals);
  }

  async updateMeal(id: string, fields: MealWriteFields): Promise<void> {
    await this.call("update_meal", { id, ...fields });
  }

  async deleteMeal(id: string): Promise<void> {
    await this.call("delete_meal", { id });
  }

  /** Saves a logged meal as a favorite ("saved meal") on Nutrition. */
  async saveMeal(name: string, fromMealId: string): Promise<void> {
    await this.call("save_meal", { name, from_meal_id: fromMealId });
  }

  /** Logs a meal; returns its id when the response carries one. */
  async logMeal(fields: MealWriteFields & { description: string; meal_type: string }): Promise<{ id: string | null }> {
    const result = await this.call("log_meal", { ...fields });
    return { id: UUID.exec(result.text)?.[0] ?? null };
  }

  /** Logs water now. The idempotency key makes a retried request safe. */
  async addWater(amountMl: number, idempotencyKey: string): Promise<void> {
    await this.call("log_water", { amount_ml: amountMl, idempotency_key: idempotencyKey });
  }

  private async call(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (WRITE_TOOL.test(tool)) {
      this.cache.clear();
      try {
        return await this.request(tool, args);
      } finally {
        this.cache.clear();
      }
    }

    const key = `${tool} ${JSON.stringify(args)}`;
    const now = this.now().getTime();
    const cached = this.cache.get(key);
    if (cached && cached.expires > now) return cached.result;

    const result = this.request(tool, args);
    this.cache.set(key, { expires: now + this.cacheTtlMs, result });
    // Failures are not cached
    result.catch(() => {
      if (this.cache.get(key)?.result === result) this.cache.delete(key);
    });
    return result;
  }

  private async request(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    const result = await this.caller.callTool(tool, args);
    if (result.isError) throw new ToolError(tool, result.text || "tool returned an error");
    return result;
  }

  private async callText<T>(tool: string, args: Record<string, unknown>, parse: (text: string) => Parsed<T>): Promise<T> {
    return this.report(tool, parse((await this.call(tool, args)).text));
  }

  private async callStructured<T>(tool: string, args: Record<string, unknown>, parse: (value: unknown) => Parsed<T>): Promise<T> {
    return this.report(tool, parse((await this.call(tool, args)).structured));
  }

  private report<T>(tool: string, { value, warnings }: Parsed<T>): T {
    if (warnings.length > 0) this.onWarnings(tool, warnings);
    return value;
  }
}
