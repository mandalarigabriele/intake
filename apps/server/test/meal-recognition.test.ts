import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MealPhotoStore } from "../src/db/mealPhotoStore.js";
import { buildApp } from "../src/app.js";
import type { MealRoutesOptions } from "../src/routes/meals.js";
import { MealRecognizer, RecognitionError } from "../src/services/mealRecognition.js";
import { RecognitionModelStore } from "../src/db/recognitionModelStore.js";
import { openDatabase } from "../src/db/database.js";
import { APIError } from "@anthropic-ai/sdk";
import { authOptions, signIn } from "./helpers.js";

const answer = {
  description: "Pasta al pomodoro con insalata",
  items: [
    { name: "Pasta al pomodoro (cotta)", grams: 251.4, visible: true, per100g: { kcal: 130, protein: 4.5, carbs: 25, fat: 1.5, fiber: 1.8, sugar: 2.1, addedSugar: 0 } },
    { name: "Olio extravergine d'oliva", grams: 10, visible: false, per100g: { kcal: 884, protein: 0, carbs: 0, fat: 100, fiber: 0, sugar: 0, addedSugar: 0 } },
  ],
};

/** A Messages API answer with the given JSON text, stop reason and usage. */
function message(text: string, stop_reason = "end_turn", usage = { input_tokens: 3400, output_tokens: 520, output_tokens_details: { thinking_tokens: 120 } }) {
  return { id: "msg_1", type: "message", role: "assistant", model: "m", content: [{ type: "text", text }], stop_reason, usage };
}

function fakeClient(result: unknown) {
  return { create: vi.fn(async () => (result instanceof Error ? Promise.reject(result) : result)) };
}

const apiError = (status: number, type: string, msg = "x") => APIError.generate(status, { type: "error", error: { type, message: msg } }, msg, new Headers());

