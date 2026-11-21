# Optional parts (feature switches)

Intake can run as a nutrition-only app or with workouts and Apple Health too. **Alimentazione** is always on; five
parts can be switched on or off for the whole installation.

| Part | Key | What it includes |
|---|---|---|
| Allenamenti | `training` | Training page and recap, Today's training card, Trends › Training, the Hevy or openGym source, the openGym → Hevy copy |
| Salute (Apple Salute) | `health` | Activity and rest, sleep, Effort / Recovery / Sleep rings, Trends › Health, eaten-vs-burned balance, Health Auto Export uploads |
| Promemoria | `reminders` | Web Push reminders for the meals of the plan |
| Pasti da foto | `photoMeals` | New meals from a photo or a description recognized by Claude, the confirmation screen, "+ Aggiungi alimento" there, and the kept photos (thumbnails in the timeline, photo on the meal page). Works only with `ANTHROPIC_API_KEY`; without it the switch stays off and shows what is missing. Off by default on every installation: the add sheet then keeps "Chiedi a Claude" as before. Favorites and "Ripeti un pasto recente" do not depend on it. Also "Genera con l'IA" in Piano (docs/plan-generation.md) and the AI opinion of Piano › Il tuo fabbisogno (the calculation and the data check stay with Alimentazione) |
| Acqua | `water` | Water card on Today, water shortcuts in the add sheet, water KPI and consistency row in Trends › Nutrition, the water goal in Profile, water reminders. On by default |

Alimentazione: Today with the timeline and macros, meals, weight, meal plans, the daily needs and their data check,
the daily insight, Trends › Nutrition and Weight.

## Rules

- The choice is stored once per installation in the `settings` table (key `features`), not per device.
- A part that is off:
  - answers `404 { "error": "feature_disabled", "feature": "<key>" }` on its API routes
    (`/api/training*`, `/api/hevy-sync*` · `/api/health/*` including `/api/health/ingest` · `/api/push*` · `/api/water` · `/api/meals/recognize`, `/api/meals/photos`, `/api/meals/:id/photo`, `/api/needs/ai`, `/api/plans/generate*`, `/api/plans/generation*`, `/api/plans/estimate`, `/api/plans/:id/alternative`);
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

## Web app

- **First-run setup** (`SetupPage`), shown after the Nutrition connection while `setupDone` is false:
  1. "Cosa vuoi seguire?": Solo alimentazione · Alimentazione e allenamenti · Tutto, anche Apple Salute.
  2. "Ultimi dettagli": for Allenamenti, which workout apps are configured (or which environment variables to add);
     for Apple Salute, where to connect Health Auto Export; a switch for water and one for the meal reminders. "Inizia" saves.
- **Profilo › Funzioni**: Alimentazione (always on) and a switch for each optional part, a note that the data is
  kept, and "Rifai la configurazione" (sets `setupDone` back to false, so the setup opens again with the current
  choice preselected).
- A part that is off disappears everywhere: sidebar and Andamento switch (left out entirely when Alimentazione is
  the only page), the rings, training card and activity card on Today, the Allenamenti card, the connection rows and the Promemoria card in Impostazioni (with their section links);
  its pages (`/andamento/allenamenti`, `/andamento/salute`, `/profilo/salute`) go back to Oggi. Its queries are
  never sent while it is off (`useFeature` in `apps/web/src/api/queries.ts`).

## API

- `GET /api/features` → `{ setupDone, training, health, reminders, water, photoMeals, gymApps: { hevy, opengym }, recognition, recognitionConfigured }` (`recognition` is true when the key is set and `photoMeals` is on)
- `PUT /api/features` with any subset of `{ setupDone, training, health, reminders, water, photoMeals }` → the same shape.
