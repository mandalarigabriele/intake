import { HOME_CARDS, completeHomeLayout } from "@intake/shared";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { HomeLayoutStore } from "../src/db/homeLayoutStore.js";
import { authOptions, signIn } from "./helpers.js";

describe("home layout", () => {
  it("completes a stored layout: unknown and repeated ids dropped, missing cards appended", () => {
    const layout = completeHomeLayout({ order: ["insight", "old-card" as never, "insight", "macros"], hidden: ["water", "nope" as never] });
    expect(layout.order.slice(0, 2)).toEqual(["insight", "macros"]);
    expect([...layout.order].sort()).toEqual([...HOME_CARDS].sort());
    expect(layout.hidden).toEqual(["water"]);
    expect(completeHomeLayout(null)).toEqual({ order: [...HOME_CARDS], hidden: [] });
    // By default the rings come right after the next meal, as Oggi was before the layout could change
    expect(HOME_CARDS.slice(0, 3)).toEqual(["nextMeal", "scores", "calories"]);
  });

  it("is owner-only, validated, and kept for the installation", async () => {
    const db = openDatabase(":memory:");
    const app = await buildApp({ auth: authOptions(), homeLayout: new HomeLayoutStore(db) });
    expect((await app.inject({ method: "GET", url: "/api/home-layout" })).statusCode).toBe(401);
    const { cookie } = await signIn(app);
    const headers = { cookie };
    expect((await app.inject({ method: "GET", url: "/api/home-layout", headers })).json()).toEqual({ order: [...HOME_CARDS], hidden: [] });
    const saved = await app.inject({ method: "PUT", url: "/api/home-layout", headers, payload: { order: ["macros", "calories"], hidden: ["insight"] } });
    expect(saved.json().order.slice(0, 2)).toEqual(["macros", "calories"]);
    expect(new HomeLayoutStore(db).get().hidden).toEqual(["insight"]);
    expect((await app.inject({ method: "PUT", url: "/api/home-layout", headers, payload: { order: ["bogus"], hidden: [] } })).statusCode).toBe(400);
  });
});
