# Intake — UI design handoff

The `screens/` folder holds the approved mockups as `.dc.html` files (one per screen).
They are **reference markup**, not production code: read them for layout, spacing,
colors, copy and behavior, then rebuild them as React components in `apps/web`.
They load a `support.js` runtime that is not included, so they will not render as-is.
All UI copy is in Italian (the app language); code, comments and docs stay in English.

## Screens

| File | Screen | Notes |
|---|---|---|
| `Login.dc.html` | Sign in with Google | Owner-only access note under the button |
| `Collega.dc.html` | Connect Nutrition (one-time) | Google ✓ and Nutrition "to connect", 3-step explainer |
| `Main.dc.html` | Today (summary) | Week strip, **Next meal** card, calorie ring, macro bars, water, **Activity & rest**, **daily insight**. Tweaks: Health state, balance preview |
| `Timeline.dc.html` | Timeline (today) | Sleep chip, meals, planned meals on a continuous rod; day arrows; skip / undo |
| `TimelineMar10.dc.html` | Timeline (past day) | Example with a Health workout (MERACH indoor cycling) expanded and a short night |
| `TimelineMer11.dc.html` | Timeline (past day) | Example with a Hevy workout enriched with heart rate from Health, expanded |
| `Salute.dc.html` | Profile › Apple Salute | Data status, active-energy warning, file import, auto-sync (phase 2), step goal |
| `SaluteImport.dc.html` | Import preview | Preview, duplicates resolved, ignored data, result; states via the `stato` tweak |
| `Aggiungi.dc.html` | Add sheet (opened by `+`) | Water shortcuts, today's plan meals, repeat / saved / search / barcode |
| `Pasto.dc.html` | Meal detail | kcal, macro split bar, items with quantities, fiber/sugar/caffeine |
| `Modifica.dc.html` | Edit meal | Meal type, time, items (edit/remove/add), values; delete with confirmation sheet |
| `Settimana.dc.html` | Week | Kcal bars with workout marks, averages, Consistency, **Workouts**, **Steps**, **Sleep**, **Resting HR**, weight |
| `Piano.dc.html` | Meal plan | Day tabs (today preselected), meals of the selected day, "Libero" cards; `⋯` menu for upload + history |
| `Desktop.dc.html` | Desktop / iPad — Today | Fluid layout: sticky sidebar; left column = calories, macros, water; right column = Next meal, insight. Timeline stays its own section, never inside Today |
| `OggiDark.dc.html`, `PianoDark.dc.html` | Dark mode references | See "Dark mode" |

## Navigation

- Mobile: bottom tab bar **always fixed on screen** (content scrolls above it), 5 slots:
  `Oggi · Settimana · [+] · Piano · Timeline`. The `+` is the round dark button in the middle slot and opens the add sheet.
  There is no floating button.
- Meal detail, edit and the add sheet are pushed/modal screens, without the tab bar.
- The avatar in Today opens the profile, where "Apple Salute" lives.
- Desktop/iPad (≥ 800 px): left sidebar with `Oggi · Settimana · Piano · Timeline` plus a "+ Aggiungi" button, sticky while the page scrolls.
- Weight has no dedicated section: it is a card in **Settimana** (one weigh-in per week).
- Shopping list is **not** in the app: the user keeps it in Apple Reminders ("Spesa"). A later iOS Shortcut may pull the list from the active plan.
- No training section in v1.

## Today (summary)

1. **Next meal** card (accent border), right under the week strip:
   - Shows the first planned meal of today that is neither logged nor skipped. If a planned meal's time has passed
     without being logged, it shows that one (it is "to log").
   - Label "PROSSIMO PASTO", time-to-meal ("tra 55 min"), title with time, estimated kcal, item list.
   - Actions: primary "Mangiato come previsto"; secondary row "Altro…" (opens the add sheet), "Salta", "Giornata" (opens Timeline).
   - Footer line with the meal after it ("Poi · Pranzo 13:00 · …").
   - After "Salta": a grey banner "Spuntino delle 11:00 saltato · Annulla" and the card moves to the next meal.
