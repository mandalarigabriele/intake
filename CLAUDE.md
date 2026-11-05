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
- Colors are tokens in `apps/web/src/styles/tokens.css`, chosen separately for light and dark. Chart colors (meters, macros, water, over-goal) were validated for colorblind separation and contrast; re-validate before changing them. Over-goal states use an icon and a label, never color alone.

## Layout

- `packages/shared` – code shared by server and web: meal plan zod schema and types, API DTOs.
- `apps/server` – Node.js + TypeScript (Fastify). MCP client of the Nutrition MCP server, Google sign-in, REST API, serves the built web app.
- `apps/web` – React + Vite frontend, installable on iPhone via "Add to Home Screen".
- `schemas/meal-plan.schema.json` – generated from the zod schema with `npm run schema`; never edit it by hand.
- `docs/` – architecture, deployment and meal plan format.

## Architecture notes

- Nutrition data (meals, goals, water, weight) is read **live** from the Nutrition MCP server on every request. Do not cache it in the local database.
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
