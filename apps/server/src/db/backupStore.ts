import type { DatabaseSync } from "node:sqlite";
import { BACKUP_KEEP } from "@intake/shared";

const SETTINGS_KEY = "nutrition_backups";

interface Stored {
  keep: number;
  lastRun: { at: string; error: string | null } | null;
}

/** Settings of the daily Nutrition backups (settings table): how many to keep and the last attempt. */
export class BackupStore {
  constructor(private readonly db: DatabaseSync) {}

  private read(): Stored {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
    const stored = row ? (JSON.parse(row.value) as Partial<Stored>) : {};
    return { keep: stored.keep ?? BACKUP_KEEP.default, lastRun: stored.lastRun ?? null };
  }

  private write(update: Partial<Stored>): void {
    const next = { ...this.read(), ...update };
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SETTINGS_KEY, JSON.stringify(next));
  }

  keep(): number {
    return this.read().keep;
  }

  setKeep(keep: number): void {
    this.write({ keep: Math.min(BACKUP_KEEP.max, Math.max(BACKUP_KEEP.min, Math.round(keep))) });
  }

  lastRun(): Stored["lastRun"] {
    return this.read().lastRun;
  }

  recordRun(at: string, error: string | null): void {
    this.write({ lastRun: { at, error } });
  }
}
