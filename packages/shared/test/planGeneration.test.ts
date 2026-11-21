import { describe, expect, it } from "vitest";
import { WEEKDAYS } from "../src/mealPlan.js";
import { checkPlan, defaultPlanPreferences, describeProblems, planPreferencesSchema, slotsFromPlan, swapMeals, editMeal, toMealPlan, type GeneratedPlan } from "../src/planGeneration.js";

const prefs = defaultPlanPreferences();
const macros = (kcal: number, protein: number) => ({ kcal, protein, carbs: 50, fat: 15, fiber: 5, sugar: 10, addedSugar: 2 });

/** A week where every day has the five default slots; dinner changes with the day so nothing repeats too much. */
function week(overrides: (day: (typeof WEEKDAYS)[number], slot: string) => Partial<GeneratedPlan["days"][number]["meals"][number]> = () => ({})): GeneratedPlan {
  return {
    notes: ["Cucina il riso per tre giorni"],
    days: WEEKDAYS.map((day, d) => ({
      day,
      note: "",
      meals: prefs.slots.map((slot, s) => ({
        slot: slot.id,
        free: false,
        description: `${slot.label} ${day}`,
        foods: [{ name: s === 0 ? "Yogurt greco" : `Cibo ${d}-${s}`, quantity: 150, unit: "g" }],
        macros: slot.type === "breakfast" ? macros(400, 25) : slot.type === "snack" ? macros(200, 15) : macros(600, 40),
        ...overrides(day, slot.id),
      })),
    })),
  };
}

