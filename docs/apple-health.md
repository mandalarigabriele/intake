# Apple Health integration

Intake reads Apple Health data exported by the iOS app **Health Auto Export** (HAE).
Apple Health has no web API, so the phone pushes data to Intake: first as a one-time
file import (history), and automatically through HAE's "REST API" automation (see Ingest).
The UI is specified in [`design/DESIGN.md`](design/DESIGN.md) § Apple Health and the
mockups `Main`, `Timeline*`, `AndamentoSalute`, `SaluteDesktop`, `Profilo`, `Salute` and `SaluteImport`.

## What is imported

| Data | HAE name | Use |
|---|---|---|
| Steps | `step_count` | Today, Andamento › Salute, insights |
| Walking + running distance | `walking_running_distance` | Today (km next to steps) |
| Sleep | `sleep_analysis` | Today, Timeline chip, Andamento › Salute, insights |
| Resting heart rate | `resting_heart_rate` | Today, Andamento › Salute |
| Active energy | `active_energy` | Stored; shown only when continuous (see "Balance") |
| Resting energy | `basal_energy_burned` | Stored; shown only when continuous |
| Workouts | `workouts` | Timeline, Andamento › Salute, workout marks in Andamento › Alimentazione (deduplicated, see below) |

Everything else is ignored, in particular:

- nutrition, dietary water and caffeine: the same meals are already in Nutrition (importing them would count them twice);
- body weight: weight lives in Nutrition;
- medications and state of mind: sensitive and not needed;
- GPS routes, splits, per-minute heart rate outside workouts.

## Data rules

