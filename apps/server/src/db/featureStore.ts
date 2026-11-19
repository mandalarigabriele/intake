import type { DatabaseSync } from "node:sqlite";
import type { FeatureKey } from "@intake/shared";
import type { HealthStore } from "./healthStore.js";

export interface Features {
  setupDone: boolean;
  training: boolean;
  health: boolean;
  reminders: boolean;
}

const SETTINGS_KEY = "features";

/** A new installation starts with only Alimentazione on until the first-run setup chooses. */
const FRESH: Features = { setupDone: false, training: false, health: false, reminders: false };

/**
 * Which optional parts of the app are on (docs/features.md). Stored for the whole installation in the settings
 * table. Turning a part off hides it and stops its work; its data stays.
 */
export class FeatureStore {
  private cached: Features | null = null;

  constructor(private readonly db: DatabaseSync) {}

  get(): Features {
    if (this.cached) return this.cached;
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
    this.cached = row ? { ...FRESH, ...(JSON.parse(row.value) as Partial<Features>) } : FRESH;
    return this.cached;
  }

  enabled(key: FeatureKey): boolean {
    return this.get()[key];
  }

  set(update: Partial<Features>): Features {
    const next = { ...this.get(), ...update };
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SETTINGS_KEY, JSON.stringify(next));
    this.cached = next;
    return next;
  }

  /**
   * An installation from before the feature switches has no stored choice: the parts it already uses stay on and
   * the first-run setup is skipped. A new installation (no data yet) is left untouched, so the setup runs.
   */
  adoptExisting(options: { gymConfigured: boolean }): void {
    const stored = this.db.prepare("SELECT 1 FROM settings WHERE key = ?").get(SETTINGS_KEY);
    if (stored) return;
    const has = (sql: string) => this.db.prepare(sql).get() !== undefined;
    const health = has("SELECT 1 FROM health_imports LIMIT 1");
    const used = health || has("SELECT 1 FROM push_subscriptions LIMIT 1") || has("SELECT 1 FROM plans LIMIT 1") || has("SELECT 1 FROM settings WHERE key IN ('training_source', 'hevy_sync') LIMIT 1");
    if (!used) return;
    // Promemoria costs nothing without subscribed devices, so it stays visible as before
    this.set({ setupDone: true, training: options.gymConfigured, health, reminders: true });
  }
}

type HealthReads = Pick<HealthStore, "daily" | "sleep" | "workouts" | "settings">;

/** Apple Health data for the other screens (week balance, insight, workouts): empty while the Salute part is off. */
export function healthWhenOn(store: HealthReads, features: Pick<FeatureStore, "enabled">): HealthReads {
  const on = () => features.enabled("health");
  return {
    daily: (...args) => (on() ? store.daily(...args) : []),
    sleep: (...args) => (on() ? store.sleep(...args) : []),
    workouts: (...args) => (on() ? store.workouts(...args) : []),
    settings: () => store.settings(),
  };
}
