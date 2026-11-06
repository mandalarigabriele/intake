import type { ReminderSettings } from "@intake/shared";
import type { DatabaseSync } from "node:sqlite";

export interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { meal: true, todo: true, water: true, summary: true };

const SETTINGS_KEY = "reminders";
/** Sent reminder keys are kept this long, then pruned. */
const LOG_DAYS = 14;

/** Push subscriptions, reminder settings and the log of sent reminders. */
export class ReminderStore {
  constructor(private readonly db: DatabaseSync) {}

  subscriptions(): StoredSubscription[] {
    const rows = this.db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions ORDER BY created_at").all() as Array<{
      endpoint: string;
      p256dh: string;
      auth: string;
    }>;
    return rows.map((row) => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }));
  }

  addSubscription(subscription: StoredSubscription): void {
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .run(subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth);
  }

  removeSubscription(endpoint: string): void {
    this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  }

  settings(): ReminderSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
    if (!row) return { ...DEFAULT_REMINDER_SETTINGS };
    try {
      return { ...DEFAULT_REMINDER_SETTINGS, ...(JSON.parse(row.value) as Partial<ReminderSettings>) };
    } catch {
      return { ...DEFAULT_REMINDER_SETTINGS };
    }
  }

  setSettings(settings: ReminderSettings): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(SETTINGS_KEY, JSON.stringify(settings));
  }

  wasSent(key: string): boolean {
    return this.db.prepare("SELECT 1 FROM reminder_log WHERE key = ?").get(key) !== undefined;
  }

  markSent(key: string): void {
    this.db.prepare("INSERT OR IGNORE INTO reminder_log (key) VALUES (?)").run(key);
    this.db.prepare(`DELETE FROM reminder_log WHERE sent_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${LOG_DAYS} days')`).run();
  }
}