- **Day** = the local date written in the HAE timestamp (`2026-10-26 00:00:00 +0100`), which matches the Nutrition profile timezone.
- **Sleep** belongs to the wake-up day (HAE's `date`). Stored: start, end, total asleep, deep, REM, core, awake, in bed.
- **Energy** is always stored in kcal. HAE sends the unit chosen in the Health app (often `kJ`); convert with 1 kcal = 4.184 kJ based on the `units` field.
- **Upsert, never sum.** The current day arrives partial and is sent again; each import overwrites the stored value for that day and metric.
  Re-importing the same period updates rows without duplicating them.
- **Workout heart rate.** Keep average, max and the per-minute series recorded during the workout (`heartRateData`, one point per minute) for the expanded chart. Nothing else per minute.
- **Storage.** SQLite is the only exception to the "read live" rule, because Apple Health cannot be queried from the server.

## Sources and names

Labels come from a mapping table; unknown values keep their original name.

| Source (`source.name`) | Label |
|---|---|
| Google Health | Fitbit |
| MERACH | MERACH |
| Hevy | Hevy |
| Bevel | Bevel |

| Workout name | Label | Family |
|---|---|---|
| Allenamento di Forza Tradizionale | Forza | Forza |
| Ciclismo | Ciclismo | Ciclismo |
| Interno Ciclismo | Cyclette | Ciclismo |
| Calcio | Calcio | Calcio |
| Camminata | Camminata | Camminata |
| Raquetball | Racchetta | Racchetta |

## Duplicate workouts

The same session is often recorded by several apps (for example Fitbit and Bevel, or the MERACH bike and Fitbit's auto-detection).

- Two workouts are the **same session** when they overlap for at least 50% of the shorter one and belong to the same family.
  A session may overlap several others: merge the whole group.
- **Time range** of the merged session = union of the group.
- **Heart rate and kcal** come from the first source that has them, in this order: Fitbit → MERACH → Bevel.
- **Hevy wins.** When a group contains a Hevy workout, the Hevy workout read from the Hevy API keeps title, exercises and duration and only takes heart rate and kcal from Health.
  Hevy-sourced workouts that arrive through Health are dropped when Hevy is read directly.
- The merged session records which sources were used and which were discarded ("Fonti" line in Timeline).

Real cases from the 8 Sep – 13 Nov 2026 export, covered by tests:

| Day | Group | Result |
|---|---|---|
| 24 Oct | Hevy 11:36–12:55 · Fitbit Forza 11:43–12:57 | Hevy, with heart rate from Fitbit |
| 25 Oct | MERACH Cyclette 10:02–10:29 · Fitbit Ciclismo 10:04–10:30 | One Cyclette session, 10:02–10:30 |
| 26 Oct | Fitbit Forza 16:44–17:40 · Bevel Forza 16:42–17:39 | One Forza session, Fitbit heart rate and kcal |
| 29 Oct | Fitbit Forza 13:07–13:26 · Fitbit Forza 13:32–14:06 · Bevel Forza 13:08–13:58 | One Forza session, 13:07–14:06 |

## Andamento › Salute

Mockups `AndamentoSalute` (iPhone: tabs) and `SaluteDesktop` (desktop / iPad: three columns). Read from SQLite only, so it costs no Nutrition calls.

- Period **7 / 30 / 90 days** ending today; 90 covers the whole history imported so far.
- **Sonno**: average sleep, mean bedtime and wake time (averaged across midnight, so 23:50 and 00:10 give 00:00), floating bars from
  bedtime to wake per night with the shortest night labelled, average phases (minutes and share), nights under 7 hours,
  bedtimes after midnight, longest night.
- **Attività**: average steps over finished days only (today is drawn light and left out), days at or above the step goal,
  daily bars with the dashed goal line and the best day, workouts by type (sessions and time), latest workouts with their source.
- **Cuore**: average and minimum resting heart rate, difference from the previous period of the same length, line over time with
  the average, average workout heart rate by type.
- Today's "Attività e riposo" card links here ("Vedi andamento →").
- API: `GET /api/health/trends?days=7|30|90` returns one entry per day (steps, distance, resting HR, the night as minutes from
  midnight of the wake-up day, negative for the evening before) and the period statistics. Workouts come from `GET /api/workouts`
  for the same range (at most 92 days), so Hevy sessions are included.

## Profilo

The avatar opens Profilo (mockup `Profilo`): weight (moved from Week), daily goals from Nutrition (read-only) plus the **step goal**
(moved from the Apple Salute screen, still saved with `PUT /api/health/settings`), connections (Google, Nutrition, Apple Salute with
its warning, Hevy), reminders, theme, "Scollega Nutrition" and sign out.

## Balance

The "Bilancio" row in Today is designed but switched off. It needs both active and resting energy to arrive continuously;
in the first export resting energy covers 2 days and active energy stops on 25 Oct (Fitbit stopped writing it to Health).
No BMR formulas are used to fill the gap. The Apple Salute screen warns when active energy is missing for more than 3 days while other data keeps arriving.

## Insights

A Health-based insight ("Dai tuoi dati") is shown only if each compared group has at least 5 days and the difference is meaningful (at least 10%).

## File import

- Profile › Apple Salute › "Carica file di Health Auto Export (.json)" (export with JSON format and daily aggregation).
- `POST /api/health/import` (owner only, body up to 50 MB) returns a preview without writing; `POST /api/health/import?commit=true` imports.
  Errors: `400 not_health_export`, `422 no_data`, `413` for files over the limit.
- The preview lists the recognized metrics (active and resting energy are flagged when irregular), workouts by family with the
  duplicate groups resolved, and the ignored groups. New and updated days are counted against what is already stored.
- `GET /api/health/status` feeds the Apple Salute screen: last import, period, days, merged workouts, coverage per metric and day
  for the last 90 days at most, sources, and the active energy warning. `PUT /api/health/settings` saves the step goal (2,000–30,000, default 8,000).

## Today API

- `GET /api/health/days/:date` (`today` is resolved in the Nutrition profile timezone) feeds the "Attività e riposo" card: steps,
  distance, the average of the previous 7 days with data, 7-day steps series, the night that ended that morning with its phases,
  7-night sleep series, resting heart rate with the average of the week before (days −13 to −7) and an 8-day series, the sleep
  source label, last import time and last data date (for the stale state). `connected` is false until the first import, and the card stays hidden.

## Timeline API

- `GET /api/workouts?from&to` returns Hevy and Apple Health workouts together (`origin: "hevy" | "health"`), each session once:
  Health records are merged first (see Duplicate workouts); then a merged session that overlaps a Hevy workout by at least half
  of the shorter one, and is a strength session or was written by Hevy, is attached to it and gives only heart rate, kcal and the
  per-minute heart-rate curve (minutes counted from the Hevy start). Other sessions are listed as Health workouts.
- Without `HEVY_API_KEY` only Health workouts are listed (`configured: false`); when Hevy does not answer, Health workouts are
  still listed with `hevyUnavailable: true`.
- The sleep chip uses the night of `GET /api/health/days/:date`.

## Ingest (automatic upload)

- Profilo › Apple Salute › "Sincronizzazione automatica": the switch creates a token and turns the upload on; "Rigenera" replaces
  the token (the old one stops working at once); turning the switch off deletes it. The screen shows the endpoint URL, the token
  (masked, "Copia" copies it), the last upload received and the steps for Health Auto Export.
- `POST /api/health/ingest` is outside Google sign-in and needs `Authorization: Bearer <token>` (the bare token is accepted too),
  compared in constant time. The token is stored encrypted in the secrets table (`health_ingest_token`), never in the repository.
- The body is the same Health Auto Export JSON as the file import and is saved the same way (upserts, the current day is overwritten,
  workouts merged on read), recorded as an import of kind `sync`. Answers: `401 invalid_token`, `400 not_health_export`,
  `200 { saved: false }` for an upload with nothing Intake keeps (so the automation does not retry it), `200 { saved: true, counts }`.
  The body is never logged.
- Owner routes: `GET /api/health/sync`, `POST /api/health/sync/token` (new token, turns it on), `DELETE /api/health/sync` (off).
- Health Auto Export automation: "REST API", JSON format, daily aggregation, only the metrics above, workouts without routes,
  header `Authorization` with `Bearer <token>`, sync every hour.
- If Cloudflare Access protects the app, add a bypass for `/api/health/ingest` only (see docs/deployment.md).
