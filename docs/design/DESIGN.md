# Intake — UI design handoff

The `screens/` folder holds the approved mockups as `.dc.html` files (one per screen).
They are **reference markup**, not production code: read them for layout, spacing,
colors, copy and behavior, then rebuild them as React components in `apps/web`.
They load a `support.js` runtime that is not included, so they will not render as-is.
All UI copy is designed in Italian (the default language; English and Dutch translations live next to it in `apps/web/src/lib/i18n/`); code, comments and docs stay in English.

## Screens

| File | Screen | Notes |
|---|---|---|
| `Login.dc.html` | Sign in with Google | Owner-only access note under the button |
| `Collega.dc.html` | Connect Nutrition (one-time) | Google ✓ and Nutrition "to connect", 3-step explainer |
| `Main.dc.html` | Today (summary) | Week strip, **Next meal** card, calorie ring, macro bars, water, **Activity & rest**, **daily insight**. Tweaks: Health state, balance preview |
| `Timeline.dc.html` | Timeline (today) | Sleep chip, meals, planned meals on a continuous rod; day arrows; skip / undo |
| `TimelineMar10.dc.html` | Timeline (past day) | Example with a Health workout (MERACH indoor cycling) expanded and a short night |
| `TimelineMer11.dc.html` | Timeline (past day) | Example with a Hevy workout enriched with heart rate from Health, expanded |
| `AndamentoSalute.dc.html` | Andamento › Salute (iPhone) | Tabs Sonno / Attività / Cuore, period 7 / 30 / 90 days, real data, interactive in Play |
| `SaluteDesktop.dc.html` | Salute (desktop / iPad) | Same data and period selector; the three tabs side by side as columns |
| `AndamentoAllenamenti.dc.html` | Andamento › Allenamenti (iPhone) | Next routine (Hevy rotation A → B → C) with targets and progression hints, this week strip, load progress charts, recent workouts |
| `AllenamentiDesktop.dc.html` | Allenamenti (desktop / iPad) | Same content in a gap-free two-column flow (CSS `columns: 2 380px`, cards `break-inside: avoid`): next routine, week, history, one card per lift; one column on iPad portrait |
| `Profilo.dc.html` | Profile | Weight (log + chart from the 2nd weigh-in), daily goals (read-only, from Nutrition) and step goal, connections, theme, sign out. Superseded for order and layout by "Impostazioni (20 Nov)" below |
| `Salute.dc.html` | Profile › Apple Salute | Data status, active-energy warning, file import, auto-sync (phase 2). The step goal moved to Profilo |
| `SaluteImport.dc.html` | Import preview | Preview, duplicates resolved, ignored data, result; states via the `stato` tweak |
| `Aggiungi.dc.html` | Add sheet (opened by `+`) | Water shortcuts, today's plan meals, repeat / saved / search / barcode |
| `Pasto.dc.html` | Meal detail | kcal, macro split bar, items with quantities, fiber/sugar/caffeine |
| `Modifica.dc.html` | Edit meal | Header: back arrow on the left (as on the meal detail; leaves without saving) and the centred title; Elimina pasto (secondary, red) and Salva (primary) side by side at the bottom with the same sizes as Modifica / Salva come preferito on the meal detail, at the end of the page after the meal values. Meal type, time, items (edit/remove/add; with Pasti da foto on, "+ Aggiungi alimento" opens "Cosa hai aggiunto?" with "Aggiungi con IA" and "Inserisci a mano"), values; delete with confirmation sheet |
| `Settimana.dc.html` | Andamento › Alimentazione | Nutrition only: kcal bars with workout marks, averages, kcal share (P/C/F), protein per day vs goal, Consistency |
| `Piano.dc.html` | Meal plan | Day tabs (today preselected), meals of the selected day, "Libero" cards; `⋯` menu for upload + history |
| `Desktop.dc.html` | Desktop / iPad — Today | Fluid layout: sticky sidebar; left column = calories, macros, water; right column = Next meal, insight. Timeline stays its own section, never inside Today |
| `SettimanaDesktop.dc.html` | Desktop / iPad — Alimentazione | Nutrition only: KPI row (kcal, protein, fiber, water, added sugar, days logged); card grid `repeat(auto-fit, minmax(360px, 1fr))` with Calories (full width ≥ 1100 px, workout icons and kcal share), Protein, Consistency. One column on iPad portrait. "Personalizza" is phase 2 |
| `OggiDark.dc.html`, `PianoDark.dc.html` | Dark mode references | See "Dark mode" |


