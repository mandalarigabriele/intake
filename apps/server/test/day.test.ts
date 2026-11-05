import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { NotConnectedError } from "../src/mcp/connection.js";
import { ToolError } from "../src/mcp/nutritionApi.js";
import { ParseError } from "../src/parsers/common.js";
import { parseGoalProgress } from "../src/parsers/goalProgress.js";
import { parseMeals } from "../src/parsers/meals.js";
import type { DayRoutesOptions } from "../src/routes/days.js";
import { getDayView, isValidDate } from "../src/services/dayView.js";
import { authOptions, signIn } from "./helpers.js";
import { fixture } from "./parsers/fixtures.js";

const goalProgressJson = JSON.parse(fixture("goal-progress.json"));

describe("parseGoalProgress", () => {
  it("maps the real structured content", () => {
    expect(parseGoalProgress(goalProgressJson).value).toEqual({
      date: "2026-11-04",
      goals: { kcal: 2200, protein: 135, carbs: 255, fat: 70, fiber: 30, waterMl: 2500 },
      totals: { kcal: 790, protein: 49.4, carbs: 53.8, fat: 43.2, fiber: 5.8, waterMl: 0 },
    });
  });

  it("accepts missing goals", () => {
    expect(parseGoalProgress({ ...goalProgressJson, goals: null }).value.goals.kcal).toBeNull();
  });

  it("throws when totals are missing", () => {
    expect(() => parseGoalProgress({ date: "2026-11-04", goals: null })).toThrow(ParseError);
  });
});

const clock = { timezone: "Europe/Rome", localDate: "2026-11-05", localTime: "10:00:00", utc: "2026-11-05T09:00:00.000Z" };

function fakeApi(overrides: Partial<DayRoutesOptions["api"]> = {}): DayRoutesOptions["api"] {
  return {
    clock: async () => clock,
    goalProgress: async () => parseGoalProgress(goalProgressJson).value,
    mealsByDate: async () => parseMeals(fixture("meals-full-by-date.txt")).value,
    addWater: async () => {},
    logMeal: async () => ({ id: null }),
    ...overrides,
  };
}

describe("getDayView", () => {
  it("resolves 'today' in the profile timezone", async () => {
    const goalProgress = vi.fn(fakeApi().goalProgress);
    const view = await getDayView(fakeApi({ goalProgress }), null, "today");
    expect(goalProgress).toHaveBeenCalledWith("2026-11-05");
    expect(view.isToday).toBe(true);
  });

  it("combines totals and meals for a past date", async () => {
    const view = await getDayView(fakeApi(), null, "2026-11-04");
    expect(view.isToday).toBe(false);
    expect(view.totals.kcal).toBe(790);
    expect(view.meals.map((m) => m.time)).toEqual(["16:31", "17:02", "17:05", "20:06", "20:10"]);
  });
});

describe("isValidDate", () => {
  it.each([
    ["2026-11-05", true],
    ["2026-02-29", false],
    ["2026-13-01", false],
    ["05-11-2026", false],
  ])("%s -> %s", (input, expected) => expect(isValidDate(input)).toBe(expected));
});

async function signedInApp(api: DayRoutesOptions["api"]) {
  const app = await buildApp({ auth: authOptions(), api });
  const { cookie } = await signIn(app);
  return { app, headers: { cookie } };
}

describe("day routes", () => {
  it("returns the day view", async () => {
    const { app, headers } = await signedInApp(fakeApi());
    const response = await app.inject({ method: "GET", url: "/api/days/today", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ date: "2026-11-05", isToday: true, goals: { kcal: 2200 } });
  });

  it("rejects an invalid date", async () => {
    const { app, headers } = await signedInApp(fakeApi());
    expect((await app.inject({ method: "GET", url: "/api/days/yesterday", headers })).statusCode).toBe(400);
  });

  it("requires sign-in", async () => {
    const app = await buildApp({ auth: authOptions(), api: fakeApi() });
    expect((await app.inject({ method: "GET", url: "/api/days/today" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/water", payload: { amountMl: 250, idempotencyKey: "12345678" } })).statusCode).toBe(401);
  });

  it("reports a missing Nutrition connection as 409", async () => {
    const { app, headers } = await signedInApp(
      fakeApi({
        clock: async () => {
          throw new NotConnectedError();
        },
      }),
    );
    const response = await app.inject({ method: "GET", url: "/api/days/today", headers });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("nutrition_not_connected");
  });

  it("reports Nutrition errors as 502 without details", async () => {
    const { app, headers } = await signedInApp(
      fakeApi({
        goalProgress: async () => {
          throw new ToolError("get_goal_progress", "boom");
        },
      }),
    );
    const response = await app.inject({ method: "GET", url: "/api/days/today", headers });
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain("boom");
  });

  it("logs water with the idempotency key", async () => {
    const addWater = vi.fn(async () => {});
    const { app, headers } = await signedInApp(fakeApi({ addWater }));
    const response = await app.inject({
      method: "POST",
      url: "/api/water",
      headers,
      payload: { amountMl: 250, idempotencyKey: "tap-0001" },
    });
    expect(response.statusCode).toBe(201);
    expect(addWater).toHaveBeenCalledWith(250, "tap-0001");
  });

  it.each([{ amountMl: 0, idempotencyKey: "tap-0001" }, { amountMl: 250 }, { amountMl: 9999, idempotencyKey: "tap-0001" }])(
    "rejects invalid water body %o",
    async (payload) => {
      const { app, headers } = await signedInApp(fakeApi());
      expect((await app.inject({ method: "POST", url: "/api/water", headers, payload })).statusCode).toBe(400);
    },
  );
});

describe("fixture file", () => {
  it("is valid JSON", () => {
    expect(() => JSON.parse(readFileSync(new URL("../src/parsers/__fixtures__/goal-progress.json", import.meta.url), "utf8"))).not.toThrow();
  });
});