2. Calorie ring, macro bars (protein, carbs, fat, fiber) and water, as before.
3. **Daily insight** card ("DAI TUOI DATI"): one sentence derived from the user's own data, with its window
   ("Ultimi 7 giorni · 3 giorni registrati"). Source: `get_meal_patterns` and `get_digest` (last 7 days).
   Rules: pick one deterministic insight per day (e.g. breakfast effect, protein per meal, late dinners, weekday vs weekend),
   never invent numbers, hide the card when fewer than 3 days are logged. No LLM needed.

## Timeline behavior

- A **continuous vertical rod** runs through the whole day, behind the time labels:
  solid accent color up to the "now" marker, dashed grey after it.
- Item states:
  - **Logged** (from Nutrition MCP): solid white card with kcal and macro chips. Tap → meal detail.
  - **To log / "Da registrare"**: a planned meal whose time has passed and that has no linked logged meal.
    Light orange card, buttons "Mangiato come previsto", "Altro…" (opens the add sheet) and "Salta".
  - **Planned / "Dal piano"**: an upcoming planned meal. Dashed card with a small "Salta" button.
  - **Skipped / "Saltato"**: grey card, title struck through, "Annulla" button.
- The red "ADESSO" marker sits between past and upcoming items, using the Nutrition profile timezone.
- Planned meals without a time in the plan use default slots (breakfast 08:00, lunch 13:00, dinner 20:00), configurable later.

## Skipping a meal

- Available from the Next meal card and from Timeline (planned and to-log items).
- Skipping writes **nothing** to Nutrition: it is stored locally in SQLite as `(date, plan entry id, status = skipped)`,
  next to the existing plan entry ↔ logged meal link. Undo deletes that row.
- A skipped meal no longer counts as "to log" and is excluded from the Next meal card.
- Skips are counted in the Week consistency card.

## Week — Consistency card

Rows (label, short note, value):
- Days logged in a row (current streak).
- Protein at target (days ≥ goal / completed logged days), note with the best day.
- Water at target (same rule).
- Meals as planned (count of plan entries logged with one tap) and number of skipped meals.
Sources: `get_nutrition_summary` for the week + local SQLite plan links and skips. Today counts only once it is over.
The kcal chart scales above the goal (e.g. to 2,600) so days over target stay inside the card; the dashed goal line sits at 2,200.


## Apple Health (Health Auto Export)

Full requirements: [`docs/apple-health.md`](../apple-health.md). Summary:

- **No new section.** Health data lives in Today, Timeline and Week. Management is under the avatar → Profile → "Apple Salute".
- **Today — "ATTIVITÀ E RIPOSO" card** (after water, before the insight; desktop: right column):
  - Steps: during the day show "N passi finora · km" and the 7-day average as context only. The % comparison appears
    only for finished days (never compare a partial day with full-day averages).
  - Sleep of the night: total, bed → wake times, stacked phase bar (deep / REM / core / awake) with text labels and minutes.
    The value is time awake, labelled "sveglio N min" (not number of wake-ups).
  - Resting HR with the difference from last week's average.
  - States: no data ("Nessun dato da Salute per questo giorno"), stale ("Ultimo aggiornamento 2 giorni fa"), sleep missing (hide only that row).
  - "Bilancio" row is designed but off: it needs **both** active and resting energy to be continuous (resting energy exists for 2 days only). No BMR formulas.
- **Timeline**: sleep is a compact chip at wake-up time, expandable to the phase bar. Workouts are cards with a type icon,
  time range, duration, kcal only if present, distance, "FC media", source pill; expanded: stats grid, Hevy exercises,
  a "Fonti" line. Meals, workouts and sleep differ by shape and icon, not only colour.
