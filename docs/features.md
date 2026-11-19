# Optional parts (feature switches)

Intake can run as a nutrition-only app or with workouts and Apple Health too. **Alimentazione** is always on; three
parts can be switched on or off for the whole installation.

| Part | Key | What it includes |
|---|---|---|
| Allenamenti | `training` | Training page and recap, Today's training card, Trends › Training, the Hevy or openGym source, the openGym → Hevy copy |
| Salute (Apple Salute) | `health` | Activity and rest, sleep, Effort / Recovery / Sleep rings, Trends › Health, eaten-vs-burned balance, Health Auto Export uploads |
| Promemoria | `reminders` | Web Push reminders for the meals of the plan |

Alimentazione: Today with the timeline and macros, meals, water, weight, meal plans, the daily insight, Trends ›
Nutrition and Weight.

## Rules

- The choice is stored once per installation in the `settings` table (key `features`), not per device.
- A part that is off:
  - answers `404 { "error": "feature_disabled", "feature": "<key>" }` on its API routes
    (`/api/training*`, `/api/hevy-sync*` · `/api/health/*` including `/api/health/ingest` · `/api/push*`);
    `/api/health` (the server's own liveness check) is not part of Salute. `/api/workouts` serves both parts: it is
    hidden only when Allenamenti and Salute are both off, and lists only Apple Health sessions while Allenamenti is off;
  - stops its background work: the openGym → Hevy copy for Allenamenti, the reminder checks for Promemoria;
  - gives the other screens no data: with Salute off the week balance, the insight and the workouts see no Apple
    Health values (`healthWhenOn` in `apps/server/src/db/featureStore.ts`);
  - **keeps its data**: turning it back on shows everything again.
- Credentials still come from the environment file (`HEVY_API_KEY`, `OPENGYM_URL` + `OPENGYM_TOKEN`); a switch only
  decides whether a configured part is used. `GET /api/features` reports which workout apps are configured.

## First run and existing installations

- A new installation starts with every optional part off and `setupDone: false`; the web app shows the first-run
  setup after the Nutrition connection.
- An installation from before the switches has no stored choice: at start-up the server keeps on what it already uses
  (Salute if Apple Health data was imported, Allenamenti if a workout app is configured, Promemoria always, as
  it costs nothing without subscribed devices) and marks the setup as done.

## API

- `GET /api/features` → `{ setupDone, training, health, reminders, gymApps: { hevy, opengym } }`
- `PUT /api/features` with any subset of `{ setupDone, training, health, reminders }` → the same shape.
