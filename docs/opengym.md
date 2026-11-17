# openGym as the workout source

[openGym](https://opengym.ch) is a self-hosted gym tracker. Intake can read workouts from it instead of Hevy:
one source at a time, chosen in Profile › Connections ("Fonte allenamenti"). Both are read live; nothing about
workouts is stored in Intake's database.

## Setup

1. In openGym, Settings → API tokens: create a token named `Intake` with **view** on workouts and plans
   (Intake never writes). It starts with `ogt_` and is shown once.
2. In the server `.env`:
   ```
   OPENGYM_URL=http://<openGym address reachable from the Intake container>
   OPENGYM_TOKEN=ogt_...
   # optional, when OPENGYM_URL is an internal address: the one the browser opens
   OPENGYM_PUBLIC_URL=https://<public openGym address>
   ```
   On the shared Docker host the internal address avoids Cloudflare (e.g. `http://<dockerdmz-ip>:8080`).
3. `bash deploy.sh`, then choose openGym in Profile › Connections. With only one source configured it is used directly.

## What is read

The token works on two openGym endpoints:

| Endpoint | Used for |
|---|---|
| `GET /api/token/data` (app state) | finished workouts with their start and end times (Timeline position, Apple Health matching), routines, the weekday plan |
| `POST /mcp` (MCP tools, stateless JSON-RPC) | `get_week_plan` (next planned session), `preview_session` (the session openGym opens with after its progression policy, with the reason), `muscle_balance` (last month), `get_workout` and `get_routine` (exercise names) |

- Requests carry `Authorization: Bearer <token>`; the MCP endpoint needs `Accept: application/json, text/event-stream`.
- Reads are cached in memory for a minute; exercise names of a finished workout are kept for the process lifetime.
- At most four requests run at a time (reading the history asks for one workout per session). A request that fails at the network level is retried once; a timeout (10 s) is not.
- When openGym does not answer, the Timeline still lists Apple Health workouts and the Training page says so.

## How the data is shown

- **Workouts** are mapped to the same shape as Hevy's, so the Timeline cards, the workout marks on Trends › Nutrition,
  the Apple Health heart-rate matching and the load charts work the same way. Sessions without a done set (opened and
  closed) are skipped. The `activities` openGym imports from Apple Health are ignored: Intake reads Health directly.
- **Next session**: the first day of the week plan from today whose routine is not done yet, with openGym's
  opening sets (weight × reps), the routine's rep range for context, and the reason when the opening differs from the
  routine. Known reasons are translated; others show a generic line with the original as a tooltip.
- **Cardio from Apple Health**: a cardio routine (no exercise counts reps, e.g. "Cyclette — Zona 2") planned today
  counts as done when Apple Health has a workout of the same family that day (a bike routine → an indoor or outdoor
  ride, a walking routine → a walk). The next session moves on and today's tile shows the routine as done. Nothing is
  written to openGym, where the session stays not done; another sport (e.g. football) does not count.
- **Week**: the routine number on days done, the planned routine outlined on the days to come, done out of the
  planned weekdays.
- **Load progress**: the first two weighted exercises of each routine, best working set per session; only the trend
  (last session, since the first session, steady). No "try X kg" from Intake: openGym's preview decides the next load.
- **Muscles**: trained most (level 4) and not trained in the last month, from `muscle_balance`.
- **Today card** ("Allenamento di oggi"): done today, today's planned session with its first exercises, or rest with
  the next session.
- Exercise names come in English lower case from openGym's library; known ones are translated in `strings.ts`.
- Body weight stays on Nutrition; openGym's weight log is not read.

## Troubleshooting

- `openGym request failed: fetch failed (CODE …)` in the server logs means Intake cannot reach `OPENGYM_URL` from its container. `ECONNREFUSED` or `ENOTFOUND` point to a wrong address or a container on another Docker network; `ECONNRESET` points to the proxy in front of openGym dropping connections.
- `openGym answered 401` or `403` means the token is wrong or lacks a scope.
