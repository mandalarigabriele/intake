import type { ClockInfo, NutritionGoals } from "@intake/shared";
import {
  parseClock,
  parseGoalProgress,
  parseGoals,
  parseMeals,
  type GoalProgress,
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

/** Typed, parsed access to the Nutrition MCP tools Intake uses. */
export class NutritionApi {
  constructor(
    private readonly caller: ToolCaller,
    private readonly onWarnings: WarningLogger = () => {},
  ) {}

  mealsByDate(date: string): Promise<ParsedMeals> {
    return this.callText("get_meals_by_date", { date, detail: "full" }, parseMeals);
  }

  goals(): Promise<NutritionGoals> {
    return this.callText("get_nutrition_goals", {}, parseGoals);
  }

  clock(): Promise<ClockInfo> {
    return this.callText("get_current_time", {}, parseClock);
  }

  /** Daily goals and totals (including water) from structured content. */
  goalProgress(date: string): Promise<GoalProgress> {
    return this.callStructured("get_goal_progress", { date }, parseGoalProgress);
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
