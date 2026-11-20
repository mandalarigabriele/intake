import { describe, expect, it } from "vitest";
import { favoriteNameFrom } from "../src/favoriteName.js";

describe("favoriteNameFrom", () => {
  it("drops the meal type prefix and keeps a short description as it is", () => {
    expect(favoriteNameFrom("Spuntino: Caffè espresso")).toBe("Caffè espresso");
    expect(favoriteNameFrom("Yogurt greco e miele")).toBe("Yogurt greco e miele");
  });

  it("cuts a long description at a whole word, without a connector left at the end", () => {
    expect(favoriteNameFrom("Colazione: Caffellatte + yogurt greco 150 g con fiocchi d'avena 40 g e banana")).toBe(
      "Caffellatte + yogurt greco 150 g con fiocchi d'avena 40 g",
    );
    expect(favoriteNameFrom("Pranzo: Pasta al pomodoro 100 g, insalata mista con olio, pane integrale 50 g e frutta")).toBe(
      "Pasta al pomodoro 100 g, insalata mista con olio, pane",
    );
  });

  it("keeps the result within 60 characters and never empty", () => {
    const long = "Supercalifragilistichespiralidosoconpanna".repeat(3);
    expect(favoriteNameFrom(long).length).toBeLessThanOrEqual(60);
    expect(favoriteNameFrom(long).length).toBeGreaterThan(0);
    expect(favoriteNameFrom("Dinner: " + "steak with fries and ".repeat(5)).length).toBeLessThanOrEqual(60);
  });
});
