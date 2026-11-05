import { describe, expect, it } from "vitest";
import { parseClock } from "../../src/parsers/clock.js";
import { ParseError } from "../../src/parsers/common.js";
import { parseGoals } from "../../src/parsers/goals.js";
import { fixture } from "./fixtures.js";

describe("parseGoals", () => {
  it("parses targets and leaves unset limits as null", () => {
    const { value, warnings } = parseGoals(fixture("goals.txt"));
    expect(warnings).toEqual([]);
    expect(value).toEqual({
      kcal: 2200,
      protein: 135,
      carbs: 255,
      fat: 70,
      fiber: 30,
      waterMl: 2500,
      limits: { saturatedFat: null, sugar: null, addedSugar: null, alcohol: null, caffeineMg: null, sodiumMg: null },
      targetWeight: null,
    });
  });

  it("parses set limits and a target weight (synthetic)", () => {
    const { value } = parseGoals("- Sodium (max): 2300 mg\n- Caffeine (max): 400 mg\n- Target weight: 72.5 kg");
    expect(value.limits).toMatchObject({ sodiumMg: 2300, caffeineMg: 400 });
    expect(value.targetWeight).toEqual({ value: 72.5, unit: "kg" });
  });

  it("warns about unknown goals (synthetic)", () => {
    expect(parseGoals("- Potassium: 3500 mg").warnings).toEqual(['goals: unknown goal "Potassium"']);
  });
});

describe("parseClock", () => {
  const expected = { timezone: "Europe/Rome", localDate: "2026-11-05" };

  it("parses get_current_time", () => {
    expect(parseClock(fixture("current-time.txt")).value).toEqual({
      ...expected,
      localTime: "10:02:10",
      utc: "2026-11-05T09:02:10.540Z",
    });
  });

  it("parses the clock line of get_profile", () => {
    expect(parseClock(fixture("profile.txt")).value).toEqual({
      ...expected,
      localTime: "10:01:52",
      utc: "2026-11-05T09:01:52.891Z",
    });
  });

  it("throws on an unrecognized response", () => {
    expect(() => parseClock("It is morning.")).toThrow(ParseError);
  });
});
