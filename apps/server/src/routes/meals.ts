import { MEAL_PHOTOS_MAX, NUTRITION_MEAL_TYPES, type NutritionMealType, type RecognitionModelResponse, type MealPhotosResponse } from "@intake/shared";
import type { FastifyPluginAsync, FastifyReply, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { isValidDate } from "../services/dayView.js";
import { copyMealFields, recentDistinctMeals, updateMealFields } from "../services/mealWrites.js";
import { MEAL_PHOTO_MAX_BYTES, MealPhotoStore, TooManyPhotosError } from "../db/mealPhotoStore.js";
import type { RecognitionModelStore } from "../db/recognitionModelStore.js";
import { RecognitionError, type MealRecognizer, type RecognitionFailure } from "../services/mealRecognition.js";

export interface MealRoutesOptions {
  api: Pick<NutritionApi, "clock" | "mealsByDate" | "mealsByRange" | "logMeal" | "updateMeal" | "deleteMeal" | "saveMeal" | "savedMeals" | "logSavedMeal" | "deleteSavedMeal">;
  requireOwner: preHandlerHookHandler;
  /** Photo and text recognition with the Claude API; the route answers 503 without it. */
  recognizer?: Pick<MealRecognizer, "recognize">;
  /** Photos kept with meals logged from a photo; without it photos are not stored. */
  photos?: MealPhotoStore;
  /** Claude model chosen for the recognition (Impostazioni › Funzioni › Pasti da foto). */
  recognitionModel?: Pick<RecognitionModelStore, "get" | "set" | "models">;
}

/** Room for a resized photo (the app sends at most about 1 MB of base64). */
const RECOGNIZE_MAX_BYTES = 16 * 1024 * 1024;

const jpegUpload = z.object({ mediaType: z.literal("image/jpeg"), data: z.string().min(16).max(RECOGNIZE_MAX_BYTES) });

/** A base64 JPEG from the app, or null when it is not a JPEG of an acceptable size. */
function decodeJpeg(upload: { data: string }): Buffer | null {
  const jpeg = Buffer.from(upload.data, "base64");
  return MealPhotoStore.isJpeg(jpeg) && jpeg.length <= MEAL_PHOTO_MAX_BYTES ? jpeg : null;
}

const recognizeSchema = z
  .object({
    images: z
      .array(z.object({ mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]), data: z.string().min(16).max(RECOGNIZE_MAX_BYTES) }))
      .min(1)
      .max(MEAL_PHOTOS_MAX)
      .optional(),
    text: z.string().trim().max(1000).optional(),
  })
  .refine((body) => body.images || body.text, "A photo or a description is required");

const RECOGNITION_STATUS: Record<RecognitionFailure, number> = { auth: 502, credit: 402, busy: 503, refused: 422, unreadable: 502, failed: 502 };

const date = z.string().refine(isValidDate, "Invalid date");
const nullableNumber = z.number().nonnegative().nullable();

const nutrientsSchema = z.object({
  kcal: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  carbs: z.number().nonnegative(),
  fat: z.number().nonnegative(),
  saturatedFat: nullableNumber,
  transFat: nullableNumber,
  fiber: nullableNumber,
  sugar: nullableNumber,
  addedSugar: nullableNumber,
  alcohol: nullableNumber,
  caffeineMg: nullableNumber,
  sodiumMg: nullableNumber,
});

const updateSchema = z
  .object({
    date,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    type: z.enum(NUTRITION_MEAL_TYPES),
    description: z.string().trim().min(1).max(2000),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(200),
          quantity: z.number().positive().nullable(),
          unit: z.string().trim().max(40).nullable(),
          nutrients: nutrientsSchema,
        }),
      )
      .max(30)
      .optional(),
    totals: z.object({ kcal: z.number().nonnegative(), protein: z.number().nonnegative(), carbs: z.number().nonnegative(), fat: z.number().nonnegative() }).optional(),
  })
  .refine((body) => (body.items && body.items.length > 0) || body.totals, "Items or totals are required");

const repeatSchema = z.object({ date, idempotencyKey: z.string().min(8).max(255) });
const favoriteSchema = z.object({ name: z.string().trim().min(1).max(100) });
const logSavedSchema = z.object({ idempotencyKey: z.string().min(8).max(255), type: z.enum(NUTRITION_MEAL_TYPES).optional() });
/** Meal type for the time of day ("HH:MM[:SS]"): breakfast before 11, lunch before 15, afternoon snack before 18, then dinner. */
export function mealTypeAt(localTime: string): NutritionMealType {
  if (localTime < "11:00") return "breakfast";
  if (localTime < "15:00") return "lunch";
  if (localTime < "18:00") return "afternoon_snack";
  return "dinner";
}

