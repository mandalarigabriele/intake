# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Intake is a self-hosted, responsive nutrition dashboard with a daily meal timeline, macro tracking, meal plans and weight trends, powered by the Nutrition MCP server (`https://nutrition-mcp.com/mcp`).

## Rules

- All code, comments, documentation, commit messages, tags and release notes must be written in **English only**.
- The **README must always be kept up to date** with the complete list of features, on every change.
- **Secrets** (Google OAuth credentials, MCP tokens, session keys) live only in an environment file on the server, **never in the repository**. Only variable names go in `.env.example`.

## UI

- The UI must be flexible and modern, follow the system light/dark mode automatically, and work on desktop, iPad and iPhone (including the installed home-screen app with safe-area insets). Check every UI change at phone, tablet and desktop widths in both color schemes, with no horizontal scrolling.
- User-facing text lives in `apps/web/src/lib/i18n/`: `it.ts` is the reference, the default and the fallback (Italian), and `en.ts` / `nl.ts` have the same shape; every new string goes in all three (the type check fails when one is missing, and at runtime a missing translation falls back to Italian). Components import `t` from `apps/web/src/lib/strings.ts`. The language is one for the whole installation (settings key `language`, `db/languageStore.ts`, Profile › Lingua), Italian until changed, with a copy on each device; changing it reloads the app. Numbers and dates use the locale of that language (`apps/web/src/lib/format.ts`). Code, comments and docs stay English.
- `docs/design/` is the source of truth for the UI: `DESIGN.md` (navigation, timeline behavior, tokens) and the approved mockups in `screens/`. Rebuild screens from them; do not invent new layouts.
- Colors are tokens in `apps/web/src/styles/tokens.css`, each defined once with `light-dark()` using the light and dark columns of `DESIGN.md`. Components never use raw hex. The theme follows the system, with a manual override (Sistema / Chiaro / Scuro) in the profile menu stored per device (`apps/web/src/lib/theme.ts`). Every colored state also carries a text label (e.g. "ADESSO", "Fibre 7 g", "▲ in eccesso"), never color alone.
- Font: Manrope, bundled with `@fontsource-variable/manrope` (works offline in the installed app).

## Layout

- `packages/shared` – code shared by server and web: meal plan zod schema and types, API DTOs.
- `apps/server` – Node.js + TypeScript (Fastify). MCP client of the Nutrition MCP server, Google sign-in, REST API, serves the built web app.
- `apps/web` – React + Vite frontend, installable on iPhone via "Add to Home Screen".
- `schemas/meal-plan.schema.json` – generated from the zod schema with `npm run schema`; never edit it by hand.
- `docs/` – architecture, deployment and meal plan format.

## Architecture notes