describe("plan generation", () => {
  it("converts the AI answer into a valid Intake plan with the slots' titles, times and types", () => {
    const plan = toMealPlan(week(), prefs.slots, "2026-11-23");
    expect(plan.validFrom).toBe("2026-11-23");
    expect(plan.notes).toEqual(["Cucina il riso per tre giorni"]);
    const monday = plan.days.monday.meals;
    expect(monday.map((m) => [m.title, m.time, m.type])).toEqual(prefs.slots.map((s) => [s.label, s.time, s.type]));
    expect(monday[0]).toMatchObject({ foods: [{ name: "Yogurt greco", quantity: 150, unit: "g" }], macros: { kcal: 400, protein: 25, sugar: 10, addedSugar: 2 } });
  });

  it("checks day totals against the goals: on target within 7% kcal and 10 g protein", () => {
    const plan = toMealPlan(week(), prefs.slots, "2026-11-23");
    // 400 + 200 + 600 + 200 + 600 = 2000 kcal, 135 g protein
    expect(checkPlan(plan, { kcal: 2050, protein: 140, carbs: null, fat: null, fiber: null }, prefs).days[0]).toMatchObject({ kcal: 2000, protein: 135, onTarget: true });
    const off = checkPlan(plan, { kcal: 2400, protein: 160, carbs: null, fat: null, fiber: null }, prefs);
    expect(off.days.every((d) => d.onTarget === false)).toBe(true);
    expect(describeProblems(off, { kcal: 2400, protein: 160, carbs: null, fat: null, fiber: null })[0]).toContain("monday: 2000 kcal");
  });

  it("finds allergens and disliked foods without caring about case or accents", () => {
    const strict = planPreferencesSchema.parse({ ...prefs, allergies: ["Arachidi"], dislikes: ["caffè"] });
    const plan = toMealPlan(week((day, slot) => (day === "tuesday" && slot === "snack-am" ? { foods: [{ name: "Burro di ARACHIDI", quantity: 20, unit: "g" }, { name: "Caffe", quantity: 1, unit: "pz" }] } : {})), prefs.slots, "2026-11-23");
    const kinds = checkPlan(plan, { kcal: null, protein: null, carbs: null, fat: null, fiber: null }, strict).violations.map((v) => `${v.kind}:${"term" in v ? v.term : ""}`);
    expect(kinds).toEqual(["allergen:arachidi", "disliked:caffè"]);
  });

  it("counts repeated dishes (breakfast excepted when allowed), the same dish twice in a day and the free meals", () => {
    const withFree = { ...prefs, freeMeals: [{ day: "saturday" as const, slot: "dinner" }] };
    const plan = toMealPlan(
      week((day, slot) => {
        if (slot === "lunch") return { foods: [{ name: "Pasta al pomodoro", quantity: 80, unit: "g" }] };
        if (day === "monday" && slot === "dinner") return { foods: [{ name: "Pasta al pomodoro", quantity: 80, unit: "g" }] };
        return {};
      }),
      prefs.slots,
      "2026-11-23",
    );
    const violations = checkPlan(plan, { kcal: null, protein: null, carbs: null, fat: null, fiber: null }, withFree).violations;
    const repeated = violations.find((v) => v.kind === "repeated");
    expect(repeated).toMatchObject({ kind: "repeated", meal: "Pranzo monday", times: 8, max: 2 });
    // Where it repeats, to mark each meal in the review
    expect(repeated?.kind === "repeated" && repeated.at.slice(0, 2)).toEqual([{ day: "monday", index: 2 }, { day: "monday", index: 4 }]);
    expect(violations).toContainEqual({ kind: "sameDay", day: "monday", index: 4, meal: "Cena" });
    expect(violations).toContainEqual({ kind: "freeMeal", day: "saturday", index: 4, meal: "Cena", expected: true });
    // Breakfast is the same every day, which the default preferences allow
    expect(violations.some((v) => v.kind === "repeated" && v.meal.startsWith("Colazione"))).toBe(false);
  });

  it("marks a requested free meal as free and leaves its day's totals unchecked", () => {
    const withFree = { ...prefs, freeMeals: [{ day: "saturday" as const, slot: "dinner" }] };
    const plan = toMealPlan(week((day, slot) => (day === "saturday" && slot === "dinner" ? { free: true, foods: [] } : {})), prefs.slots, "2026-11-23");
    expect(plan.days.saturday.meals[4]).toMatchObject({ title: "Cena", free: true });
    const check = checkPlan(plan, { kcal: 2000, protein: 135, carbs: null, fat: null, fiber: null }, withFree);
    expect(check.days[5]).toMatchObject({ hasFreeMeal: true, onTarget: null });
    expect(check.violations.filter((v) => v.kind === "freeMeal")).toEqual([]);
  });

  it("takes the slots of the active plan, and cleans the typed lists", () => {
    const plan = toMealPlan(week(), prefs.slots, "2026-11-23");
    expect(slotsFromPlan(plan)!.map((s) => [s.label, s.time, s.type])).toEqual(prefs.slots.map((s) => [s.label, s.time, s.type]));
    expect(slotsFromPlan(null)).toBeNull();
    expect(planPreferencesSchema.parse({ ...prefs, dislikes: ["Funghi", " funghi ", "Salmone"] }).dislikes).toEqual(["funghi", "salmone"]);
  });
});

