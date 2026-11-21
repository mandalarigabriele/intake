# Generate the meal plan with AI

Part of **Pasti da foto** (needs `ANTHROPIC_API_KEY`). Piano › ⋯ › "Genera con l'IA", or the button on the empty Piano.

## Flow

1. **Preferences** (saved in the settings table, key `plan_generation`): meals of the day (name, time, type; the active plan's slots by default), free meals per weekday, variety (same dish at most N times a week, never twice in a day, same breakfast allowed), diet, allergies and dislikes, cooking time on weekdays, leftovers, seasonal produce, free notes, and "Impara dai miei pasti" (off by default: sends the descriptions of the last 14 days of meals, at most 40).
2. **Generation**: a background job (`POST /api/plans/generate`, read every 2 s with `GET /api/plans/generate/:id`), because a week takes longer than a proxy waits for one request. One job at a time, kept 1 hour in memory; nothing is saved until "Attiva".
3. **Review**: the draft with the day totals against the Nutrition goals, the problems found, a "Sostituisci" per meal and editable times.
4. **Attiva dal …** saves the draft as a new plan version (`POST /api/plans/generate/:id/activate`); older versions stay in Storico versioni.

## What is sent to Claude

Only on "Genera piano" / "Sostituisci": the daily goals, the preferences and notes, the Il tuo fabbisogno profile (sex, age, height, weight, goal) when filled in, and the recent meal descriptions when "Impara dai miei pasti" is on. The key stays in the server `.env` and is never logged; each request logs only the model, the stop reason and the token usage.

## Model and output

The model is chosen in Impostazioni › Funzioni (separate from the photo model, key in `plan_generation`, Sonnet by default, allowlist in `PLAN_MODELS`). The request is streamed with a structured output (JSON schema, low effort and room for 64 000 output tokens, because thinking counts toward the limit; an answer cut at the limit is reported as "unreadable" and nothing is saved); the answer is validated with zod and converted to a `MealPlan` (`toMealPlan`).

## Checks

`checkPlan` (`packages/shared/src/planGeneration.ts`) is plain code, not AI: each day within 7% of the calories and not more than 10 g under the protein goal, allergens and dislikes (case and accent insensitive), dishes repeated beyond the limit, the same dish twice in a day and free meals where requested. When something fails the problems go back to the model once for a corrected plan; what is still wrong is shown in the review, on the affected meals and in the summary card. Days with a free meal are not checked against the totals.

## Editing the draft and the plan

- `POST /api/plans/generate/:id/replace` {day, index, note}: another dish for one meal (single-meal structured output, same kcal and protein, different from the dishes of the week); the checks run again.
- `PATCH /api/plans/generate/:id/time` and `PATCH /api/plans/:id/time` {day, index, time, allDays}: a new time for one meal, or for the same meal on every day ("Stesso orario tutti i giorni", on by default). On a stored plan it updates the version in place (`PlanStore.update`), so Oggi and Timeline follow.

The result is a health-neutral food plan for healthy adults; the app says so and does not replace a doctor or dietitian.
