import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Schema migrations, applied in order. Never edit a migration that has been released;
 * append a new one instead. The applied count is stored in PRAGMA user_version.
 */
const MIGRATIONS: string[] = [
  // 1: encrypted secrets (Nutrition OAuth client registration, tokens, PKCE verifier)
  `CREATE TABLE secrets (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
   )`,
  // 2: meal plan versions and links between planned meals and logged Nutrition meals
  `CREATE TABLE plans (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     valid_from TEXT NOT NULL,
     uploaded_at TEXT NOT NULL,
     content TEXT NOT NULL
   );
   CREATE INDEX plans_valid_from ON plans (valid_from);
   CREATE TABLE plan_links (
     date TEXT NOT NULL,
     plan_id INTEGER NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
     meal_index INTEGER NOT NULL,
     meal_id TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
     PRIMARY KEY (date, plan_id, meal_index)
   );`,
];

/** Opens (and migrates) the SQLite database. Pass ":memory:" for tests. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
