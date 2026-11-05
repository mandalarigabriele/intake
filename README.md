# Intake

<img src="apps/web/public/icons/icon-192.png" alt="Intake logo" width="96" height="96" />

Self-hosted nutrition dashboard with a daily meal timeline, macro tracking and meal plans, powered by the Nutrition MCP server.

## Features

### Available now

- Project scaffold: npm workspaces (`packages/shared`, `apps/server`, `apps/web`), single Docker image, docker compose.
- Meal plan file format with validation (zod) and a generated JSON Schema, including optional sugar, added sugar, saturated fat, sodium and caffeine so that meals logged from the plan are complete. See [docs/meal-plan-format.md](docs/meal-plan-format.md).
- Server health endpoint (`GET /api/health`) and environment validation at startup.
- Web app shell, installable on iPhone via Safari "Add to Home Screen" (web app manifest and icons, safe-area aware, light and dark themes).

### Planned – version 1

- Today view: calorie ring (eaten / goal / remaining), macro bars (protein, carbs, fat, fiber) with remaining amounts, water tracker with a quick "+250 ml" button.
- Vertical meal timeline: logged meals as solid cards, a "now" marker, planned meals from the active plan as dashed cards with a "Mark as eaten as planned" action.
- Meal detail: foods with quantities, macros breakdown, fiber, sugar (added sugar), caffeine.
- Edit and delete logged meals.
- Week day navigation.
- Weight logging view and weekly trends.
- Meal plan section: upload a JSON plan file; it becomes active from its `validFrom` date onward; previous versions are kept as history.
- Sign in with Google, restricted to the owner's account.
- One-time Nutrition MCP OAuth connection with the refresh token stored server-side.

### Planned – phase 2

- Add a free meal or a saved meal from the app.
- Automated deploy via GitHub Actions.

## Tech stack

- Backend: Node.js 22, TypeScript, Fastify, MCP client of the Nutrition MCP server.
- Frontend: React, Vite.
- Storage: live data from the Nutrition MCP server; local SQLite only for meal plans and tokens.
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
cp .env.example .env      # fill in the values (placeholders are fine until auth is implemented)
npm run dev:server        # http://localhost:3000
npm run dev:web           # http://localhost:5173, proxies /api, /auth and /connect to the server
```

Other commands:

| Command | Purpose |
|---|---|
| `npm test` | Run all tests |
| `npm run typecheck` | Type-check all workspaces |
| `npm run build` | Build shared, server and web |
| `npm run schema` | Regenerate `schemas/meal-plan.schema.json` after changing the meal plan schema |

## Deployment

See [docs/deployment.md](docs/deployment.md). In short: `git pull && docker compose up -d --build` on the server, with secrets in `.env` next to `docker-compose.yml`.

## Configuration

All configuration comes from environment variables; see [.env.example](.env.example). Secrets never go in the repository.
