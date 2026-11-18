import { hevyRoutinePageSchema, hevyWorkoutPageSchema, type HevyRoutine, type HevyWorkout, type HevyWorkoutPage } from "../parsers/hevy.js";

export class HevyError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "HevyError";
  }
}

const BASE_URL = "https://api.hevyapp.com";
/** The API returns at most 10 workouts per page. */
const PAGE_SIZE = 10;
/** Pages are kept in memory this long (workouts are read live, never stored). */
const CACHE_MS = 5 * 60_000;
/** Safety limit when walking back in time (10 pages = 100 workouts). */
const MAX_PAGES = 10;

/** A set as the Hevy API takes it (POST/PUT /v1/workouts). */
export interface HevyWriteSet {
  type: "warmup" | "normal" | "failure" | "dropset";
  weight_kg: number | null;
  reps: number | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  rpe: number | null;
}

/** A workout as the Hevy API takes it. */
export interface HevyWriteWorkout {
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  is_private: boolean;
  exercises: Array<{ exercise_template_id: string; superset_id: number | null; notes: string | null; sets: HevyWriteSet[] }>;
}

/** A custom exercise template (POST /v1/exercise_templates). */
export interface HevyNewTemplate {
  title: string;
  exercise_type: "weight_reps" | "reps_only" | "duration" | "distance_duration";
  equipment_category: "none" | "barbell" | "dumbbell" | "kettlebell" | "machine" | "plate" | "resistance_band" | "suspension" | "other";
  muscle_group: string;
}

/**
 * Client of the Hevy public API, authenticated with the owner's API key. Reads are live (pages cached briefly);
 * the only writes are the optional openGym → Hevy copy (services/hevySync.ts).
 */
export class HevyApi {
  private readonly cache = new Map<number, { at: number; value: Promise<HevyWorkoutPage> }>();

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private page(page: number): Promise<HevyWorkoutPage> {
    const cached = this.cache.get(page);
    if (cached && this.now() - cached.at < CACHE_MS) return cached.value;
    const value = this.fetchPage(page);
    this.cache.set(page, { at: this.now(), value });
    // A failed request is not cached
    value.catch(() => this.cache.delete(page));
    return value;
  }

  private async fetchPage(page: number): Promise<HevyWorkoutPage> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${BASE_URL}/v1/workouts?page=${page}&pageSize=${PAGE_SIZE}`, {
        headers: { "api-key": this.apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new HevyError(`Hevy request failed: ${(error as Error).message}`);
    }
    // Hevy answers 404 for a page past the last one
    if (response.status === 404) return { page, page_count: page - 1, workouts: [] };
    if (!response.ok) throw new HevyError(`Hevy answered ${response.status}`, response.status);
    const parsed = hevyWorkoutPageSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new HevyError("Unexpected Hevy response");
    return parsed.data;
  }

  private routinesCache: { at: number; value: Promise<HevyRoutine[]> } | null = null;

  /** All routines (a few pages at most), cached like the workout pages. */
  routines(): Promise<HevyRoutine[]> {
    if (this.routinesCache && this.now() - this.routinesCache.at < CACHE_MS) return this.routinesCache.value;
    const value = this.fetchRoutines();
    this.routinesCache = { at: this.now(), value };
    value.catch(() => (this.routinesCache = null));
    return value;
  }

  private async fetchRoutines(): Promise<HevyRoutine[]> {
    const routines: HevyRoutine[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${BASE_URL}/v1/routines?page=${page}&pageSize=${PAGE_SIZE}`, {
          headers: { "api-key": this.apiKey, accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        throw new HevyError(`Hevy request failed: ${(error as Error).message}`);
      }
      if (response.status === 404) break;
      if (!response.ok) throw new HevyError(`Hevy answered ${response.status}`, response.status);
      const parsed = hevyRoutinePageSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new HevyError("Unexpected Hevy response");
      routines.push(...parsed.data.routines);
      if (page >= parsed.data.page_count) break;
    }
    return routines;
  }

  /** Forgets the cached pages, after a write. */
  clearCache(): void {
    this.cache.clear();
    this.routinesCache = null;
  }

  private async write(method: "POST" | "PUT", path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${BASE_URL}${path}`, {
        method,
        headers: { "api-key": this.apiKey, accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new HevyError(`Hevy request failed: ${(error as Error).message}`);
    }
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) throw new HevyError(`Hevy answered ${response.status}${json?.error ? `: ${json.error}` : ""}`, response.status);
    this.clearCache();
    return json;
  }

  /** Creates a workout; returns its Hevy id. */
  async createWorkout(workout: HevyWriteWorkout): Promise<string> {
    const body = (await this.write("POST", "/v1/workouts", { workout })) as { workout?: unknown; id?: unknown } | null;
    // Documented as a one-element array; accept a plain object too
    const created = Array.isArray(body?.workout) ? body.workout[0] : (body?.workout ?? body);
    const id = (created as { id?: unknown } | undefined)?.id;
    if (typeof id !== "string" || !id) throw new HevyError("Hevy created the workout without returning its id");
    return id;
  }

  async updateWorkout(id: string, workout: HevyWriteWorkout): Promise<void> {
    await this.write("PUT", `/v1/workouts/${encodeURIComponent(id)}`, { workout });
  }

  /** Creates a custom exercise template; returns its id. */
  async createExerciseTemplate(exercise: HevyNewTemplate): Promise<string> {
    const body = (await this.write("POST", "/v1/exercise_templates", { exercise })) as { id?: unknown } | null;
    const id = body?.id;
    if ((typeof id !== "string" && typeof id !== "number") || id === "") throw new HevyError("Hevy created the exercise without returning its id");
    return String(id);
  }

  /** Workouts that started at or after `since` (an ISO instant), newest first. */
  async workoutsSince(since: string): Promise<HevyWorkout[]> {
    const limit = Date.parse(since);
    const workouts: HevyWorkout[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const result = await this.page(page);
      workouts.push(...result.workouts.filter((w) => Date.parse(w.start_time) >= limit));
      const oldest = result.workouts.at(-1);
      if (!oldest || Date.parse(oldest.start_time) < limit || page >= result.page_count) break;
    }
    return workouts;
  }
}
