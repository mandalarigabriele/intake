import type { DatabaseSync } from "node:sqlite";
import type { SecretBox } from "./secretBox.js";

/** Key-value store for JSON values, encrypted at rest. */
export class SecretStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly box: SecretBox,
  ) {}

  /**
   * Returns undefined when the key is missing or cannot be decrypted
   * (e.g. TOKEN_ENCRYPTION_KEY changed), so the app treats it as "not connected".
   */
  get<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT value FROM secrets WHERE key = ?").get(key) as { value: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(this.box.open(row.value)) as T;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO secrets (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run(key, this.box.seal(JSON.stringify(value)));
  }

  delete(...keys: string[]): void {
    const statement = this.db.prepare("DELETE FROM secrets WHERE key = ?");
    for (const key of keys) statement.run(key);
  }
}