## Navigation update (13 Nov)

- iPhone tab bar: **Oggi · Andamento · [+] · Piano · Timeline**. "Andamento" opens with a segmented control **Alimentazione | Salute | Allenamenti**
  (Alimentazione = former Week, nutrition only; Salute = sleep, activity, heart; Allenamenti = Hevy routines and loads).
- Desktop / iPad sidebar: **Oggi · Alimentazione · Salute · Allenamenti · Piano · Timeline**.
- The avatar opens **Profilo**, titled Impostazioni (see "Impostazioni (20 Nov)").
  Weight is no longer on the Week page.
- Supersedes older mentions of "Settimana" as a tab, the weight card in Week, and the step goal in the Apple Salute screen.

## Optional parts and first-run setup (19 Nov)

- Alimentazione is always on; Acqua, Allenamenti, Apple Salute and Promemoria can be switched off (docs/features.md); with Acqua off the water card, the water shortcuts of the add sheet, the water rows of Andamento and the water goal are left out. Navigation, Today and Profile show only the parts that are on; the Andamento switch is hidden when only Alimentazione is left.
- First-run setup: a focus page like the Nutrition connection (eyebrow "PRIMA CONFIGURAZIONE · PASSO N DI 2"). Step 1: three radio cards (title + one line), the selected one with the accent border and soft accent background, "Avanti" at the bottom. Step 2: a card with one row per chosen part and the reminders switch, "Indietro" / "Inizia", footnote pointing to Profilo › Funzioni.
- Profilo › Funzioni: third card of Impostazioni (see below); Alimentazione with a "sempre attiva" pill, then one switch row per part, and a last row with the muted note and a small secondary "Rifai la configurazione" button.

## Day navigation (20 Nov)

- **Oggi**: the week strip has a ‹ arrow on its left and a › arrow on its right (muted, no border) to move a week back or forward, keeping the weekday; › is disabled in the current week. Under the title, "Timeline del giorno →" (accent, small, bold) opens the Timeline of the day shown, so a day opened from Andamento › Alimentazione leads to its meals in one tap.
- **Timeline**: on the right of the header, "Oggi" (outlined pill, only when another day is shown), ‹, a date pill with a calendar icon and the short date, ›. The date pill opens the system date picker (wheel or calendar on iPhone); future days are not offered. On phones the controls wrap under the title.
- **Andamento › Salute**: each day of the sleep and steps charts and each resting heart rate point opens that day in the Timeline; the charts look unchanged.

## Impostazioni (20 Nov)

The avatar screen (route `/profilo`) is titled **Impostazioni**, with the avatar and "name · accesso con Google" under the title. It replaces the two-column Profilo layout (mockup "Impostazioni · desktop / iPad").