- Nutrition data (meals, goals, water, weight) is read **live** from the Nutrition MCP server. Do not cache it in the local database. The only copy kept is the daily backup: the original `export_all_data` ZIP saved as a file in `<DATA_DIR>/backups/nutrition/` (`services/nutritionBackups.ts`), never opened or read by the app, newest 10 kept by default. Rules in `docs/backups.md`.
- The Nutrition MCP server allows **60 requests per minute** per account. `NutritionApi` keeps identical reads in memory for 30 seconds (concurrent identical calls share one request; any write clears the cache) and computes the clock locally from the profile timezone. Keep new screens within that budget, and never reconnect on a rate-limit error (`RateLimitedError`, returned to the web app as 503 with `retryAfter`).
- SQLite uses the built-in `node:sqlite` module (no native dependencies). Migrations are an append-only list in `apps/server/src/db/database.ts`.
- The local SQLite database (in `/data`) only stores what the MCP server does not have: meal plan versions, links between planned meals and logged meals, skipped planned meals, reminder settings, push subscriptions and sent reminders, the encrypted MCP refresh token and the encrypted VAPID keys, Apple Health data (see below), and the links of the openGym → Hevy copy, which optional parts are on, the Claude model of the meal recognition, the fields, applied source and last AI opinion of Il tuo fabbisogno (settings key `needs`), the backup settings (how many to keep, last attempt), the plan generation preferences and model (settings key `plan_generation`), and the photos of meals logged from a photo (files in `<DATA_DIR>/meal-photos/`, `db/mealPhotoStore.ts`).
- Reminders (`apps/server/src/services/reminders.ts`, `reminderScheduler.ts`) run in the server once a minute. They decide from the local plan times and read Nutrition only when a reminder is due; keep it that way. Notification text is built on the server in `reminders.ts`, in the installation language; together with the daily insight sentences (`services/insight.ts`) it is the only user-facing text outside `lib/i18n/`, and it also comes in Italian, English and Dutch. The service worker (`apps/web/public/sw.js`) only shows notifications and never caches.
- MCP tool responses are often formatted text. Parsing lives in `apps/server/src/parsers/`, and every parser is covered by tests that use real responses saved in `__fixtures__/`. Prefer `structuredContent` when a tool provides it.
- The daily insight (`GET /api/insight`) costs several Nutrition calls, so the route keeps the chosen sentence in memory for an hour per date; the sentence is picked deterministically from the day, not at random.
- Hevy workouts (`apps/server/src/hevy/`, parser `parsers/hevy.ts`) are read live from the Hevy public API with the optional `HEVY_API_KEY`; pages are kept in memory for 5 minutes and never stored. Workout dates use the Nutrition profile timezone.
- openGym (`apps/server/src/opengym/`, parser `parsers/openGym.ts`) is the alternative workout source (`OPENGYM_URL` + `OPENGYM_TOKEN`, read-only scoped token): app state for workout times, MCP tools for the week plan, session preview and muscle balance. One source at a time (`services/gymSource.ts`, choice stored in the settings table); openGym workouts are mapped to the Hevy shape so the rest of the code is shared. Rules in `docs/opengym.md`.
- The optional openGym → Hevy copy (`services/hevySync.ts`, `routes/hevySync.ts`) is off until turned on in Profile. It reads openGym, writes only to Hevy (private workouts), never copies a workout that already overlaps one in Hevy, and stores only links (`db/hevySyncStore.ts`). Rules in `docs/hevy-sync.md`.
- Optional parts (`db/featureStore.ts`, `routes/features.ts`): Alimentazione is always on; Allenamenti, Salute, Promemoria, Acqua and Pasti da foto (`photoMeals`: photo and text recognition with `ANTHROPIC_API_KEY`, the confirmation screen and the kept photos; off by default) can be switched per installation (settings key `features`). A part that is off answers 404 `feature_disabled` on its routes, stops its background work and gives other screens no data; new routes of a part must match its prefix in `routes/features.ts` (`FEATURE_ROUTES`). Rules in `docs/features.md`.
- Apple Health data comes from Health Auto Export JSON (`parsers/healthAutoExport.ts`) and is stored in SQLite (`db/healthStore.ts`): it is the only exception to "read live", because Health cannot be queried from the server. Writes are upserts (the current day is overwritten, never summed). Workouts are stored raw and merged on read (`services/healthWorkouts.ts`). Never store GPS routes, all-day per-minute heart rate, medications, mood, nutrition or weight. Rules in `docs/apple-health.md`.
- Meal recognition (`services/mealRecognition.ts`, part Pasti da foto) calls the Claude API only when the user asks ("Analizza", "+ Aggiungi alimento", "Aggiungi i cibi con l'IA") with the photos (up to 6 per meal, `<DATA_DIR>/meal-photos/<meal id>/<photo id>.jpg`) and/or the note and nothing else; It uses the official SDK (`@anthropic-ai/sdk`) with a structured output (JSON schema) at low effort; the model is chosen in Impostazioni (settings key `recognition_model`, `db/recognitionModelStore.ts`, Haiku by default, `RECOGNITION_MODEL` as the starting value). `ANTHROPIC_API_KEY` stays in the server `.env` and is never logged; each request logs only its token usage. Nothing is logged to Nutrition before the user confirms. Rules in `docs/photo-meals.md`.
- Plan generation (Piano › Genera con l'IA, part Pasti da foto, `routes/planGeneration.ts`, `services/planGenerator.ts`, shared `packages/shared/src/planGeneration.ts`): preferences and the plan model live in the settings table (key `plan_generation`, `db/planGenerationStore.ts`); the week is a background job kept in memory for an hour (nothing is saved until "Attiva"); the checks are plain code and the AI corrects once; "Sostituisci" and the time edits work on the draft, and times also on a stored plan (`PATCH /api/plans/:id/time`). Routes match `FEATURE_ROUTES`. Rules in `docs/plan-generation.md`.
- Shopping list and PDF (`packages/shared/src/shoppingList.ts`, pages `ShoppingListPage` and `PlanPrintPage`, routes `/piano/spesa` and `/piano/stampa`): computed in the browser from the plan Piano shows, plain arithmetic, no AI, nothing stored; the print page works through `@media print` styles (the app shell scrolls only `.shell-main`, so print styles must let the page flow). Rules in `docs/shopping-list.md`.
- Il tuo fabbisogno (Piano, `routes/needs.ts`, calculation and data check in `packages/shared/src/needs.ts`): plain arithmetic from the form fields, the Nutrition weight and the last 3 weeks of Nutrition summary; the AI opinion (`services/needsAdvisor.ts`, `/api/needs/ai`, part Pasti da foto) is asked only on request and its proposal always goes through the safety limits (`limitTargets`); goals are applied with `set_nutrition_goals`. Rules in `docs/needs.md`.
- "Today" and the timeline's "now" marker use the timezone of the Nutrition profile, not the container's timezone.
- Google sign-in protects the app and admits only `OWNER_EMAIL`. It is separate from the one-time Nutrition OAuth connection.

## Commands

- `npm install` – install all workspaces.
- `npm run dev:server` / `npm run dev:web` – run the server (port 3000) and the Vite dev server (port 5173, proxies the API).
- `npm test` – run all tests.
- `npm run typecheck` – type-check all workspaces.
- `npm run build` – build shared, server and web.
- `npm run capture -w @intake/server` – save raw Nutrition MCP responses to `apps/server/captures/` (gitignored, real data). Copy one into `src/parsers/__fixtures__/` with IDs replaced before changing a parser.
- `npm run schema` – regenerate `schemas/meal-plan.schema.json` after changing the meal plan schema.
- `npm run check:standards` – check the machine-verifiable rules (no committed `.env`, empty secrets in `.env.example`, no raw hex in the web app, schema up to date). Runs in CI.

## Contributions

Outside contributors work from a fork and follow [CONTRIBUTING.md](CONTRIBUTING.md); keep it in sync when a rule here changes.
