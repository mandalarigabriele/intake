# Nutrition backups

Intake keeps a daily copy of everything stored in the Nutrition MCP server, so the history is not lost if that service
changes or disappears, and can be moved to another app later.

## What is saved

- The archive produced by Nutrition's `export_all_data` tool, **exactly as Nutrition makes it**: a ZIP with
  `meals.csv`, `meal_items.csv`, `saved_meals.csv`, `saved_meal_items.csv`, `water.csv`, `active_calories.csv`,
  `weight.csv`, `body_measurements.csv`, `goals.csv`, `goals_history.csv`, `profile.csv`, `account.csv`,
  `telemetry.csv`, `connections.csv`, `health_sync.csv` and Nutrition's own `README.txt` describing the columns.
- Intake never opens or converts the archive. A parser for its CSV files is written only when the data has to be
  imported somewhere else. Of these files Nutrition can read back only `meals.csv`.

## When and where

- Every day at **midnight** in the Nutrition profile timezone: a check runs once a minute and the first one after
  midnight takes the day's backup (`services/nutritionBackups.ts`). If the server was down at midnight, the backup is
  taken as soon as it is back.
- Two Nutrition requests a day (`get_current_time` at most hourly is shared with the rest of the app, plus one
  `export_all_data`), well within the 60 requests per minute.
- Nutrition answers with a download link valid for 60 minutes. The server takes the link out of the answer
  (`parsers/exportLink.ts`), accepts it only if it is `https` on Nutrition's file storage
  (`*.supabase.co/storage/v1/object/sign/…zip`), downloads it at once (2 minutes timeout, 200 MB at most) and saves it
  only if it really is a ZIP. The link itself is never stored.
- Files: `<DATA_DIR>/backups/nutrition/nutrition-YYYY-MM-DD.zip` (local date of the backup, file mode 600), written
  to a `.part` file first and renamed when complete. A backup taken by hand on the same day replaces that day's file.
- They live in the data volume, so `deploy.sh` includes them in its volume backup. Off-site copies of the volume should
  be encrypted: the archives contain personal and health data.

## Retention

- The newest **10** backups are kept by default; Impostazioni › Backup changes it from 1 to 30 (settings key
  `nutrition_backups`, which also records the last attempt). Lowering the number deletes the older files at once.

## Failures

- The last attempt is recorded with a short reason: `not_connected`, `rate_limited`, `unexpected_answer`,
  `download_failed`, `not_zip` or `failed`. Impostazioni shows it in words; the automatic backup tries again 30 minutes
  later. Nothing is saved from a failed attempt.

## Impostazioni › Backup

- The newest three backups with date, time and size and a **Scarica** button (the original ZIP, named
  `intake-nutrition-YYYY-MM-DD.zip`); older ones behind "Mostra altri".
- **Copie da tenere** with − / +, and **Fai un backup ora**.

## API (owner only)

- `GET /api/backups` → `{ keep, files: [{ name, date, createdAt, size }], lastRun: { at, error } | null, running }`
- `POST /api/backups/run` → takes a backup now, answers the same shape.
- `PUT /api/backups/settings` with `{ keep }` (1–30) → the same shape.
- `GET /api/backups/:name` → the ZIP; only names of saved backups are served, anything else answers 404.