describe("plan edits", () => {
  it("changes a meal's time on one day or on every day", async () => {
    const { setMealTime, replaceMeal, toPlannedMeal } = await import("../src/planGeneration.js");
    const plan = toMealPlan(week(), prefs.slots, "2026-11-23");
    const oneDay = setMealTime(plan, "tuesday", 4, "21:15", false);
    expect(oneDay.days.tuesday.meals[4]!.time).toBe("21:15");
    expect(oneDay.days.monday.meals[4]!.time).toBe("20:00");
    const allDays = setMealTime(plan, "tuesday", 0, "08:15", true);
    expect(WEEKDAYS.map((d) => allDays.days[d].meals[0]!.time)).toEqual(Array(7).fill("08:15"));
    expect(() => setMealTime(plan, "monday", 0, "25:00", false)).toThrow();

    const swapped = replaceMeal(plan, "monday", 2, toPlannedMeal({ slot: "lunch", free: false, description: "Riso e pollo", foods: [{ name: "Riso", quantity: 80, unit: "g" }], macros: macros(600, 40) }, { title: "Pranzo", time: "13:30", type: "lunch" }));
    expect(swapped.days.monday.meals[2]).toMatchObject({ title: "Pranzo", time: "13:30", description: "Riso e pollo" });
    expect(swapped.days.tuesday.meals[2]).toEqual(plan.days.tuesday.meals[2]);
  });

  it("swaps a dish with the same meal of another day, keeping each slot's title and time, free meals included", () => {
    const plan = toMealPlan(
      week((day, slot) => (slot === "lunch" ? { description: `Pranzo ${day}`, foods: [{ name: day, quantity: 10, unit: "g" }] } : day === "saturday" && slot === "dinner" ? { free: true, foods: [] } : {})),
      prefs.slots,
      "2026-11-23",
    );
    const lunch = prefs.slots.findIndex((slot) => slot.id === "lunch");
    const swapped = swapMeals(plan, "monday", lunch, "friday");
    expect(swapped.days.monday.meals[lunch]).toMatchObject({ title: plan.days.monday.meals[lunch]!.title, time: plan.days.monday.meals[lunch]!.time, description: "Pranzo friday" });
    expect(swapped.days.friday.meals[lunch]).toMatchObject({ time: plan.days.friday.meals[lunch]!.time, description: "Pranzo monday" });
    expect(swapMeals(plan, "monday", lunch, "monday")).toBe(plan);
    // The pizza moves to Friday and Friday's dinner goes to Saturday
    const dinner = prefs.slots.findIndex((slot) => slot.id === "dinner");
    const pizza = swapMeals(plan, "saturday", dinner, "friday");
    expect(pizza.days.friday.meals[dinner]).toMatchObject({ free: true, title: plan.days.friday.meals[dinner]!.title });
    expect(pizza.days.saturday.meals[dinner]!.free).not.toBe(true);
    expect(pizza.days.saturday.meals[dinner]).toHaveProperty("foods");
  });

  it("edits a dish by hand: new text, foods and nutrients, keeping the slot, the time and the optional nutrients within bounds", () => {
    const plan = toMealPlan(week((day, slot) => (slot === "lunch" ? { description: "Pranzo", foods: [{ name: "Riso", quantity: 80, unit: "g" }], macros: { kcal: 600, protein: 30, carbs: 80, fat: 20, fiber: 5, sugar: 8, addedSugar: 6 } } : {})), prefs.slots, "2026-11-23");
    const lunch = prefs.slots.findIndex((slot) => slot.id === "lunch");
    const edited = editMeal(plan, { day: "tuesday", index: lunch, description: "Pasta e fagioli", foods: [{ name: "Pasta", quantity: 70, unit: "g" }, { name: "Fagioli", quantity: 150, unit: "g" }], macros: { kcal: 640.4, protein: 28.26, carbs: 90, fat: 12, fiber: 15 } });
    const meal = edited.days.tuesday.meals[lunch]!;
    expect(meal).toMatchObject({ title: plan.days.tuesday.meals[lunch]!.title, time: plan.days.tuesday.meals[lunch]!.time, description: "Pasta e fagioli" });
    expect("macros" in meal && meal.macros).toMatchObject({ kcal: 640, protein: 28.3, fat: 12, sugar: 8, addedSugar: 6 });
    expect(edited.days.monday.meals[lunch]).toEqual(plan.days.monday.meals[lunch]);
    // Without nutrients they stay as they were, and an empty text leaves the dish without a description
    const kept = editMeal(plan, { day: "tuesday", index: lunch, description: "", foods: [{ name: "Gnocchi" }] });
    expect("macros" in kept.days.tuesday.meals[lunch]! && kept.days.tuesday.meals[lunch]!.macros?.kcal).toBe(600);
    expect(kept.days.tuesday.meals[lunch]!.description).toBeUndefined();
    expect(() => editMeal(plan, { day: "tuesday", index: 9, description: "", foods: [{ name: "x" }] })).toThrow();
  });
});
