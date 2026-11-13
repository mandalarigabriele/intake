import { randomBytes, timingSafeEqual } from "node:crypto";
import type { SecretStore } from "../db/secretStore.js";

const KEY = "health_ingest_token";

/**
 * Token that Health Auto Export sends with each automatic upload (docs/apple-health.md § Ingest).
 * Stored encrypted in the secrets table; the owner sees it in Profilo › Apple Salute to paste it into the app.
 */
export class HealthIngestToken {
  constructor(private readonly secrets: Pick<SecretStore, "get" | "set" | "delete">) {}

  current(): string | null {
    return this.secrets.get<string>(KEY) ?? null;
  }

  /** Creates a new token; the previous one stops working at once. */
  rotate(): string {
    const token = randomBytes(32).toString("base64url");
    this.secrets.set(KEY, token);
    return token;
  }

  disable(): void {
    this.secrets.delete(KEY);
  }

  /** Accepts "Bearer <token>" or the bare token in the Authorization header, compared in constant time. */
  verify(header: string | undefined): boolean {
    const token = this.current();
    if (!token || !header) return false;
    const given = Buffer.from(header.replace(/^Bearer\s+/i, "").trim());
    const expected = Buffer.from(token);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
