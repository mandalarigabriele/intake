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
- User-facing text is Italian and lives in `apps/web/src/lib/strings.ts`; numbers and dates use Italian formatting (`apps/web/src/lib/format.ts`). Code, comments and docs stay English.
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

- Nutrition data (meals, goals, water, weight) is read **live** from the Nutrition MCP server. Do not cache it in the local database.
- The Nutrition MCP server allows **60 requests per minute** per account. `NutritionApi` keeps identical reads in memory for 30 seconds (concurrent identical calls share one request; any write clears the cache) and computes the clock locally from the profile timezone. Keep new screens within that budget, and never reconnect on a rate-limit error (`RateLimitedError`, returned to the web app as 503 with `retryAfter`).
- SQLite uses the built-in `node:sqlite` module (no native dependencies). Migrations are an append-only list in `apps/server/src/db/database.ts`.
- The local SQLite database (in `/data`) only stores what the MCP server does not have: meal plan versions, links between planned meals and logged meals, and the encrypted MCP refresh token.
- MCP tool responses are often formatted text. Parsing lives in `apps/server/src/parsers/`, and every parser is covered by tests that use real responses saved in `__fixtures__/`. Prefer `structuredContent` when a tool provides it.
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