- **Week**: workout marks (icons + legend) under the kcal chart; Workouts card (totals + one row per session, kcal "su N sessioni con dato");
  Steps (goal line, average of finished days, best day); Sleep (hours per night, shortest night labelled, mean bedtime computed across midnight, mean wake time);
  small Resting HR card.
- **Sources and names**: labels come from a mapping table. "Google Health" → **Fitbit**; also **MERACH**, **Hevy**, **Bevel**.
  Workout names: "Allenamento di Forza Tradizionale" → Forza, "Interno Ciclismo" → Cyclette, "Raquetball" → Racchetta; unknown → original name.
- **Duplicates**: same workout if overlap ≥ 50% of the shorter session and same family (Forza; Ciclismo + Cyclette; Calcio; Camminata; Racchetta).
  One session may overlap several (merge all). HR/kcal priority: Fitbit → MERACH → Bevel; time range = union. Hevy always wins on title,
  exercises and duration and takes only HR/kcal from Health. Hevy-sourced workouts arriving through Health are dropped when Hevy is read directly.
- **Storage**: SQLite (the only exception to "read live"). Never store GPS routes, all-day per-minute HR, medications, mood, nutrition, weight.
  The only heart-rate series kept is the one recorded during each workout (one point per minute, for the expanded workout chart).
  Day = local date in the Nutrition profile timezone; sleep belongs to the wake-up day; energy always in kcal (from kJ);
  the current day is overwritten on each sync, never summed. Re-importing the same period updates without duplicating.
- **Ingest endpoint** (phase 2): token-protected, outside Google login (needs a Cloudflare Access bypass for that path only, if Access is used).
- **Insights**: show one only if each compared group has ≥ 5 days and the difference is meaningful (e.g. ≥ 10%).
- **Mockup data**: all numbers come from the real export (8 Sep – 13 Nov 2026) and Nutrition, except the "Bilancio" preview and the re-import example.


## Charts

All chart data in the mockups is real. Colours are validated (protein `#0A8FA6`, carbs `#C98A1B`, fat `#8A5A9E` pass lightness,
chroma, CVD and normal-vision checks; carbs is below 3:1 on white, so it always comes with a text label).
Every chart has a text label or legend (never colour alone), an `aria-label`, and per-point tooltips (`<title>` in the mockups;
use a real hover/tap tooltip in the app).

| Where | Chart |
|---|---|
| Today · Calories | Cumulative kcal through the day (stepped line + area) vs the plan (dashed), "now" marker, label "a quest'ora: X su Y previste" |
| Today · Activity & rest | 7-day steps sparkline (today hollow = partial), 7-night sleep mini bars (shortest in amber), 8-day resting-HR sparkline |
| Timeline · workout expanded | Heart-rate curve during the session with dashed average line and max point |
| Week | Kcal share stacked bar (P/C/F), protein bars vs 135 g goal line, sleep as floating bars bedtime → wake (shortest in amber), 5-week resting-HR line |
| Apple Salute | Data coverage heatmap per metric and day (present / present but irregular / missing) |

## Add sheet (`+`) — what is really possible

All of these map to existing Nutrition MCP tools:

| Option | MCP tools |
|---|---|
| Water +250 / +500 ml | `log_water` |
| Today's plan meals not yet logged | `log_meal` with the plan's full nutrients, then link plan entry ↔ meal in SQLite |
| Repeat a recent meal | `get_meals_by_date_range` → `log_meal` with the same items |
| Saved meals | `get_saved_meals` → `log_saved_meal` |
| Search food + quantity | `search_foods`, `get_food_macros` → `log_meal` |
| Barcode scan | camera scan in the browser (JS library such as ZXing; Safari has no `BarcodeDetector`) → `lookup_barcode` → `log_meal` |

Not in the app: photo recognition and free-text descriptions ("I had a margherita pizza").
They need an LLM; the user keeps doing those through Claude, which writes to the same Nutrition account.
Suggested order: water + plan meals + repeat recent in v1; saved meals, search and barcode in phase 2.

## Design tokens

