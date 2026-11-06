export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
    /** Seconds to wait before retrying (Nutrition rate limit), when the server says so. */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Retry policy for queries: never retry 4xx; after a rate limit wait as long as the server asks. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 2;
}

export function retryDelay(attempt: number, error: unknown): number {
  if (error instanceof ApiError && error.retryAfter) return error.retryAfter * 1000;
  return Math.min(1000 * 2 ** attempt, 8000);
}

/** fetch() for the Intake API: JSON in and out, non-2xx responses become ApiError. */
export async function apiFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const response = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });

  if (!response.ok) {
    let code: string | null = null;
    let retryAfter: number | null = null;
    try {
      const body = (await response.json()) as { error?: string; retryAfter?: number };
      code = body.error ?? null;
      retryAfter = typeof body.retryAfter === "number" ? body.retryAfter : null;
    } catch {
      // Non-JSON error body
    }
    throw new ApiError(response.status, code, `${init.method ?? "GET"} ${path} failed with ${response.status}`, retryAfter);
  }
  return (await response.json()) as T;
}

/** A unique key per user action; crypto.randomUUID needs a secure context (https or localhost). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
