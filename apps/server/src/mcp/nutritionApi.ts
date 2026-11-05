import type { ClockInfo, NutritionGoals } from "@intake/shared";
import { parseClock, parseGoals, parseMeals, type Parsed, type ParsedMeals } from "../parsers/index.js";
import type { ToolResult } from "./connection.js";

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
    return this.call("get_meals_by_date", { date, detail: "full" }, parseMeals);
  }

  goals(): Promise<NutritionGoals> {
    return this.call("get_nutrition_goals", {}, parseGoals);
  }

  clock(): Promise<ClockInfo> {
    return this.call("get_current_time", {}, parseClock);
  }

  private async call<T>(tool: string, args: Record<string, unknown>, parse: (text: string) => Parsed<T>): Promise<T> {
    const result = await this.caller.callTool(tool, args);
    if (result.isError) throw new ToolError(tool, result.text || "tool returned an error");
    const { value, warnings } = parse(result.text);
    if (warnings.length > 0) this.onWarnings(tool, warnings);
    return value;
  }
}
