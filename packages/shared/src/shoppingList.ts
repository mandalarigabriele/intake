import { WEEKDAYS, type MealPlan, type PlannedFood } from "./mealPlan.js";
import { isFixedMeal } from "./planUtils.js";

/** Sections of the list, in the order of a supermarket round. */
export const SHOPPING_CATEGORIES = ["produce", "meatFish", "dairy", "bakery", "pantry", "other"] as const;
export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number];

export interface ShoppingItem {
  name: string;
  /** Total for the week; null when the plan gives no amount ("Insalata"). */
  quantity: number | null;
  /** g, ml or pz (pieces); anything else is kept as written. */
  unit: string | null;
  category: ShoppingCategory;
  /** How many planned meals use it. */
  uses: number;
}

const strip = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();

/** Words that tell the section of a food (Italian first, then English and Dutch); the first matching section wins. */
const KEYWORDS: Array<[ShoppingCategory, string[]]> = [
  ["bakery", ["pane", "fette biscottate", "cracker", "grissini", "piadina", "tortilla", "bread", "brood", "wrap", "focaccia", "gallette", "biscott"]],
  ["meatFish", ["pollo", "tacchino", "manzo", "vitello", "maiale", "prosciutto", "bresaola", "salmone", "tonno", "merluzzo", "orata", "branzino", "gamber", "pesce", "salsiccia", "hamburger", "burger", "fesa", "petto", "carne", "chicken", "turkey", "beef", "pork", "salmon", "tuna", "fish", "kip", "rund", "vis", "zalm", "tonijn"]],
  ["dairy", ["yogurt", "latte", "ricotta", "mozzarella", "grana", "parmigiano", "formaggio", "fiocchi di latte", "skyr", "kefir", "burro", "uova", "uovo", "egg", "milk", "cheese", "melk", "kaas", "ei "]],
  ["produce", ["insalata", "pomodor", "zucchin", "spinac", "carot", "peperon", "cetriol", "broccol", "cavol", "finocch", "melanzan", "fagiolini", "funghi", "verdur", "rucola", "lattuga", "cipoll", "patat", "mela", "mele", "banana", "arancia", "frutt", "frutto", "pera", "kiwi", "uva", "fragol", "mirtill", "lampon", "limone", "avocado", "vegetable", "salad", "fruit", "apple", "groente", "sla", "appel"]],
  ["pantry", ["pasta", "riso", "farro", "orzo", "couscous", "avena", "fiocchi", "ceci", "lenticch", "fagioli", "olio", "miele", "mandorle", "noci", "nocciole", "arachid", "burro di", "marmellata", "cioccolat", "cacao", "passata", "polpa", "legumi", "quinoa", "muesli", "cereali", "rice", "oats", "olive oil", "honey", "nuts", "rijst", "haver", "olijfolie"]],
];

export function categoryOf(name: string): ShoppingCategory {
  const text = ` ${strip(name)} `;
  // "Burro di arachidi" is a pantry item even though "burro" is a dairy word
  if (text.includes("burro di")) return "pantry";
  for (const [category, words] of KEYWORDS) if (words.some((word) => text.includes(word.endsWith(" ") ? ` ${word}` : word))) return category;
  return "other";
}

const PIECES = new Set(["pz", "pezzo", "pezzi", "piece", "pieces", "stuk", "stuks", "unit", "unita"]);

function normalizeUnit(unit: string | undefined): string | null {
  if (!unit) return null;
  const u = strip(unit).replace(/\.$/, "");
  if (u === "g" || u === "gr" || u === "grammi" || u === "gram") return "g";
  if (u === "kg") return "kg";
  if (u === "ml") return "ml";
  if (u === "l" || u === "lt") return "l";
  if (PIECES.has(u)) return "pz";
  return unit.trim();
}

/** "1 frutto" or "2 uova" without a separate amount: the leading number becomes a count. */
function readFood(food: PlannedFood): { name: string; quantity: number | null; unit: string | null } {
  let quantity = food.quantity ?? null;
  let unit = normalizeUnit(food.unit);
  let name = food.name.trim();
  if (quantity === null) {
    const lead = /^(\d+(?:[.,]\d+)?)\s+(.+)$/.exec(name);
    if (lead) {
      quantity = Number(lead[1]!.replace(",", "."));
      name = lead[2]!;
      unit = "pz";
    }
  }
  if (quantity !== null && unit === "kg") [quantity, unit] = [quantity * 1000, "g"];
  if (quantity !== null && unit === "l") [quantity, unit] = [quantity * 1000, "ml"];
  return { name, quantity, unit };
}

const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * The week's shopping list: the foods of every planned meal of the seven days added up by name and unit (free meals
 * add nothing). Plain arithmetic on the plan, no AI. Amounts of the same food in different units stay separate lines.
 */
export function shoppingList(plan: MealPlan): ShoppingItem[] {
  const items = new Map<string, ShoppingItem>();
  for (const weekday of WEEKDAYS) {
    for (const meal of plan.days[weekday].meals) {
      if (!isFixedMeal(meal)) continue;
      for (const food of meal.foods) {
        const { name, quantity, unit } = readFood(food);
        const key = `${strip(name)}|${quantity === null ? "" : (unit ?? "")}`;
        const found = items.get(key);
        if (found) {
          found.uses += 1;
          if (quantity !== null) found.quantity = (found.quantity ?? 0) + quantity;
        } else {
          items.set(key, { name: capital(name), quantity, unit: quantity === null ? null : unit, category: categoryOf(name), uses: 1 });
        }
      }
    }
  }
  const order = (category: ShoppingCategory) => SHOPPING_CATEGORIES.indexOf(category);
  return [...items.values()].sort((a, b) => order(a.category) - order(b.category) || a.name.localeCompare(b.name));
}

const decimal = (value: number) => String(Math.round(value * 10) / 10).replace(".", ",");

/** "Pasta 840 g", "Mozzarella 1,2 kg", "Uova 12 pz"; just the name when the plan gives no amount. */
export function shoppingLine(item: ShoppingItem): string {
  if (item.quantity === null) return item.name;
  if (item.unit === "g" && item.quantity >= 1000) return `${item.name} ${decimal(item.quantity / 1000)} kg`;
  if (item.unit === "ml" && item.quantity >= 1000) return `${item.name} ${decimal(item.quantity / 1000)} l`;
  return `${item.name} ${decimal(item.quantity)}${item.unit ? ` ${item.unit}` : ""}`;
}
