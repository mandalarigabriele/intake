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

/** Read-only client of the Hevy public API, authenticated with the owner's API key. */
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
