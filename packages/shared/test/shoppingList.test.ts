import { describe, expect, it } from "vitest";
import { WEEKDAYS, mealPlanSchema, shoppingLine, shoppingList, type MealPlan } from "../src/index.js";

function week(meals: (day: string) => unknown[]): MealPlan {
  return mealPlanSchema.parse({
    schemaVersion: 1,
    validFrom: "2026-11-23",
    days: Object.fromEntries(WEEKDAYS.map((day) => [day, { meals: meals(day) }])),
  });
}
const meal = (title: string, foods: unknown[]) => ({ title, time: "13:00", foods });

describe("shoppingList", () => {
  it("adds the foods of the week by name and unit, case and accent insensitive, and converts kg and l", () => {
    const plan = week(() => [
      meal("Pranzo", [{ name: "Pasta", quantity: 100, unit: "g" }, { name: "Yogurt greco", quantity: 150, unit: "g" }]),
      meal("Cena", [{ name: "pasta", quantity: 0.1, unit: "kg" }, { name: "Latte", quantity: 0.2, unit: "l" }]),
    ]);
    const list = shoppingList(plan);
    expect(list.map(shoppingLine)).toContain("Pasta 1,4 kg");
    expect(list.map(shoppingLine)).toContain("Yogurt greco 1,1 kg");
    expect(list.map(shoppingLine)).toContain("Latte 1,4 l");
    expect(list.find((i) => i.name === "Pasta")?.uses).toBe(14);
  });

  it("reads a leading number as a count, keeps foods without an amount as one line, and skips free meals", () => {
    const plan = week((day) => [
      meal("Spuntino", [{ name: "1 frutto" }, { name: "Insalata" }]),
      meal("Colazione", [{ name: "2 uova" }]),
      ...(day === "saturday" ? [{ title: "Cena", time: "20:00", free: true }] : []),
    ]);
    const lines = shoppingList(plan).map(shoppingLine);
    expect(lines).toContain("Frutto 7 pz");
    expect(lines).toContain("Uova 14 pz");
    expect(lines.filter((l) => l === "Insalata")).toHaveLength(1);
  });

  it("keeps different units of one food apart and sorts by section then name", () => {
    const plan = week((day) => [meal("Pranzo", day === "monday" ? [{ name: "Pane", quantity: 2, unit: "fette" }, { name: "Pane", quantity: 60, unit: "g" }, { name: "Pomodori", quantity: 100, unit: "g" }, { name: "Pollo", quantity: 150, unit: "g" }, { name: "Burro di arachidi", quantity: 15, unit: "g" }, { name: "Caramelle", quantity: 1, unit: "pz" }] : [{ name: "Pomodori", quantity: 50, unit: "g" }])]);
    const list = shoppingList(plan);
    expect(list.filter((i) => i.name === "Pane")).toHaveLength(2);
    expect(list.map((i) => `${i.category}:${i.name}`)).toEqual([
      "produce:Pomodori",
      "meatFish:Pollo",
      "bakery:Pane",
      "bakery:Pane",
      "pantry:Burro di arachidi",
      "other:Caramelle",
    ]);
  });
});