const SAVED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shiftDate(value: string, days: number): string {
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Logged meals under /api/meals: edit, delete, save as favorite, repeat. */
export const mealRoutes: FastifyPluginAsync<MealRoutesOptions> = async (app, { api, requireOwner, recognizer, photos, recognitionModel }) => {
  app.addHook("preHandler", requireOwner);

  // Foods, grams and nutrition per 100 g from a photo or a description; nothing is logged until the user confirms
  app.post("/meals/recognize", { bodyLimit: RECOGNIZE_MAX_BYTES }, async (request, reply) => {
    if (!recognizer) return reply.code(503).send({ error: "recognition_not_configured" });
    const body = recognizeSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid request" });
    try {
      return await recognizer.recognize(body.data);
    } catch (error) {
      if (!(error instanceof RecognitionError)) throw error;
      request.log.warn({ reason: error.reason }, error.message);
      return reply.code(RECOGNITION_STATUS[error.reason]).send({ error: `recognition_${error.reason}` });
    }
  });

  // The Claude model of the next recognitions; under /meals/recognize, so it is hidden with the part
  app.get("/meals/recognize/model", async (_request, reply) => {
    if (!recognitionModel) return reply.code(503).send({ error: "recognition_not_configured" });
    return { model: recognitionModel.get(), models: recognitionModel.models } satisfies RecognitionModelResponse;
  });

  app.put("/meals/recognize/model", async (request, reply) => {
    if (!recognitionModel) return reply.code(503).send({ error: "recognition_not_configured" });
    const model = (request.body as { model?: unknown } | null)?.model;
    if (typeof model !== "string" || !recognitionModel.set(model)) return reply.code(400).send({ error: "invalid_model" });
    return { model: recognitionModel.get(), models: recognitionModel.models } satisfies RecognitionModelResponse;
  });

  // A new meal, e.g. confirmed after the recognition; its photo (optional) is kept under the new meal's id
  app.post("/meals", { bodyLimit: RECOGNIZE_MAX_BYTES }, async (request, reply) => {
    const body = updateSchema.safeParse(request.body);
    const extra = z
      .object({
        idempotencyKey: z.string().min(8).max(255),
        photos: z.array(jpegUpload).max(MEAL_PHOTOS_MAX).optional(),
        favoriteName: z.string().trim().min(1).max(100).optional(),
      })
      .safeParse(request.body);
    if (!body.success || !extra.success) return reply.code(400).send({ error: "Invalid meal" });
    const jpegs = (extra.data.photos ?? []).map(decodeJpeg);
    if (jpegs.some((jpeg) => jpeg === null)) return reply.code(400).send({ error: "Invalid photo" });
    const result = await api.logMeal({ ...updateMealFields(body.data), description: body.data.description, meal_type: body.data.type, idempotency_key: extra.data.idempotencyKey });
    // The meal is logged; a photo that can't be kept does not undo it
    let photosSaved = 0;
    if (photos && result.id) {
      for (const jpeg of jpegs) {
        try {
          photos.add(result.id, jpeg!);
          photosSaved += 1;
        } catch (error) {
          request.log.warn({ err: error }, "meal photo not saved");
        }
      }
    }
    // "Salva anche come preferito": a saved meal made from the new meal; the meal itself is already logged
    let favoriteSaved = false;
    if (extra.data.favoriteName && result.id) {
      try {
        await api.saveMeal(extra.data.favoriteName, result.id);
        favoriteSaved = true;
      } catch (error) {
        request.log.warn({ err: error }, "favorite not saved");
      }
    }
    return reply.code(201).send({ mealId: result.id, photosSaved, favoriteSaved });
  });

  // Meal photos: the ids that have one (for the timeline) and the image itself
  app.get("/meals/photos", async (): Promise<MealPhotosResponse> => ({ photos: photos?.list() ?? {} }));

  const sendJpeg = (reply: FastifyReply, jpeg: Buffer | null) =>
    jpeg ? reply.header("content-type", "image/jpeg").header("cache-control", "private, max-age=31536000, immutable").send(jpeg) : reply.code(404).send({ error: "No photo" });

  // The first photo (timeline thumbnails, and the single-photo URL of earlier versions)
  app.get<{ Params: { id: string } }>("/meals/:id/photo", async (request, reply) => sendJpeg(reply, photos?.first(request.params.id) ?? null));

  app.get<{ Params: { id: string; photoId: string } }>("/meals/:id/photos/:photoId", async (request, reply) =>
    sendJpeg(reply, photos?.get(request.params.id, request.params.photoId) ?? null),
  );

  // Modifica pasto: a photo added to a meal already logged (e.g. the second course), at most MEAL_PHOTOS_MAX per meal
  app.post<{ Params: { id: string } }>("/meals/:id/photos", { bodyLimit: RECOGNIZE_MAX_BYTES }, async (request, reply) => {
    if (!photos) return reply.code(503).send({ error: "photos_not_available" });
    const body = jpegUpload.safeParse(request.body);
    const jpeg = body.success ? decodeJpeg(body.data) : null;
    if (!jpeg || !MealPhotoStore.isMealId(request.params.id)) return reply.code(400).send({ error: "Invalid photo" });
    try {
      return reply.code(201).send({ photoId: photos.add(request.params.id, jpeg) });
    } catch (error) {
      if (error instanceof TooManyPhotosError) return reply.code(409).send({ error: "too_many_photos", max: MEAL_PHOTOS_MAX });
      throw error;
    }
  });

  app.delete<{ Params: { id: string; photoId: string } }>("/meals/:id/photos/:photoId", async (request, reply) => {
    if (!photos?.remove(request.params.id, request.params.photoId)) return reply.code(404).send({ error: "No photo" });
    return { ok: true };
  });

  // Distinct meals of the last two weeks, for "Ripeti un pasto recente"
  app.get("/meals/recent", async () => {
    const today = (await api.clock()).localDate;
    const { meals } = await api.mealsByRange(shiftDate(today, -13), today);
    return { meals: recentDistinctMeals(meals, 8) };
  });

  // Saved meals ("Pasti preferiti" in the add sheet)
  app.get("/meals/saved", async () => ({ meals: await api.savedMeals() }));

  // Deleting a favorite is confirmed in the add sheet; meals already logged from it keep their values
  app.delete<{ Params: { id: string } }>("/meals/saved/:id", async (request, reply) => {
    const id = request.params.id.toLowerCase();
    if (!SAVED_ID.test(id)) return reply.code(400).send({ error: "Invalid request" });
    if (!(await api.deleteSavedMeal(id))) return reply.code(404).send({ error: "Saved meal not found" });
    return { ok: true };
  });

  // The type is the one sent, else the saved meal's default, else the time of day on the Nutrition profile clock
  app.post<{ Params: { id: string } }>("/meals/saved/:id/log", async (request, reply) => {
    const body = logSavedSchema.safeParse(request.body);
    const id = request.params.id.toLowerCase();
    if (!body.success || !SAVED_ID.test(id)) return reply.code(400).send({ error: "Invalid request" });
    let type = body.data.type;
    if (!type) {
      const saved = (await api.savedMeals()).find((meal) => meal.id === id);
      if (!saved) return reply.code(404).send({ error: "Saved meal not found" });
      if (!saved.mealType) type = mealTypeAt((await api.clock()).localTime);
    }
    const result = await api.logSavedMeal(id, body.data.idempotencyKey, type);
    return reply.code(201).send({ mealId: result.id });
  });

  app.patch<{ Params: { id: string } }>("/meals/:id", async (request, reply) => {
    const body = updateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid meal", issues: body.error.issues.map((i) => i.message) });
    await api.updateMeal(request.params.id, updateMealFields(body.data));
    return { ok: true };
  });

  // Deleting is confirmed in the UI; it removes the meal from Nutrition (and from Claude's view of it)
  app.delete<{ Params: { id: string } }>("/meals/:id", async (request) => {
    await api.deleteMeal(request.params.id);
    photos?.delete(request.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/meals/:id/favorite", async (request, reply) => {
    const body = favoriteSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid name" });
    await api.saveMeal(body.data.name, request.params.id);
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { id: string } }>("/meals/:id/repeat", async (request, reply) => {
    const body = repeatSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid request" });
    const { meals } = await api.mealsByDate(body.data.date);
    const meal = meals.find((m) => m.id === request.params.id);
    if (!meal) return reply.code(404).send({ error: "Meal not found" });
    const result = await api.logMeal({ ...copyMealFields(meal), idempotency_key: body.data.idempotencyKey });
    return reply.code(201).send({ mealId: result.id });
  });
};
