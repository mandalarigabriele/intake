# Contributing to Intake

Thanks for helping. This page explains how a change goes from your idea to production and what every pull request must respect. The full project rules are in [CLAUDE.md](CLAUDE.md): read it once before your first change. If you work with Claude Code, it reads that file automatically.

## How a change reaches production

1. **Fork** the repository on GitHub and clone your fork.
2. Create a **branch** from an up-to-date `main`: `feature/<short-name>` for new things, `fix/<short-name>` for bug fixes, `docs/<short-name>` or `chore/<short-name>` for the rest.
3. Make the change, then run the checks locally (see below).
4. Open a **pull request** against `mandalarigabriele/intake:main` and fill in the template.
5. CI runs on the pull request. For contributors outside the repository it starts after the maintainer approves the run.
6. The maintainer reviews. When the pull request is approved and CI is green, it is **squash-merged**. The merge to `main` starts the automatic **deploy** and the **GitHub release** (see [docs/deployment.md](docs/deployment.md#automatic-deploy-github-actions)).

Keep one topic per pull request. Small pull requests are reviewed faster.

## Checks to run before opening a pull request

```sh
npm install
npm run typecheck
npm test
npm run build
npm run check:standards
```

CI runs the same commands; a pull request with a red check is not merged.

`check:standards` verifies the rules a machine can check: no `.env` files committed, no values in `.env.example`, no raw hex colors in the web app, and an up-to-date `schemas/meal-plan.schema.json`.

## Standards

### Language

- Code, comments, documentation, commit messages, branch names and pull requests: **English**.
- User-facing text: only in `apps/web/src/lib/i18n/`. **Italian** (`it.ts`) is the reference, the default and the fallback; add every new text to `en.ts` (English) and `nl.ts` (Dutch) too, with the same keys. `npm run typecheck` fails when a translation is missing; if you cannot translate a text, ask in the pull request. The server notification texts (`apps/server/src/services/reminders.ts`) and the daily insight sentences (`apps/server/src/services/insight.ts`) are the only exceptions, in the same three languages. Numbers and dates go through `apps/web/src/lib/format.ts`, which follows the chosen language.

### Commits and pull requests

- Commit messages and pull request titles are one sentence in the imperative, starting with a capital letter, no prefix and no final period: `Show HRV calibration progress in the Recovery details`.
- The pull request title becomes the squash commit and the release title, so write it for someone reading the release list.
- The description says **what** changed and **why**, and how you tested it (commands, screen widths, light and dark mode).

### Documentation

- The **README** must list every feature: update it in the same pull request when you add, change or remove one.
- Update the matching page in `docs/` when you change how something works.

### Secrets

Never commit credentials, tokens, API keys, `.env` files or real personal data (meals, weight, Health exports). Only variable names go in `.env.example`. Test fixtures built from real responses must have IDs and personal values replaced.

### UI

- `docs/design/DESIGN.md` and the mockups in `docs/design/screens/` are the source of truth: rebuild from them, do not invent new layouts.
- Colors are tokens from `apps/web/src/styles/tokens.css`, never raw hex. Every colored state also has a text label.
- Check every UI change at phone, tablet and desktop widths, in light and dark mode, with no horizontal scrolling, and say in the pull request what you checked. Screenshots are not required.

### Server

- Nutrition data is read live from the Nutrition MCP server and never cached in SQLite; respect the 60 requests per minute budget (see [docs/architecture.md](docs/architecture.md)).
- Database migrations are append-only (`apps/server/src/db/database.ts`): never edit or reorder an existing one.
- Every parser change comes with a test that uses a saved real response in `apps/server/src/parsers/__fixtures__/`.
- New routes of an optional part must match its prefix in `apps/server/src/routes/features.ts`.
- New behavior comes with tests.

### Dependencies

Add a dependency only when it is clearly needed, and say why in the pull request. No native modules (SQLite uses the built-in `node:sqlite`).
