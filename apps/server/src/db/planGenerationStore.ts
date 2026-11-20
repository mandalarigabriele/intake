import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_PLAN_MODEL, PLAN_MODELS, planPreferencesSchema, type PlanPreferences } from "@intake/shared";

const SETTINGS_KEY = "plan_generation";

interface Stored {
  preferences: PlanPreferences | null;
  model: string;
}

/** "Genera con l'IA" (Piano): the last preferences and the model for plans (settings table, key plan_generation). */
export class PlanGenerationStore {
  constructor(private readonly db: DatabaseSync) {}

  get(): Stored {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
    const value = row ? (JSON.parse(row.value) as Partial<Stored>) : {};
    const preferences = planPreferencesSchema.safeParse(value.preferences);
    const model = typeof value.model === "string" && (PLAN_MODELS as readonly string[]).includes(value.model) ? value.model : DEFAULT_PLAN_MODEL;
    return { preferences: preferences.success ? preferences.data : null, model };
  }

  setPreferences(preferences: PlanPreferences): void {
    this.save({ ...this.get(), preferences });
  }

  /** False when the model is not one of PLAN_MODELS. */
  setModel(model: string): boolean {
    if (!(PLAN_MODELS as readonly string[]).includes(model)) return false;
    this.save({ ...this.get(), model });
    return true;
  }

  private save(value: Stored): void {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SETTINGS_KEY, JSON.stringify(value));
  }
}
