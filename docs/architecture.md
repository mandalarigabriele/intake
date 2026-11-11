# Architecture

```
Browser (desktop, iPad, iPhone PWA)
        │  HTTPS, session cookie
        ▼
Cloudflare Tunnel ──────────────────────→ intake container (Fastify, port 3000, on dockerdmz)
                                              │
                                              ├── serves the built web app (apps/web/dist)
                                              ├── REST API under /api
                                              ├── Google sign-in under /auth (owner only)
                                              ├── one-time Nutrition OAuth under /connect/nutrition
                                              │
                                              ├── SQLite in /data: plans, plan↔meal links, encrypted MCP token
                                              │
                                              └── MCP client ──► Nutrition MCP server (nutrition-mcp.com/mcp)
```

## Principles

- **Live data.** Meals, goals, water and weight are read from the Nutrition MCP server on every request. The local database never caches them, so the app never shows stale or conflicting numbers.
- **Local data only where needed.** SQLite stores meal plan versions, which logged meal fulfilled which planned meal (so a planned card disappears once it has been marked as eaten), and the encrypted Nutrition refresh token.
- **Careful parsing.** MCP tool responses are often formatted text. Each tool has a parser in `apps/server/src/parsers/`, tested against real responses in `__fixtures__/`. `structuredContent` is used when a tool provides it.
- **Two separate logins.** Google sign-in protects the app and only admits `OWNER_EMAIL`. The Nutrition OAuth connection is done once by the owner; the server keeps the refresh token and renews access tokens on its own.
- **Timezone.** "Today" and the timeline's "now" marker follow the Nutrition profile's timezone.

## Planned server modules

| Path | Responsibility |
|---|---|
| `src/auth/` | Google OIDC sign-in, signed session cookie, owner check |
| `src/mcp/` | MCP client (Streamable HTTP), OAuth provider, token store, typed tool wrappers |
| `src/parsers/` | Text tool output → typed objects |
| `src/services/` | Day view, timeline merge (logged + planned), plans, weight trends |
| `src/db/` | SQLite access and migrations |
| `src/routes/` | HTTP routes |
