/**
 * Captures raw responses of the read-only Nutrition MCP tools Intake relies on, plus the tool
 * list with its schemas, into apps/server/captures/ (gitignored: it contains real data).
 *
 * Usage: npm run capture -w @intake/server   (requires a connected Nutrition account)
 *
 * Copy a response into src/parsers/__fixtures__/ (with IDs replaced) before changing a parser.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { NotConnectedError } from "../src/mcp/connection.js";
import { parseClock } from "../src/parsers/index.js";
import { createServices } from "../src/services.js";

const outDir = resolve(import.meta.dirname, "../captures");

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const services = createServices(loadConfig());

try {
  mkdirSync(outDir, { recursive: true });
  const nutrition = services.nutrition;

  const tools = await nutrition.listTools();
  writeFileSync(join(outDir, "tools.json"), JSON.stringify(tools, null, 2));
  console.log(`tools.json: ${tools.length} tools, ${tools.filter((t) => t.outputSchema).length} with an output schema`);

  const clock = await nutrition.callTool("get_current_time");
  const today = parseClock(clock.text).value.localDate;
  const yesterday = shiftDate(today, -1);

  const calls: Array<[file: string, tool: string, args: Record<string, unknown>]> = [
    ["current-time", "get_current_time", {}],
    ["profile", "get_profile", {}],
    ["goals", "get_nutrition_goals", {}],
    ["meals-today-full", "get_meals_today", { detail: "full" }],
    ["meals-yesterday-full", "get_meals_by_date", { date: yesterday, detail: "full" }],
    ["water-today", "get_water_today", {}],
    ["water-yesterday", "get_water_by_date", { date: yesterday }],
    ["weight-today", "get_weight_today", {}],
    ["weight-range-30d", "get_weight_by_date_range", { start_date: shiftDate(today, -30), end_date: today }],
    ["weight-trends", "get_weight_trends", {}],
    ["nutrition-summary-7d", "get_nutrition_summary", { start_date: shiftDate(today, -6), end_date: today }],
    ["saved-meals", "get_saved_meals", {}],
  ];

  for (const [file, tool, args] of calls) {
    try {
      const result = await nutrition.callTool(tool, args);
      writeFileSync(join(outDir, `${file}.json`), JSON.stringify({ tool, args, result: result.raw }, null, 2));
      writeFileSync(join(outDir, `${file}.txt`), result.text + "\n");
      const flags = [result.isError ? "ERROR" : "ok", result.structured ? "structuredContent" : "text only"];
      console.log(`${file}: ${flags.join(", ")}`);
    } catch (error) {
      console.error(`${file}: failed – ${(error as Error).message}`);
    }
  }
  console.log(`\nWritten to ${outDir}`);
} catch (error) {
  if (error instanceof NotConnectedError) {
    console.error("Nutrition account not connected. Start the server and open /connect/nutrition first.");
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await services.close();
}
