import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { parseFoodMacros, parseFoodSearch } from "../src/parsers/foods.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

describe("food routes", () => {
  const api = {
    searchFoods: vi.fn(async () => parseFoodSearch(fixture("food-search.txt")).value),
    foodMacros: vi.fn(async (_id: number, amount: number) => parseFoodMacros(fixture("food-macros.txt"), amount).value),
  };

  async function signedIn() {
    const app = await buildApp({ auth: authOptions(), foods: { api } });
    const { cookie } = await signIn(app);
    return { app, headers: { cookie } };
  }

  it("searches USDA foods by name and returns one food scaled to the amount", async () => {
    const { app, headers } = await signedIn();
    const found = await app.inject({ method: "GET", url: "/api/foods/search?q=whole%20wheat%20pasta", headers });
    expect(found.json().foods).toHaveLength(5);
    expect(api.searchFoods).toHaveBeenCalledWith("whole wheat pasta");
    const food = await app.inject({ method: "GET", url: "/api/foods/168910?amount=150", headers });
    expect(food.json()).toMatchObject({ id: 168910, amountG: 150, values: { kcal: 224, fiber: 5.85 } });
    expect(api.foodMacros).toHaveBeenCalledWith(168910, 150);
  });

  it("refuses a missing query, a bad id or amount, and needs sign-in", async () => {
    const { app, headers } = await signedIn();
    expect((await app.inject({ method: "GET", url: "/api/foods/search", headers })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/foods/abc?amount=100", headers })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/foods/168910?amount=0", headers })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/foods/168910?amount=99999", headers })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/foods/search?q=rice" })).statusCode).toBe(401);
  });
});
