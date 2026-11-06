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
| `Main.dc.html` | Today (summary) | Week strip, **Next meal** card, calorie ring, macro bars, water, **daily insight** |
| `Timeline.dc.html` | Timeline | The day's meals on a continuous vertical rod; day arrows; skip / undo |
| `Aggiungi.dc.html` | Add sheet (opened by `+`) | Water shortcuts, today's plan meals, repeat / saved / search / barcode |
| `Pasto.dc.html` | Meal detail | kcal, macro split bar, items with quantities, fiber/sugar/caffeine |
| `Modifica.dc.html` | Edit meal | Meal type, time, items (edit/remove/add), values; delete with confirmation sheet |
| `Settimana.dc.html` | Week | Daily kcal bars vs 2,200 target line, weekly averages, **Consistency** card, weight card |
| `Piano.dc.html` | Meal plan | Day tabs (today preselected), meals of the selected day, "Libero" cards; `⋯` menu for upload + history |
| `Desktop.dc.html` | Desktop / iPad — Today | Fluid layout: sticky sidebar; left column = calories, macros, water; right column = Next meal, insight. Timeline stays its own section, never inside Today |
| `OggiDark.dc.html`, `PianoDark.dc.html` | Dark mode references | See "Dark mode" |

## Navigation

- Mobile: bottom tab bar **always fixed on screen** (content scrolls above it), 5 slots:
  `Oggi · Settimana · [+] · Piano · Timeline`. The `+` is the round dark button in the middle slot and opens the add sheet.
  There is no floating button.
- Meal detail, edit and the add sheet are pushed/modal screens, without the tab bar.
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

## Add sheet (`+`) — what is really possible

All of these map to existing Nutrition MCP tools:

| Option | MCP tools |
|---|---|
| Water +200 / +250 ml | `log_water` |
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
| Protein | `#1F6F78` (chip bg `#E3EEF0`) |
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
| Switch knob (Promemoria toggles; on = Accent, off = Track) | `#FFFFFF` | `#F1F3EF` |
| Segmented control bg | `#E6E9E3` | `#262926` |
| Input bg | `#F7F8F5` | `#191B19` |
| Accent | `#2F6B47` | `#5FB083` |
| Accent soft | `#E3F0E6` | `#1F3628` |
| Protein / chip bg / chip text | `#1F6F78` / `#E3EEF0` / `#1B5A62` | `#4FB3BF` / `#1B3236` / `#8FD0D6` |
| Carbs / chip bg / chip text | `#C98A1B` / `#F6ECD8` / `#7A5410` | `#E0A63E` / `#3A2E17` / `#E7C17A` |
| Fat / chip bg / chip text | `#8A5A9E` / `#EFE6F2` / `#66407A` | `#B98BD0` / `#33263A` / `#D4B1E4` |
| Fiber | `#6B756E` | `#9AA39C` |
| Water / button bg / button text | `#2A6FB0` / `#E4EEF7` / `#1F5A90` | `#6FA8DC` / `#1C2B3A` / `#9CC6EE` |
| Water segments | `#DCE6EF` | `#22303D` |
| To-log card bg / border / label | `#FFF7F0` / `#EDC3A3` / `#8F4310` | `#2A1F17` / `#6E4428` / `#F0A872` |
| Now marker / destructive text | `#C2492E` / `#A53A22` | `#E0714F` / `#F08F6E` |