describe("MealRecognizer", () => {
  it("sends the photo with a structured output at low effort and returns the foods", async () => {
    const client = fakeClient(message(JSON.stringify(answer)));
    const log = { info: vi.fn(), warn: vi.fn() };
    const recognizer = new MealRecognizer({ apiKey: "sk-test", model: () => "claude-haiku-5-5", client: client as never, log });
    const meal = await recognizer.recognize({ images: [{ mediaType: "image/jpeg", data: "aGVsbG8gd29ybGQgaGVsbG8=" }], text: "senza parmigiano" });

    expect(meal.description).toBe("Pasta al pomodoro con insalata");
    expect(meal.items[0]).toEqual({ name: "Pasta al pomodoro (cotta)", grams: 251, visible: true, per100g: answer.items[0]!.per100g });
    expect(meal.items[1]!.per100g).toEqual({ kcal: 884, protein: 0, carbs: 0, fat: 100, fiber: 0, sugar: 0, addedSugar: 0 });

    const sent = (client.create.mock.calls[0] as unknown as [Record<string, any>])[0];
    expect(sent.model).toBe("claude-haiku-5-5");
    expect(sent.max_tokens).toBe(16_000);
    expect(sent.output_config.effort).toBe("low");
    expect(sent.output_config.format.type).toBe("json_schema");
    const schema = sent.output_config.format.schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.items.items.additionalProperties).toBe(false);
    expect(schema.properties.items.items.properties.per100g.additionalProperties).toBe(false);
    expect(schema.properties.items.items.properties.per100g.required).toEqual(["kcal", "protein", "carbs", "fat", "fiber", "sugar", "addedSugar"]);
    expect(sent.tools).toBeUndefined();
    expect(sent.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aGVsbG8gd29ybGQgaGVsbG8=" } });
    expect(sent.messages[0].content[1].text).toContain("senza parmigiano");
    // Token usage is logged, never the photo or the text
    expect(log.info).toHaveBeenCalledWith({ model: "claude-haiku-5-5", stopReason: "end_turn", inputTokens: 3400, outputTokens: 520, thinkingTokens: 120 }, "meal recognition");
  });

  it("sends several photos of one meal in the same request and asks to count each food once", async () => {
    const client = fakeClient(message(JSON.stringify(answer)));
    const recognizer = new MealRecognizer({ apiKey: "sk-test", model: () => "claude-haiku-5-5", client: client as never });
    const first = { mediaType: "image/jpeg" as const, data: "Zmlyc3QgY291cnNlIHBob3Rv" };
    const second = { mediaType: "image/jpeg" as const, data: "c2Vjb25kIGNvdXJzZSBwaG90bw==" };
    await recognizer.recognize({ images: [first, second] });
    const content = (client.create.mock.calls[0] as unknown as [Record<string, any>])[0].messages[0].content;
    expect(content.slice(0, 2).map((block: any) => block.source.data)).toEqual([first.data, second.data]);
    expect(content[2].text).toMatch(/^2 photos of one meal/);
    expect(content[2].text).toContain("only once");
  });

  it("uses the model chosen at the time of each request", async () => {
    let model = "claude-haiku-5-5";
    const client = fakeClient(message(JSON.stringify(answer)));
    const recognizer = new MealRecognizer({ apiKey: "k", model: () => model, client: client as never });
    await recognizer.recognize({ text: "pasta" });
    model = "claude-sonnet-5-5";
    await recognizer.recognize({ text: "pasta" });
    expect(client.create.mock.calls.map((call) => (call as unknown as [{ model: string }])[0].model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
  });

  it("turns typed API errors, refusals, cut and malformed answers into RecognitionError", async () => {
    const run = (result: unknown) =>
      new MealRecognizer({ apiKey: "k", model: () => "m", client: fakeClient(result) as never, log: { info: () => {}, warn: () => {} } })
        .recognize({ text: "una mela" })
        .catch((e: RecognitionError) => e.reason);
    expect(await run(apiError(401, "authentication_error"))).toBe("auth");
    expect(await run(apiError(403, "permission_error"))).toBe("auth");
    expect(await run(apiError(402, "billing_error"))).toBe("credit");
    expect(await run(apiError(400, "billing_error"))).toBe("credit");
    expect(await run(apiError(429, "rate_limit_error"))).toBe("busy");
    expect(await run(apiError(529, "overloaded_error"))).toBe("busy");
    expect(await run(apiError(400, "invalid_request_error"))).toBe("failed");
    expect(await run(new Error("socket hang up"))).toBe("failed");
    expect(await run(message("", "refusal"))).toBe("refused");
    expect(await run(message('{"description":"Pasta', "max_tokens"))).toBe("unreadable");
    expect(await run(message("not json"))).toBe("unreadable");
    expect(await run(message(JSON.stringify({ description: "x", items: [] })))).toBe("unreadable");
    const error = await new MealRecognizer({ apiKey: "k", model: () => "m", client: fakeClient(apiError(404, "not_found_error", "model: m")) as never })
      .recognize({ text: "una mela" })
      .catch((e: RecognitionError) => e);
    expect((error as RecognitionError).message).toBe("Claude API error 404 not_found_error: model: m");
  });
});

describe("recognize and create routes", () => {
  const api = {
    clock: async () => ({ timezone: "Europe/Rome", localDate: "2026-11-19", localTime: "13:00:00", utc: "" }),
    mealsByDate: async () => ({ timezone: null, meals: [] }),
    mealsByRange: async () => ({ timezone: null, meals: [] }),
    logMeal: vi.fn(async () => ({ id: "new-meal-id" })),
    updateMeal: async () => {},
    deleteMeal: async () => {},
    saveMeal: vi.fn(async () => {}),
    savedMeals: async () => [],
    logSavedMeal: async () => ({ id: null }),
    deleteSavedMeal: async () => true,
  } satisfies MealRoutesOptions["api"];

  async function signedIn(recognizer?: MealRoutesOptions["recognizer"], mealPhotos?: MealPhotoStore, recognitionModel?: RecognitionModelStore) {
    const app = await buildApp({ auth: authOptions(), mealsApi: api, recognizer, mealPhotos, recognitionModel });
    const { cookie } = await signIn(app);
    return { app, headers: { cookie } };
  }

  it("answers 503 without an API key and 400 without photo or text", async () => {
    const off = await signedIn();
    expect((await off.app.inject({ method: "POST", url: "/api/meals/recognize", headers: off.headers, payload: { text: "una mela" } })).json()).toEqual({ error: "recognition_not_configured" });
    const on = await signedIn({ recognize: async () => answer as never });
    expect((await on.app.inject({ method: "POST", url: "/api/meals/recognize", headers: on.headers, payload: {} })).statusCode).toBe(400);
  });

  it("returns the recognized meal and maps a busy API to 503", async () => {
    const recognize = vi.fn(async () => answer as never);
    const { app, headers } = await signedIn({ recognize });
    const ok = await app.inject({ method: "POST", url: "/api/meals/recognize", headers, payload: { text: "pasta al pomodoro" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().description).toBe("Pasta al pomodoro con insalata");
    expect(recognize).toHaveBeenCalledWith({ text: "pasta al pomodoro" });

    recognize.mockRejectedValueOnce(new RecognitionError("busy", "busy"));
    const busy = await app.inject({ method: "POST", url: "/api/meals/recognize", headers, payload: { text: "pasta" } });
    expect(busy.statusCode).toBe(503);
    expect(busy.json()).toEqual({ error: "recognition_busy" });
  });

  it("maps a refusal to 422", async () => {
    const { app, headers } = await signedIn({ recognize: async () => Promise.reject(new RecognitionError("refused", "declined")) });
    const refused = await app.inject({ method: "POST", url: "/api/meals/recognize", headers, payload: { text: "pasta" } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toEqual({ error: "recognition_refused" });
  });

  it("reads and changes the model of the next recognitions, Haiku by default", async () => {
    const store = new RecognitionModelStore(openDatabase(":memory:"));
    const { app, headers } = await signedIn(undefined, undefined, store);
    expect((await app.inject({ method: "GET", url: "/api/meals/recognize/model", headers })).json()).toEqual({ model: "claude-haiku-5-5", models: ["claude-haiku-5-5", "claude-sonnet-5-5"] });
    const changed = await app.inject({ method: "PUT", url: "/api/meals/recognize/model", headers, payload: { model: "claude-sonnet-5-5" } });
    expect(changed.json().model).toBe("claude-sonnet-5-5");
    expect(store.get()).toBe("claude-sonnet-5-5");
    expect((await app.inject({ method: "PUT", url: "/api/meals/recognize/model", headers, payload: { model: "gpt-4" } })).statusCode).toBe(400);
  });

  it("starts from RECOGNITION_MODEL when set, and offers it too", () => {
    const db = openDatabase(":memory:");
    const store = new RecognitionModelStore(db, "claude-opus-5-5");
    expect(store.get()).toBe("claude-opus-5-5");
    expect(store.models).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(store.set("claude-haiku-5-5")).toBe(true);
    // The choice is kept in the settings table
    expect(new RecognitionModelStore(db, "claude-opus-5-5").get()).toBe("claude-haiku-5-5");
  });

  it("logs a confirmed meal with its items and an idempotency key", async () => {
    const { app, headers } = await signedIn();
    const response = await app.inject({
      method: "POST",
      url: "/api/meals",
      headers,
      payload: {
        date: "2026-11-19",
        time: "13:05",
        type: "lunch",
        description: "Pasta al pomodoro con insalata",
        idempotencyKey: "photo-12345678",
        items: [
          {
            name: "Pasta al pomodoro (cotta)",
            quantity: 250,
            unit: "g",
            nutrients: { kcal: 325, protein: 11.25, carbs: 62.5, fat: 3.75, saturatedFat: null, transFat: null, fiber: 4.5, sugar: 5.25, addedSugar: null, alcohol: null, caffeineMg: null, sodiumMg: null },
          },
        ],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ mealId: "new-meal-id", photosSaved: 0, favoriteSaved: false });
    expect(api.logMeal).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Pasta al pomodoro con insalata", meal_type: "lunch", logged_at: "2026-11-19T13:05", idempotency_key: "photo-12345678" }),
    );
    // fiber on one item only: left out on all of them, as Nutrition requires
    const mixed = { kcal: 10, protein: 1, carbs: 1, fat: 1, saturatedFat: null, transFat: null, fiber: null, sugar: null, addedSugar: null, alcohol: null, caffeineMg: null, sodiumMg: null };
    await app.inject({
      method: "POST",
      url: "/api/meals",
      headers,
      payload: {
        date: "2026-11-19",
        time: "13:05",
        type: "lunch",
        description: "Pasta e olio",
        idempotencyKey: "photo-mixed-1234",
        items: [
          { name: "Pasta", quantity: 250, unit: "g", nutrients: { ...mixed, fiber: 4.5, sugar: 5, addedSugar: 0 } },
          { name: "Olio", quantity: 10, unit: "g", nutrients: mixed },
        ],
      },
    });
    const items = (api.logMeal.mock.calls.at(-1) as unknown as [{ items: Record<string, unknown>[] }])[0].items;
    expect(items.every((item) => !("fiber_g" in item) && !("sugar_g" in item) && !("added_sugar_g" in item))).toBe(true);
    expect(items[0]).toMatchObject({ name: "Pasta", amount: 250, unit: "g", calories: 10 });

    // also saved as favorite under the new meal's id
    api.logMeal.mockResolvedValueOnce({ id: "fav-meal-id" });
    const withFavorite = await app.inject({
      method: "POST",
      url: "/api/meals",
      headers,
      payload: { date: "2026-11-19", time: "08:00", type: "breakfast", description: "Yogurt", idempotencyKey: "photo-fav-12345", favoriteName: "Colazione solita", totals: { kcal: 200, protein: 15, carbs: 20, fat: 5 } },
    });
    expect(withFavorite.json()).toEqual({ mealId: "fav-meal-id", photosSaved: 0, favoriteSaved: true });
    expect(api.saveMeal).toHaveBeenCalledWith("Colazione solita", "fav-meal-id");

    const missingKey = await app.inject({ method: "POST", url: "/api/meals", headers, payload: { date: "2026-11-19", time: "13:05", type: "lunch", description: "x", totals: { kcal: 1, protein: 0, carbs: 0, fat: 0 } } });
    expect(missingKey.statusCode).toBe(400);
  });

  const jpegOf = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, n)]);
  const upload = (jpeg: Buffer) => ({ mediaType: "image/jpeg", data: jpeg.toString("base64") });

  it("keeps the photos of a meal logged from photos, serves them and deletes them with the meal", async () => {
    const id = "3f2b9c1e-1111-4222-8333-944455556666";
    api.logMeal.mockResolvedValueOnce({ id });
    const photos = new MealPhotoStore(join(mkdtempSync(join(tmpdir(), "intake-photos-")), "meal-photos"));
    const { app, headers } = await signedIn(undefined, photos);
    const meal = { date: "2026-11-19", time: "13:05", type: "lunch", description: "Pasta", idempotencyKey: "photo-87654321", totals: { kcal: 300, protein: 10, carbs: 50, fat: 5 } };

    const logged = await app.inject({ method: "POST", url: "/api/meals", headers, payload: { ...meal, photos: [upload(jpegOf(1)), upload(jpegOf(2))] } });
    expect(logged.json()).toEqual({ mealId: id, photosSaved: 2, favoriteSaved: false });
    const list = (await app.inject({ method: "GET", url: "/api/meals/photos", headers })).json() as { photos: Record<string, string[]> };
    expect(Object.keys(list.photos)).toEqual([id]);
    const [firstId, secondId] = list.photos[id]!;
    expect((await app.inject({ method: "GET", url: `/api/meals/${id}/photos/${secondId}`, headers })).rawPayload.equals(jpegOf(2))).toBe(true);
    // The single-photo URL serves the first one
    const first = await app.inject({ method: "GET", url: `/api/meals/${id}/photo`, headers });
    expect(first.headers["content-type"]).toBe("image/jpeg");
    expect(first.rawPayload.equals(jpegOf(1))).toBe(true);
    expect((await app.inject({ method: "GET", url: `/api/meals/${id}/photos/${firstId}` })).statusCode).toBe(401);

    // Not a JPEG: refused before anything is logged
    const calls = api.logMeal.mock.calls.length;
    const bad = await app.inject({ method: "POST", url: "/api/meals", headers, payload: { ...meal, photos: [upload(Buffer.from("not a jpeg at all"))] } });
    expect(bad.statusCode).toBe(400);
    expect(api.logMeal.mock.calls.length).toBe(calls);

    expect((await app.inject({ method: "DELETE", url: `/api/meals/${id}`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/meals/${id}/photo`, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/meals/photos", headers })).json()).toEqual({ photos: {} });
    expect((await app.inject({ method: "GET", url: "/api/meals/..%2F..%2Fintake.db/photo", headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/meals/${id}/photos/..%2F..%2Fintake.db`, headers })).statusCode).toBe(404);
  });

  it("adds a photo to a logged meal and removes one, at most six per meal", async () => {
    const id = "3f2b9c1e-2222-4222-8333-944455556666";
    const photos = new MealPhotoStore(join(mkdtempSync(join(tmpdir(), "intake-photos-")), "meal-photos"));
    const { app, headers } = await signedIn(undefined, photos);
    const added: string[] = [];
    for (let n = 1; n <= 6; n += 1) {
      const response = await app.inject({ method: "POST", url: `/api/meals/${id}/photos`, headers, payload: upload(jpegOf(n)) });
      expect(response.statusCode).toBe(201);
      added.push((response.json() as { photoId: string }).photoId);
    }
    expect(photos.photos(id)).toEqual(added);
    const seventh = await app.inject({ method: "POST", url: `/api/meals/${id}/photos`, headers, payload: upload(jpegOf(7)) });
    expect(seventh.statusCode).toBe(409);
    expect(seventh.json()).toEqual({ error: "too_many_photos", max: 6 });
    expect((await app.inject({ method: "POST", url: `/api/meals/${id}/photos`, headers, payload: upload(Buffer.from("plain text, not a photo")) })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/meals/not-a-meal/photos", headers, payload: upload(jpegOf(1)) })).statusCode).toBe(400);

    expect((await app.inject({ method: "DELETE", url: `/api/meals/${id}/photos/${added[0]}`, headers })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "DELETE", url: `/api/meals/${id}/photos/${added[0]}`, headers })).statusCode).toBe(404);
    expect(photos.photos(id)).toEqual(added.slice(1));
  });
});

describe("MealPhotoStore", () => {
  it("moves the single photo of earlier versions into the meal's folder on start", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "intake-photos-")), "meal-photos");
    mkdirSync(dir, { recursive: true });
    const id = "3f2b9c1e-3333-4222-8333-944455556666";
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 9)]);
    writeFileSync(join(dir, `${id}.jpg`), jpeg);
    const store = new MealPhotoStore(dir);
    expect(existsSync(join(dir, `${id}.jpg`))).toBe(false);
    expect(store.photos(id)).toHaveLength(1);
    expect(store.first(id)!.equals(jpeg)).toBe(true);
    expect(Object.keys(store.list())).toEqual([id]);
  });
});

