import type { DatabaseSync } from "node:sqlite";

/** How a Hevy exercise was chosen for an openGym exercise. */
export type ExerciseOrigin = "learned" | "custom";

export interface ExerciseLink {
  openGymId: string;
  templateId: string;
  title: string;
  origin: ExerciseOrigin;
}

export interface SyncLink {
  openGymId: string;
  hevyId: string;
  /** Hash of the openGym content that was sent: a different hash means the workout changed in openGym. */
  hash: string;
}

export interface HevySyncRun {
  at: string;
  created: number;
  updated: number;
  error: string | null;
}

const SETTINGS_KEY = "hevy_sync";
const RUN_KEY = "hevy_sync_last_run";

/**
 * Local state of the openGym → Hevy copy (docs/hevy-sync.md). Only links are stored: the workouts themselves stay
 * in openGym and Hevy and are read live.
 */
export class HevySyncStore {
  constructor(private readonly db: DatabaseSync) {}

  private setting<T>(key: string): T | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  private setSetting(key: string, value: unknown): void {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
  }

  enabled(): boolean {
    return this.setting<{ enabled?: boolean }>(SETTINGS_KEY)?.enabled === true;
  }

  setEnabled(enabled: boolean): void {
    this.setSetting(SETTINGS_KEY, { enabled });
  }

  lastRun(): HevySyncRun | null {
    return this.setting<HevySyncRun>(RUN_KEY);
  }

  setLastRun(run: HevySyncRun): void {
    this.setSetting(RUN_KEY, run);
  }

  links(): Map<string, SyncLink> {
    const rows = this.db.prepare("SELECT opengym_id, hevy_id, hash FROM hevy_sync_links").all() as Array<{ opengym_id: string; hevy_id: string; hash: string }>;
    return new Map(rows.map((r) => [r.opengym_id, { openGymId: r.opengym_id, hevyId: r.hevy_id, hash: r.hash }]));
  }

  saveLink(link: SyncLink): void {
    this.db
      .prepare(
        `INSERT INTO hevy_sync_links (opengym_id, hevy_id, hash) VALUES (?, ?, ?)
         ON CONFLICT(opengym_id) DO UPDATE SET hevy_id = excluded.hevy_id, hash = excluded.hash, synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run(link.openGymId, link.hevyId, link.hash);
  }

  exerciseLinks(): Map<string, ExerciseLink> {
    const rows = this.db.prepare("SELECT opengym_id, template_id, title, origin FROM hevy_exercise_links").all() as Array<{ opengym_id: string; template_id: string; title: string; origin: ExerciseOrigin }>;
    return new Map(rows.map((r) => [r.opengym_id, { openGymId: r.opengym_id, templateId: r.template_id, title: r.title, origin: r.origin }]));
  }

  saveExerciseLink(link: ExerciseLink): void {
    this.db
      .prepare(
        `INSERT INTO hevy_exercise_links (opengym_id, template_id, title, origin) VALUES (?, ?, ?, ?)
         ON CONFLICT(opengym_id) DO UPDATE SET template_id = excluded.template_id, title = excluded.title, origin = excluded.origin`,
      )
      .run(link.openGymId, link.templateId, link.title, link.origin);
  }
}