| Token | Value |
|---|---|
| Background | `#F4F5F1` |
| Surface | `#FFFFFF` |
| Text | `#17201B` |
| Text muted | `#56605A` |
| Border | `#DDE1DA` / `#E2E5DF` |
| Accent (brand, ring, active tab, rod, next-meal border) | `#2F6B47` |
| Accent soft | `#E3F0E6` |
| Protein | `#0A8FA6` (chip bg `#E3EEF0`) |
| Carbs | `#C98A1B` (chip bg `#F6ECD8`) |
| Fat | `#8A5A9E` (chip bg `#EFE6F2`) |
| Fiber | `#6B756E` |
| Water | `#2A6FB0` (button bg `#E4EEF7`) |
| To-log card | bg `#FFF7F0`, border `#EDC3A3`, label `#8F4310` |
| Skipped card / banner | bg `#ECEEEA`, text `#56605A` |
| Now marker / destructive | `#C2492E` / `#A53A22` |

- Font: **Manrope** (Google Fonts), weights 400–800; numbers use tabular figures.
- Radii: cards 24 px, small cards 18–20 px, buttons 14–16 px, pills 999 px.
- Touch targets ≥ 44 px. Respect iOS safe-area insets.
- Logo: stylized plate — two concentric circles plus a short arc, in the accent color
  (see the inline SVG in `Main.dc.html` and `Login.dc.html`).

## Dark mode

Reference screens: `OggiDark.dc.html` and `PianoDark.dc.html`.

- Follow the system setting (`prefers-color-scheme`) by default, with a manual override
  (System / Light / Dark) saved per device. Set `color-scheme` and the iOS `theme-color` meta for both themes.
- Implement every color as a CSS custom property with light and dark values; components never use raw hex.
- Primary buttons and the `+` tab are **inverted** in dark mode (light surface, dark text).
- Text placed on accent, now-marker or inverted backgrounds uses `#0F1A13`.

| Role | Light | Dark |
|---|---|---|
| Background | `#F4F5F1` | `#121412` |
| Surface (cards, tab bar) | `#FFFFFF` | `#1C1F1C` |
| Text / inverted surface | `#17201B` | `#EEF1EC` |
| Text secondary | `#3C453F` | `#C9D0CA` |
| Text muted | `#56605A` | `#A3ABA4` |
| Border | `#DDE1DA` | `#343832` |
| Divider / tab bar border | `#ECEEEA` / `#E2E5DF` | `#2B2E2A` |
| Dashed border, rod after now | `#C3C9C0` / `#B9C0B6` | `#4A5049` |
| Track (ring, bars) | `#E8EBE5` | `#2B2F2B` |
| Segmented control bg | `#E6E9E3` | `#262926` |
| Input bg | `#F7F8F5` | `#191B19` |
| Accent | `#2F6B47` | `#5FB083` |
| Accent soft | `#E3F0E6` | `#1F3628` |
| Protein / chip bg / chip text | `#0A8FA6` / `#E3EEF0` / `#1B5A62` | `#4FB3BF` / `#1B3236` / `#8FD0D6` |
| Carbs / chip bg / chip text | `#C98A1B` / `#F6ECD8` / `#7A5410` | `#E0A63E` / `#3A2E17` / `#E7C17A` |
| Fat / chip bg / chip text | `#8A5A9E` / `#EFE6F2` / `#66407A` | `#B98BD0` / `#33263A` / `#D4B1E4` |
| Fiber | `#6B756E` | `#9AA39C` |
| Water / button bg / button text | `#2A6FB0` / `#E4EEF7` / `#1F5A90` | `#6FA8DC` / `#1C2B3A` / `#9CC6EE` |
| Water segments | `#DCE6EF` | `#22303D` |
| To-log card bg / border / label | `#FFF7F0` / `#EDC3A3` / `#8F4310` | `#2A1F17` / `#6E4428` / `#F0A872` |
| Now marker / destructive text | `#C2492E` / `#A53A22` | `#E0714F` / `#F08F6E` |
