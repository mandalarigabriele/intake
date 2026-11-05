# Intake

<img src="apps/web/public/icons/icon-192.png" alt="Intake logo" width="96" height="96" />

Self-hosted nutrition dashboard with a daily meal timeline, macro tracking and meal plans, powered by the Nutrition MCP server.

## Features

### Available now

- Project scaffold: npm workspaces (`packages/shared`, `apps/server`, `apps/web`), single Docker image, docker compose.
- Meal plan file format with validation (zod) and a generated JSON Schema, including optional sugar, added sugar, saturated fat, sodium and caffeine so that meals logged from the plan are complete. See [docs/meal-plan-format.md](docs/meal-plan-format.md).
- Server health endpoint (`GET /api/health`) and environment validation at startup.
- Nutrition MCP connection: one-time OAuth login at `/connect/nutrition` (dynamic client registration, PKCE), refresh token stored encrypted (AES-256-GCM) in SQLite and renewed automatically, connection status at `GET /api/nutrition/status` and `POST /api/nutrition/disconnect`.
- `npm run capture -w @intake/server` saves raw responses of the read-only Nutrition tools for building parser fixtures.
- Parsers for Nutrition MCP responses (meals with foods and all tracked nutrients, nutrition goals, current time and timezone), tested against real server output. Unrecognized fields are reported as warnings instead of being silently dropped.
- Sign in with Google, restricted to the owner's account (`OWNER_EMAIL`): OpenID Connect with PKCE and nonce, signed httpOnly session cookie valid for 30 days, sign-out. All data routes and the Nutrition connection require it. See [docs/google-sign-in.md](docs/google-sign-in.md).
- Today view: calorie ring (eaten / goal / remaining), macro bars for protein, carbs, fat and fiber with remaining or excess amounts, water as 250 ml glasses with a quick "+250 ml" button (idempotent, optimistic update).
- Week strip (Monday to Sunday) to switch day; the selected day is kept in the URL.
- Meal timeline with logged meals (foods with quantities, kcal, macro chips) and a "now" marker for today.
- Italian UI with Italian number and date formatting; responsive layout (one column on iPhone, two columns on iPad and desktop); automatic light and dark mode with colorblind-validated chart colors.
- Day API: `GET /api/days/:date` (or `today`, in the Nutrition profile's timezone) and `POST /api/water`.
- Web app shell with sign-in screen, installable on iPhone via Safari "Add to Home Screen" (web app manifest and icons, safe-area aware, light and dark themes).

### Planned – version 1

- Planned meals from the active plan in the timeline, as dashed cards with a "Mark as eaten as planned" action.
- Meal detail: foods with quantities, macros breakdown, fiber, sugar (added sugar), caffeine.
- Edit and delete logged meals.
- Navigation to previous and next weeks.
- Weight logging view and weekly trends.
- Meal plan section: upload a JSON plan file; it becomes active from its `validFrom` date onward; previous versions are kept as history.

### Planned – phase 2

- Add a free meal or a saved meal from the app.
- Automated deploy via GitHub Actions.

## Tech stack

- Backend: Node.js 22, TypeScript, Fastify, MCP client of the Nutrition MCP server.
- Frontend: React, Vite.
- Storage: live data from the Nutrition MCP server; local SQLite (`node:sqlite`, no native dependencies) only for meal plans and tokens.
- Packaging: Docker and docker compose.

## Repository layout

```
packages/shared   meal plan schema and types shared by server and web
apps/server       Fastify server: API, auth, MCP client, serves the web app
apps/web          React + Vite frontend (PWA)
schemas/          generated JSON Schema of the meal plan file
examples/         example meal plan
docs/             architecture, deployment, meal plan format
```

## Development

Requires Node.js 22 or later.

```sh
npm install
cp .env.example .env      # fill in the values, see docs/google-sign-in.md for the Google ones
npm run dev:server        # http://localhost:3000
npm run dev:web           # http://localhost:5173, proxies /api, /auth and /connect to the server
```

For local development set `PUBLIC_BASE_URL=http://localhost:3000` and `DATA_DIR=./data` in `.env`. Then open http://localhost:3000, sign in with Google and, if needed, connect the Nutrition account once; its token is stored in `apps/server/data/intake.db`.

Other commands:

| Command | Purpose |
|---|---|
| `npm test` | Run all tests |
| `npm run typecheck` | Type-check all workspaces |
| `npm run build` | Build shared, server and web |
| `npm run capture -w @intake/server` | Save raw Nutrition MCP responses to `apps/server/captures/` (gitignored) |
| `npm run schema` | Regenerate `schemas/meal-plan.schema.json` after changing the meal plan schema |

## Deployment

See [docs/deployment.md](docs/deployment.md). In short: `git pull && docker compose up -d --build` on the server, with secrets in `.env` next to `docker-compose.yml`.

## Configuration

All configuration comes from environment variables; see [.env.example](.env.example). Secrets never go in the repository.
