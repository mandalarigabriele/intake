import type { Meal, MealItem, Nutrients } from "@intake/shared";
import { ParseError, emptyNutrients, leadingNumber, parseNutrientTokens, type Parsed } from "./common.js";

/**
 * Parses get_meals_today / get_meals_by_date output requested with `detail: "full"`.
 *
 * Format (one block per meal, blocks separated by a line with "---"):
 *
 *   Times are local (Europe/Rome).
 *
 *   ID: 191042da-…
 *   Time: 2026-11-05 08:03
 *   Type: breakfast
 *   Description: …
 *   Calories: 438
 *   Protein: 28.2g
 *   Sugar: 29.5g (0g added)
 *   Caffeine: 63 mg
 *   Items:
 *     1. Banana — 120 g — 107 kcal · P 1.3 g · … · sugar 14.7 g (0 added)
 *
 * The compact format truncates descriptions and has no items, so Intake always asks for "full".
 * get_meals_by_date_range uses the same blocks, grouped under "## date" headings and "===" separators.
 */

export interface ParsedMeals {
  timezone: string | null;
  meals: Meal[];
}

const EMPTY = /^No meals (?:logged|found)\b/i;
const TIMEZONE = /^Times are local \(([^)]+)\)\.?$/;
const FIELD = /^([A-Z][A-Za-z ]*?):\s?(.*)$/;
const ITEM = /^\s+\d+\.\s+(.*)$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/;
const SUGAR = /^(\d+(?:\.\d+)?)\s*g?(?:\s*\((\d+(?:\.\d+)?)\s*g?\s+added\))?/;

/** Header fields that hold a single nutrient. */
const NUTRIENT_FIELDS: Record<string, keyof Nutrients> = {
  Calories: "kcal",
  Protein: "protein",
  Carbs: "carbs",
  Fat: "fat",
  "Saturated fat": "saturatedFat",
  "Trans fat": "transFat",
  Fiber: "fiber",
  Alcohol: "alcohol",
  Caffeine: "caffeineMg",
  Sodium: "sodiumMg",
};

// "Sources" (where each nutrient figure came from) is informational and not used
const TEXT_FIELDS = new Set(["ID", "Time", "Type", "Description", "Notes", "Sugar", "Items", "Sources"]);

export function parseMeals(text: string): Parsed<ParsedMeals> {
  const warnings: string[] = [];
  const trimmed = text.trim();
  let timezone: string | null = null;

  const lines = trimmed.split(/\r?\n/);
  const tzMatch = TIMEZONE.exec(lines[0]?.trim() ?? "");
  if (tzMatch) {
    timezone = tzMatch[1]!;
    lines.shift();
  }

  const body = lines.join("\n").trim();
  if (body === "" || EMPTY.test(body) || EMPTY.test(trimmed)) {
    return { value: { timezone, meals: [] }, warnings };
  }

  // get_meals_by_date_range groups days under "## YYYY-MM-DD (N meals)" headings separated by "==="
  const blocks = body
    .replace(/^##\s+\d{4}-\d{2}-\d{2}.*$/gm, "")
    .split(/^\s*(?:---|===)\s*$/m)
    .map((block) => block.trim())
    .filter(Boolean);
  const meals = blocks.map((block, index) => parseMealBlock(block, index, warnings));
  return { value: { timezone, meals }, warnings };
}

function parseMealBlock(block: string, index: number, warnings: string[]): Meal {
  const fields = new Map<string, string>();
  const itemLines: string[] = [];
  let inItems = false;
  let lastField: string | null = null;

  for (const line of block.split("\n")) {
    if (line.trim() === "") continue;

    const item = ITEM.exec(line);
    if (inItems && item) {
      itemLines.push(item[1]!);
      continue;
    }

    const field = FIELD.exec(line);
    if (field && (TEXT_FIELDS.has(field[1]!) || field[1]! in NUTRIENT_FIELDS)) {
      const [, key, value] = field as unknown as [string, string, string];
      inItems = key === "Items";
      fields.set(key, value.trim());
      lastField = key;
      continue;
    }

    if (field && !line.startsWith(" ")) {
      warnings.push(`meal #${index + 1}: unknown field "${field[1]}"`);
      inItems = false;
      lastField = null;
      continue;
    }

    // A line that is neither a known field nor an item continues the previous text field
    if (lastField === "Description" || lastField === "Notes") {
      fields.set(lastField, `${fields.get(lastField)}\n${line.trim()}`);
    } else {
      warnings.push(`meal #${index + 1}: unrecognized line "${line.trim()}"`);
    }
  }

  const id = fields.get("ID");
  if (!id) throw new ParseError(`meal #${index + 1} has no ID`, block);

  const dateTime = DATE_TIME.exec(fields.get("Time") ?? "");
  if (!dateTime) throw new ParseError(`meal ${id} has no valid Time`, block);

  const context = `meal ${id}`;
  const nutrients = emptyNutrients();
  for (const [label, key] of Object.entries(NUTRIENT_FIELDS)) {
    const raw = fields.get(label);
    if (raw === undefined) continue;
    const value = leadingNumber(raw);
    if (value === null && ["kcal", "protein", "carbs", "fat"].includes(key)) {
      warnings.push(`${context}: ${label} is not a number ("${raw}")`);
      continue;
    }
    nutrients[key] = value as never;
  }

  const sugar = fields.get("Sugar");
  if (sugar !== undefined) {
    const match = SUGAR.exec(sugar.trim());
    if (match) {
      nutrients.sugar = Number(match[1]);
      nutrients.addedSugar = match[2] === undefined ? null : Number(match[2]);
    } else if (leadingNumber(sugar) !== null) {
      warnings.push(`${context}: unrecognized Sugar value "${sugar}"`);
    }
  }

  return {
    id,
    date: dateTime[1]!,
    time: dateTime[2]!,
    type: fields.get("Type") ?? "",
    description: fields.get("Description") ?? "",
    notes: fields.get("Notes") || null,
    nutrients,
    items: itemLines.map((line, i) => parseItem(line, `${context} item ${i + 1}`, warnings)).filter(
      (item): item is MealItem => item !== null,
    ),
  };
}

const QUANTITY = /^~?(\d+(?:\.\d+)?)\s*(.*)$/;

/** "Banana — 120 g — 107 kcal · P 1.3 g · …". Names may contain " — ", so split from the right. */
function parseItem(line: string, context: string, warnings: string[]): MealItem | null {
  const parts = line.split(" — ");
  if (parts.length < 3) {
    warnings.push(`${context}: unrecognized item line "${line}"`);
    return null;
  }
  const nutrientText = parts.pop()!;
  const quantityText = parts.pop()!.trim();
  const name = parts.join(" — ").trim();
  const quantity = QUANTITY.exec(quantityText);

  return {
    name,
    quantityText,
    quantity: quantity ? Number(quantity[1]) : null,
    unit: quantity ? quantity[2]!.trim() || null : null,
    nutrients: parseNutrientTokens(nutrientText, warnings, context),
  };
}
