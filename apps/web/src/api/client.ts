export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
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
    try {
      code = ((await response.json()) as { error?: string }).error ?? null;
    } catch {
      // Non-JSON error body
    }
    throw new ApiError(response.status, code, `${init.method ?? "GET"} ${path} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

/** A unique key per user action; crypto.randomUUID needs a secure context (https or localhost). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
