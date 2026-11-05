import type { Nutrients } from "@intake/shared";

/** Thrown when a tool response cannot be understood at all. */
export class ParseError extends Error {
  constructor(
    message: string,
    readonly snippet?: string,
  ) {
    super(snippet ? `${message}: ${JSON.stringify(snippet.slice(0, 200))}` : message);
    this.name = "ParseError";
  }
}

/**
 * Result of a parser. `warnings` lists anything that was skipped or not recognized,
 * so that format changes on the server show up in the logs instead of silently losing data.
 */
export interface Parsed<T> {
  value: T;
  warnings: string[];
}

const NUMBER = /^-?\d+(?:\.\d+)?/;

/** Leading number of a value such as "28.2g", "63 mg" or "2200 kcal"; null for "not set", "not measured" etc. */
export function leadingNumber(text: string): number | null {
  const match = NUMBER.exec(text.trim());
  return match ? Number(match[0]) : null;
}

export function emptyNutrients(): Nutrients {
  return {
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    saturatedFat: null,
    transFat: null,
    fiber: null,
    sugar: null,
    addedSugar: null,
    alcohol: null,
    caffeineMg: null,
    sodiumMg: null,
  };
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;

/** Patterns for one " · "-separated nutrient token, as used in item lines and compact meal lines. */
const TOKEN_PATTERNS: Array<[RegExp, (n: Nutrients, m: RegExpExecArray) => void]> = [
  [new RegExp(`^${NUM} kcal$`), (n, m) => (n.kcal = Number(m[1]))],
  [new RegExp(`^P ${NUM}(?: g)?$`), (n, m) => (n.protein = Number(m[1]))],
  [new RegExp(`^C ${NUM}(?: g)?$`), (n, m) => (n.carbs = Number(m[1]))],
  [new RegExp(`^F ${NUM}(?: g)?$`), (n, m) => (n.fat = Number(m[1]))],
  [new RegExp(`^(?:sat|saturated fat) ${NUM}(?: g)?$`), (n, m) => (n.saturatedFat = Number(m[1]))],
  [new RegExp(`^trans(?: fat)? ${NUM}(?: g)?$`), (n, m) => (n.transFat = Number(m[1]))],
  [new RegExp(`^fiber ${NUM}(?: g)?$`), (n, m) => (n.fiber = Number(m[1]))],
  [
    new RegExp(`^sugar ${NUM}(?: g)?(?: \\(${NUM}(?: g)? added\\))?$`),
    (n, m) => {
      n.sugar = Number(m[1]);
      n.addedSugar = m[2] === undefined ? null : Number(m[2]);
    },
  ],
  [new RegExp(`^alcohol ${NUM}(?: g)?$`), (n, m) => (n.alcohol = Number(m[1]))],
  [new RegExp(`^caffeine ${NUM}(?: mg)?$`), (n, m) => (n.caffeineMg = Number(m[1]))],
  [new RegExp(`^sodium ${NUM}(?: mg)?$`), (n, m) => (n.sodiumMg = Number(m[1]))],
  // Item count on compact meal lines carries no nutrient data
  [/^\d+ items?$/, () => {}],
];

/** Parses "107 kcal · P 1.3 g · C 27.4 g · … · sugar 14.7 g (0 added)" into nutrients. */
export function parseNutrientTokens(text: string, warnings: string[], context: string): Nutrients {
  const nutrients = emptyNutrients();
  for (const raw of text.split(" · ")) {
    const token = raw.trim();
    if (!token) continue;
    const pattern = TOKEN_PATTERNS.find(([regex]) => regex.test(token));
    if (!pattern) {
      warnings.push(`${context}: unrecognized nutrient "${token}"`);
      continue;
    }
    const [regex, apply] = pattern;
    apply(nutrients, regex.exec(token)!);
  }
  return nutrients;
}
