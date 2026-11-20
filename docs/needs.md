# Il tuo fabbisogno (daily needs)

A card at the top of Piano and its page (`/piano/fabbisogno`) that work out the daily calories and macros from a
few fields, check the active goal against the real data, and, on request, ask the AI for an opinion.

## The card (Piano)

Piano has a small switch at the top, "Piano pasti" / "Fabbisogno": the meal plan comes first, since it is what is
read during the day. Impostazioni › Aspetto › "Piano apre su" makes Fabbisogno the first one instead (per device,
like the theme). The address keeps the choice (`/piano?vista=fabbisogno`), so coming back from the page shows the
card again. The plan's subtitle and ⋯ menu show only with the meal plan.

1. **Active goal**: the goal (Definizione, Mantenimento, Ricomposizione, Massa) and, when the goals were applied from
   here and Nutrition still has the same calories and protein, where they came from ("calcolo standard",
   "proposta IA", "dai tuoi dati"). Calories and macros come live from Nutrition. A short line gives the weight, the
   workouts a week and the estimated maintenance.
2. **Verifica sui tuoi dati**: arithmetic only, no AI. See [the check](#the-check-on-the-data).
3. **Il parere dell'IA**, separate from the settings: "Chiedi" asks the AI from the card with the saved fields, and
   the last opinion is shown there (see [the AI opinion](#the-ai-opinion)). Shown only while the AI can be used.

Without saved fields the card shows "Calcola il tuo fabbisogno" and the data check, without a suggestion.

## The form

| Group | Fields | Prefilled from |
|---|---|---|
| Tu | sex, age (18–100), height (120–230 cm); the weight is the latest weigh-in in Nutrition (30 days) | — |
| Vita di tutti i giorni | work (seated, on my feet, physical), steps a day | average of the last 14 days of Apple Health steps (Salute on) |
| Allenamenti | times a week, type (weights, cardio, mixed), average length | the last 4 weeks of the active gym app (Allenamenti on) |
| Obiettivo | goal and, for cut and bulk, the pace (steady, fast) | — |
| Note per l'IA | free text, at most 500 characters, used only by the AI opinion | — |

The prefill is used only before the first save. Without a weigh-in the page asks to log one in Profile. Under the
fields, the standard calculation updates while typing, with "Salva" (keeps the fields) and "Applica agli obiettivi"
(keeps the fields and sets the goals). The page has no AI part apart from the notes.

## The calculation

All in `packages/shared/src/needs.ts`, with tests.

- Basal rate: Mifflin-St Jeor (`10 × kg + 6.25 × cm − 5 × age`, +5 for men, −161 for women).
- Maintenance: basal × work factor (seated 1.2, on my feet 1.35, physical 1.55), plus the steps above those the
  work already includes (5,000 / 9,000 / 13,000) at 0.0005 kcal per step per kg, plus training: times a week ×
  minutes × 0.07 (weights), 0.11 (cardio) or 0.09 (mixed) kcal per kg per minute, spread over the week.
- Goal: cut −15% (fast −22%), recomposition −5%, maintenance 0, bulk +7% (fast +12%), rounded to 10 kcal.
- Macros: protein 2.2 g/kg (cut), 2.0 (recomposition), 1.6 (maintenance), 1.8 (bulk); fat 27% of the calories and at
  least 0.7 g/kg; carbohydrates take the rest. Grams are rounded to 5.
- Safety floor: never below the basal rate, nor below 1,500 kcal (men) or 1,200 kcal (women). When the floor raises
  the calories the page says so.

## The check on the data

The last 21 days before today (today is not over): the days with meals and at least 800 kcal (a lighter day is most
likely not fully logged) and the weigh-ins. It needs at least 10 such days and 3 weigh-ins spread over at least 10
days; otherwise it says how many there are.

Real maintenance = average calories − weight trend (least-squares slope, kg a day) × 7,700 kcal. The suggestion is
that maintenance with the goal's adjustment, never under the floor; within 100 kcal of the active goal it is
"in linea". "Applica" sets the suggested calories with the macros of the goal.

## The AI opinion

Part of Pasti da foto (`photoMeals`): it needs `ANTHROPIC_API_KEY` and the switch on, and it uses the same model as
the meal recognition (Impostazioni › Modello IA). With the part off, `POST /api/needs/ai` answers 404 and the card
and page hide the AI part and the last opinion.

- Sent only when the user asks: the fields, the notes, the weight, the standard calculation and the data check.
  Nothing else (no meals, no names).
- `services/needsAdvisor.ts`: the official SDK with a structured output (summary, calories, protein, carbohydrates,
  fat, two to four tips) at medium effort. The system prompt asks to stay within safe limits and not to give medical
  advice. Each request logs only its token usage.
- The proposal always goes through `limitTargets`: calories between the floor and maintenance −25% / +20%, protein
  0.8–3 g/kg, fat at least 0.5 g/kg, carbohydrates recomputed so the grams add up. When anything changed the page
  says so.
- The card shows the summary, the standard calculation and the proposal side by side, the tips and
  "Tieni il calcolo" / "Usa la proposta" ("✓ Proposta dell'IA in uso" once applied). Nothing changes in Nutrition
  until one is chosen. The last opinion is kept until the next one.

## Applying a goal

`POST /api/needs/apply` sets calories, protein, carbohydrates and fat in Nutrition (`set_nutrition_goals`), the same
goals as Profile › Obiettivi and the Claude chats. The server refuses calories under the floor and protein or fat
outside the limits, whatever the source.

## Storage

Settings key `needs` (`db/needsStore.ts`): the form fields (sex, age, height, work, steps, workouts, goal, pace,
notes), the source of the last applied goal and the last AI opinion. The weight and the goals stay in Nutrition.

## API

- `GET /api/needs` → `NeedsView`: fields, weight, calculation, active goals, applied source, data check, last AI
  opinion, whether the AI can be used, prefill. Four Nutrition reads (clock, goals, 30 days of weight, 21 days of
  summary), cached for 30 seconds like every read.
- `PUT /api/needs/profile` with the fields → `NeedsView`.
- `POST /api/needs/apply` with `{ source: "standard" | "ai" | "check", targets: { kcal, protein, carbs, fat } }`.
- `POST /api/needs/ai` → the opinion; errors as the meal recognition (`recognition_credit`, `recognition_busy`, …).