- One column of cards in a fixed order: **Peso · Obiettivi · Funzioni · Personalizza home · Allenamenti · Collegamenti · Backup · Promemoria · Aspetto e lingua · Account**. A card whose part is off (or that has nothing to show) is left out, and so is its link.
- From 1100 px a column of section links sits on the left of the cards and stays in view while scrolling; a link scrolls to its card. Below 1100 px there are no links. From 800 px (sidebar visible) the back button is hidden.
- Peso: Ultimo / Tendenza / Obiettivo and the log field with "Registra" on one line (the field wraps below on phones); the chart from the second weigh-in; a soft strip with the status ("5 nov · 75,0 kg — alla prossima pesata compaiono linea e tendenza.") on the left and "Stesso giorno, al mattino, a digiuno · salvato su Nutrition" on the right.
- Obiettivi giornalieri: "da Nutrition" pill (hidden below 520 px) and a "Modifica" text button; rows in two columns from 700 px (Calorie, Proteine, Carboidrati, Grassi | Fibre, Acqua, Passi with − / +), then the note "Calorie, macro, acqua e peso obiettivo si cambiano con Modifica o su Nutrition, anche parlando con Claude: sono gli stessi. I passi sono un obiettivo di Intake." Modifica turns each value into a field with its unit on the right (Acqua in litres) and adds Peso obiettivo in the unit of the Nutrition profile (kg or lb); the fields stay in one column below 1000 px. Under them a note on clearing a goal, then Annulla / Salva (full width on phones, on the right from 700 px). Saving sends only the changed values and shows "Obiettivi salvati."; calories and grams take no decimals ("2.200" is 2200 kcal), and a value out of range (calories 500–10,000) shows an error and saves nothing.
- Personalizza home: one row per card of Oggi (Prossimo pasto, Sforzo/recupero/sonno, Calorie, Macronutrienti, Acqua, Allenamento di oggi, Piano e realtà, Attività e riposo, Dai tuoi dati; cards of parts that are off are not listed), each with ▲ / ▼ (36 px, surface-2, the first ▲ and last ▼ faded) on the left, the name (muted when hidden; "solo con un piano attivo" under Piano e realtà) and a switch to show it on the right; a last row with the muted note and "Ripristina l'ordine iniziale" only when the layout differs from the default. On Oggi the order applies to the single list on phones; from 1000 px each card stays in its column (calories, macros, water left; the others right) and the order applies within it. The UTC notice is not listed and stays first.
- Allenamenti: "Fonte delle schede" with the Hevy | openGym segmented control (only when both are configured) and "Copia le sedute su Hevy" with "Copia ora" and the switch on the same row.
- Collegamenti: Account Google, Nutrition (red "Scollega" text button next to the state pill), Fuso orario (the Nutrition zone on the right, with "Usa Europe/Rome" in accent under it when the device's zone differs; a tap opens, under the row, the confirmation below), Apple Salute (opens Profilo › Apple Salute), Hevy, openGym.
- Oggi, only while Nutrition is on UTC and the device is not: a notice card first in the main column, "Il tuo account Nutrition è sul fuso UTC, non su Europe/Rome: …", with "Non ora" (text button) and "Usa Europe/Rome" (small primary) on the right. "Usa …" first asks, in place: "Cambio il fuso di Nutrition in Europe/Rome? I pasti già registrati restano alla loro ora, ma quelli vicini alla mezzanotte potrebbero passare al giorno prima o dopo." with Annulla / Conferma.
- Backup di Nutrition: a muted note (every night at midnight, full copy in Nutrition's original format), the newest three backups as rows ("21 novembre · 00:00", size, a small secondary "Scarica" on the right), older ones behind "Mostra altri N backup", a "Copie da tenere" row with − / +, and a small secondary "Fai un backup ora". A failed last attempt shows an error notice with the reason in words.
- Promemoria: one row that opens the reminders sheet. Aspetto e lingua: Tema and Lingua rows, label and note on the left, segmented control on the right (below on phones). Account: the email with a small red "Esci" button.

## Navigation

- Mobile: bottom tab bar **always fixed on screen** (content scrolls above it), 5 slots:
  `Oggi · Andamento · [+] · Piano · Timeline`. The `+` is the round dark button in the middle slot and opens the add sheet.
  There is no floating button.
- Meal detail, edit and the add sheet are pushed/modal screens, without the tab bar.
- The avatar in Today opens **Profilo**, where "Apple Salute" lives.
- Desktop/iPad (≥ 800 px): left sidebar with `Oggi · Alimentazione · Salute · Allenamenti · Piano · Timeline` plus a "+ Aggiungi" button, sticky while the page scrolls.
- Weight has no dedicated section: it is a card in **Profilo** (one weigh-in per week).
- Shopping list is **not** in the app: the user keeps it in Apple Reminders ("Spesa"). A later iOS Shortcut may pull the list from the active plan.
- Training: see "Allenamenti (Hevy)".

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
- Skips are counted in the Alimentazione consistency card.

## Alimentazione — Consistency card

Rows (label, short note, value), as in the `Settimana` mockup:
- Days logged (days of the week so far with meals / days so far), note "tutti i giorni da lunedì" or the missing days.
- Protein at target (days ≥ goal / completed logged days), note with the best day.
- Fiber at target (same rule, over the completed days that recorded fiber; hidden without a fiber goal).
- Water at target (same rule).
- Meals as planned (count of plan entries logged with one tap) and number of skipped meals.
The KPI row has no "added sugar" tile: `get_nutrition_summary` does not return added sugar per day.
Sources: `get_nutrition_summary` for the week + local SQLite plan links and skips. Today counts only once it is over.
The kcal chart scales above the goal (e.g. to 2,600) so days over target stay inside the card; the dashed goal line sits at 2,200.


## Apple Health (Health Auto Export)

Full requirements: [`docs/apple-health.md`](../apple-health.md). Summary:

- Health data lives in Today, Timeline and **Andamento › Salute**. Management is under the avatar → Profilo → "Apple Salute".
- **Today — "ATTIVITÀ E RIPOSO" card** (after water, before the insight; desktop: right column):
  - Steps: during the day show "N passi finora · km" and the 7-day average as context only. The % comparison appears
    only for finished days (never compare a partial day with full-day averages).
  - Sleep of the night: total, bed → wake times, stacked phase bar (deep / REM / core / awake) with text labels and minutes.
    The value is time awake, labelled "sveglio N min" (not number of wake-ups).
  - Resting HR with the difference from last week's average.
  - States: no data ("Nessun dato da Salute per questo giorno"), stale ("Ultimo aggiornamento 2 giorni fa"), sleep missing (hide only that row).
  - "Bilancio" row: on for every day with **both** active and resting energy (eaten vs burned, deficit/surplus as text; today "finora" with an end-of-day estimate). No BMR formulas. Rules in docs/apple-health.md § Balance.
- **Timeline**: sleep is a compact chip at wake-up time, expandable to the phase bar. Workouts are cards with a type icon,
  time range, duration, kcal only if present, distance, "FC media", source pill; expanded: stats grid, Hevy exercises,
  a "Fonti" line. Meals, workouts and sleep differ by shape and icon, not only colour.
- **Andamento › Alimentazione**: workout marks (icons + legend) under the kcal chart; no other Health cards.
- **Andamento › Salute** (`AndamentoSalute`, `SaluteDesktop`): tabs Sonno / Attività / Cuore (columns on desktop), period 7 / 30 / 90 days.
  Sonno: average sleep, mean bedtime and wake time computed across midnight, floating bars bedtime → wake (shortest night labelled), average phases, facts.
  Attività: average steps (finished days only), days at or above the step goal, daily bars with goal line (today light), workouts by type, latest workouts with source.
  Cuore: average and minimum resting HR, difference from the previous period of the same length, line over time with the average, average workout HR by type.
- Today's "Attività e riposo" card links to Andamento › Salute ("Vedi andamento →").
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
| Andamento › Alimentazione | Kcal bars with workout icons, kcal share stacked bar (P/C/F), protein bars vs 135 g goal line |
| Andamento › Salute | Sleep as floating bars bedtime → wake (shortest in amber), steps bars with goal line, resting-HR line with average |
| Apple Salute | Data coverage heatmap per metric and day (present / present but irregular / missing) |


## Customise layout (Alimentazione, desktop / iPad) — phase 2

The first release builds the grid only; editing comes later.

- Header button "Personalizza" enters edit mode; "Fine" leaves it, "Ripristina" restores the default.
- Each card shows a bar with a drag handle, ↑ / ↓ (keyboard and touch alternative to drag), "Intera / Metà" (full or half width) and "Nascondi / Mostra".
  Hidden cards stay visible but faded in edit mode, and disappear outside it.
- Default order: Calorie (full width), Proteine, Costanza.
- Grid: `repeat(auto-fit, minmax(360px, 1fr))`, `grid-auto-flow: row dense`, one gap value for KPI row, grid and page sections
  (default 16 px; the mockup tweak also shows 12 and 24 px), cards in a row share the same height.
- Layout is saved per device (local storage), not on Nutrition. Same pattern can be reused later for Today and the mobile Week.

## Today — Strain / Recovery / Sleep rings (Bevel-style)

- First card in Today (after the week strip, before Next meal); on desktop the first card of the left column.
- Three rings, each with value, unit, label and a text state pill (never colour alone):
  - **Sforzo** 0–100% "carico" (`#D9682A`, track `#F6E3D6`): Leggero < 34 · Moderato 34–66 · Intenso ≥ 67. All three rings use percentages only.
  - **Recupero** 0–100% (`#2E9A5E`, track `#DDEFE3`): Basso < 34 · Medio 34–66 · Alto ≥ 67.
  - **Sonno** 0–100% of need (`#7461D8`, track `#E7E3F8`): Basso < 70 · Medio 70–84 · Alto ≥ 85.
- Tapping a ring opens an inline panel "come si calcola" with the inputs used (and "non disponibile" for missing ones, e.g. HRV).
- **Values in the mockup are placeholders** (tweaks "Anelli"); the scoring rules are in [`docs/apple-health.md`](../apple-health.md) § Daily scores. Dark-mode tracks: `#3A281C`, `#1E3326`, `#2A2547`.
- Needs an "insufficient data" state per ring.

## Allenamenti (Hevy) — added 13 Nov

- iPhone: third option in the Andamento segmented control: **Alimentazione | Salute | Allenamenti**. Desktop / iPad sidebar gains **Allenamenti**.
- **Next routine**: computed from the rotation A → B → C (next after the last Hevy workout). Shows routine title, exercise count,
  typical duration, each exercise with the target from the Hevy routine (weights × rep range), and hints:
  "prova +2,5 kg" when the last session closed the top of the rep range (e.g. bench 53,5 kg × 8-9-10), "superserie" tags. Button "Apri in Hevy".
  Reminder line from the meal plan: on full-body days add bread, pasta or potatoes at dinner.
- **This week**: 7-day strip with the routine letter on training days, "3 su 3", time in the gym, exercise count, other activity (Health).
- **Load progress**: one small line chart per key lift (best working set per session, warm-ups excluded), label of the last set,
  delta pill ("▲ +15 kg da settembre") or "pronta a salire". Cables 2:1 are logged at half stack, as in Hevy.
- **Recent workouts**: last 4 Hevy sessions with time, duration, exercise count and HR from Health when available.
- Data: Hevy API (routines and about four months of workouts; exercise titles matched by template id, since routines
  return English template names and workouts the app's language). Read live, no local storage.
- In the app: "Apri in Hevy" and the meal-plan reminder line are not shown yet (no stable Hevy deep link; the plan has
  no structured "full-body day" flag).

## AI features

Everything that asks the AI inside Intake (the "Foto del piatto" and "Descrivi a parole" tiles, Analizza, the
"+ Aggiungi alimento" of the new and edited meal, "Aggiungi i cibi con l'IA" for a photo added in Modifica pasto, the Pasti da foto switch and the AI model in Impostazioni, "Il
parere dell'IA" of Il tuo fabbisogno) carries
the sparkles icon (`SparklesIcon`) and is called "IA" in Italian and "AI" in English and Dutch, never "Claude". Texts
that speak of Claude as the chat outside Intake (logging by talking to Claude, the plan made in a Claude project, the
"Chiedi a Claude" row that opens the Claude app) keep the name; that row gets the sparkles too.

## Piano — Il tuo fabbisogno (20 Nov)

Piano opens with a small segmented switch under the title, "Piano pasti" / "Fabbisogno" (at most 300 px wide). The
meal plan is first; Impostazioni › Aspetto › "Piano apre su" can make Fabbisogno first on that device. The plan's
subtitle and ⋯ menu belong to the meal plan and hide on Fabbisogno.

The Fabbisogno view is one card with three bands divided by a line:

1. The active goal: pills with the goal and its source ("calcolo standard", "proposta IA", "dai tuoi dati"), the
   calories large, the macros on one line, then weight · workouts a week · estimated maintenance. "Modifica" in the
   card header opens the page.
2. "VERIFICA SUI TUOI DATI": one sentence with the average calories, the weight trend and the real maintenance, then
   "✓ in linea con l'obiettivo" (accent pill) or "Per il tuo obiettivo: X kcal" with "Applica"; a muted note that it
   is plain arithmetic, no AI. With too few data, one muted sentence with what is missing.
3. "IL PARERE DELL'IA" with the sparkles, separate from the settings: the last opinion (date, summary, a
   three-column table Calcolo / Proposta IA with the differing AI values in bold, tips, "Tieni il calcolo" /
   "Usa la proposta" or "✓ Proposta dell'IA in uso"), then "Chiedi" (asks again from the card, with a spinner
   while it waits).

Without saved fields: the title, one sentence, "Calcola il tuo fabbisogno" and band 2 without the suggestion.

The page (`/piano/fabbisogno`) follows the new-meal layout (Annulla · title): sections Tu (sex as a segmented
control, age, height, the weight from Nutrition read-only), Vita di tutti i giorni (work segmented, steps),
Allenamenti (times a week, average length, type segmented), Obiettivo (2 × 2 cards with name and one-line hint, the
selected one with an accent border and soft accent fill; Ritmo segmented for cut and bulk), Note per l'IA (with the
sparkles, only while the AI can be used), then the calculation card (calories, macros, basal and maintenance, weekly
change, "Salva" / "Applica agli obiettivi"). The AI is asked from the card only. Rules in `docs/needs.md`.

## Add sheet (`+`) — what is really possible

All of these map to existing Nutrition MCP tools:

| Option | MCP tools |
|---|---|
| Water +250 / +500 ml | `log_water` |
| Today's plan meals not yet logged | `log_meal` with the plan's full nutrients, then link plan entry ↔ meal in SQLite |
| Repeat a recent meal | `get_meals_by_date_range` → `log_meal` with the same items |
| Saved meals (row "Pasti preferiti · N salvati" in ALTRO CIBO, before "Ripeti un pasto recente"; both rows open in place with a ▾ / ▴; inside, the first 5 favorites and "Mostra altri N"; each: name · kcal, description, "Apri"; a tap closes the sheet and opens the confirmation screen of a new meal with the favorite's foods (eyebrow "PREFERITO", kcal without "stimate", "ALIMENTI" instead of "ALIMENTI RICONOSCIUTI", amounts in their unit, Annulla instead of Rifai, no "Salva anche come preferito", "+ Aggiungi alimento" only with Pasti da foto on), logged with "Registra pasto"; a small × on the right asks in the row "Eliminare “…” dai preferiti?" with Annulla / Elimina (danger) and deletes it from Nutrition; the type is the saved meal's default, else the time of day on the profile clock; with none, a row in ALTRO CIBO explains how to save one) | `get_saved_meals` (with the items) → `log_meal`, `delete_saved_meal` |
| Search food + quantity | `search_foods`, `get_food_macros` → `log_meal` |
| Barcode scan | camera scan in the browser (JS library such as ZXing; Safari has no `BarcodeDetector`) → `lookup_barcode` → `log_meal` |

Photo recognition and free-text descriptions ("I had a margherita pizza") are in the app while the optional part
Pasti da foto is on and `ANTHROPIC_API_KEY` is set: two tiles at the top of the add sheet ("Foto del piatto",
"Descrivi a parole") open `/pasto/nuovo`. Picked photos (up to 6, e.g. one per course) are shown first in a carousel
with a × on each, an "Aggiungi foto" tile and an optional note, and are sent together only with "Analizza". The confirmation screen is built like `Modifica.dc.html` (meal type, time, foods with
− / + grams, "Stimato · non visibile" pill on hidden fats in the to-log colors, "+ Aggiungi alimento", values, a
"Salva anche come preferito" switch with a name) and logs the meal with `log_meal`; its first photo shows with a small
count badge when there are more. The photos are kept: a carousel on top of the meal detail (one photo per slide, swipe
or ‹ › with "2 / 3" under it) and in Modifica pasto (same carousel with × and an "Aggiungi foto" tile; a new photo shows
a card "Nuova foto" with a note and "Aggiungi i cibi con l'IA" / "Solo la foto"), and the first photo with a count
badge on the Timeline card. With the part off, the "Chiedi a Claude" row stays.
Suggested order: water + plan meals + repeat recent in v1, then saved meals; search and barcode in phase 2.

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

## Piano — generate with AI and the day view (21 Nov)

Piano › ⋯ › "Genera con l'IA" opens a pushed screen: targets, meals of the day, free meals, variety, food, cooking, notes, then "Genera piano" (with sparkles). The review starts with a summary card ("Alcune cose non tornano": days off target in one line, repeated dishes), each line opening its day; affected meals have a ⚠ line with the reason, a "Sostituisci" pill (optional wish, then a spinner on that meal) and a time chip that opens the system picker. The day totals card shows each macro against the goal with a bar and a text label ("in linea", "▲ 250 sopra", "▼ 24 sotto"); "Stesso orario tutti i giorni" is on by default.

The same day view (`components/PlanDay.tsx`) is the Piano page: header, switch, day tabs and meals share one centred column (max 1040 px); at ≥ 1000 px a 320 px aside holds the totals, the time switch and the notes.

## Piano — shopping list and print page (21 Nov)

⋯ menu entries "Lista della spesa" and "Stampa o salva PDF" (disabled without a plan). The list is a pushed screen (no tab bar): intro, "Copia lista" (turns into "Copiata ✓") next to "Stampa o salva PDF", then one card per supermarket section with each line and "in N pasti". The print page is a paper-like sheet on screen: title, validity and averages, the seven days in a responsive grid, then the shopping list on its own page in two columns with a box before each item. When printing, the app chrome is hidden and the colors are forced light.

The print page's main button is "Salva PDF" (a compact A4 made by the app, share sheet on phones, download on desktop; disabled with "Preparo il PDF…" until ready); "Stampa" sits next to it on desktop browsers only.

Piano (active plan and AI review): every meal has a "Sposta" pill next to "Sostituisci". It opens a list titled "Scambia con lo stesso pasto di…" with one row per other day and the dish that day would send back ("Giovedì · Pasta al ragù…"); tapping a row swaps the two dishes at once, the times stay. A free meal ("libero") can be moved the same way.

Every meal also has a "Modifica" pill (before "Sposta"; "Sostituisci" stays AI-only in the review). It opens an editor under the meal: the dish text, one row per food (name, amount, unit, ×) with "+ Aggiungi alimento", and the nutrients of the meal (Calorie, Proteine, Carboidrati, Grassi, Fibre; five columns from 560 px), with the note that they are not recalculated. "Salva" applies it at once; a missing food name or a non-numeric value shows an error line.

The dish editor ends with two tools: "Cerca nel database" (free: a panel with one row per food, its grams, a "Cerca" button that opens an English search with the USDA results and their values per 100 g, then "Usa i valori (N alimenti su M)") and "Ricalcola con l'IA" with the sparkles (paid). Both only fill the nutrient fields; "Salva" is still the person's. On the plan, "Alternativa" (sparkles) opens a wish field, then a green card with the proposed dish next to "Ora: 655 kcal · P 32 g" and "Annulla / Un'altra / Usa questo".

When a plan is scheduled (not in effect yet), Piano shows a notice "Un piano è programmato: parte il …" with "Applica da oggi".

Piano ⋯ menu: 280 px wide (never wider than the screen minus 16 px per side), 8 px inside padding and 2 px between rows; rich rows have 10 px of vertical padding so a title and a two-line hint never touch the next row. Entries: Genera con l'IA, Lista della spesa, Stampa o salva PDF, Scarica il piano (JSON), Carica nuovo piano, Storico versioni, Chiudi.

## Alternativa per oggi (21 Nov)

A full-width outline button "✨ Alternativa per oggi" (sparkles: it uses the AI) under the actions of a planned meal still to eat, in Oggi's next meal card (inside the expanded details, above "Poi · …") and in the Timeline's planned cards (today only, "da registrare" and "dal piano"). It opens a panel under the button: a "Suggerimento (facoltativo)" field, one sentence on what the proposal is calibrated on, and "Annulla / Genera". The proposal is a soft green card: "PROPOSTA PER OGGI", the dish, one line per food with its dose, kcal and macros, the budget ("Per questo pasto: circa 230 kcal e 18 g di proteine"), "Perché: …", and "Annulla / Un'altra / Registra questo". "Registra questo" opens the confirmation screen of a new meal with the eyebrow "ALTERNATIVA", the type of the planned meal and the time now.

"Modifica pasto" of the plan: on a saved meal whose foods have no values of their own, "Dividi in alimenti con l'IA" (sparkles) sits with the other two tools. It opens, under the editor, a short note (what is estimated, that the sum stays the meal's, that nothing is saved until Conferma) and "Annulla / Proponi"; then "PROPOSTA PER ALIMENTO": one row per food with its amount and "kcal · P g", a line telling to check the amounts, and "Annulla / Conferma". After Conferma the button no longer appears for that meal.

Piano ⋯ menu: "Dividi la settimana in alimenti con l'IA" (sparkles) between "Genera con l'IA" and "Lista della spesa", only while a meal of the week lacks its food values. It opens a card at the top of the plan: a note (one request per day, nothing saved until confirmed), "Annulla / Proponi per la settimana", then "PROPOSTA PER LA SETTIMANA" listing each day, its meals and foods with kcal, and "Annulla / Conferma la settimana".
