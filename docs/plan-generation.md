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

- `PATCH /api/plans/generate/:id/swap` and `PATCH /api/plans/:id/swap` {day, index, toDay}: "Sposta" swaps the dish of a meal with the same meal of another day (each day has fixed meals, so moving a dish means swapping; a free meal can be moved too). Each slot keeps its title, time and type. On the draft the checks run again; on a stored plan the version is updated in place. Planned meals already logged keep their link to the slot, not to the dish.

- `PATCH /api/plans/generate/:id/meal` and `PATCH /api/plans/:id/meal` {day, index, description, foods, macros?}: "Modifica" edits one dish by hand: its text, its foods (name, amount, unit) and the main nutrients (kcal, protein, carbs, fat, fiber). The nutrients are not recalculated from the foods: the person updates them, or leaves them all empty to keep what the meal had; sugar, saturated fat and the other optional nutrients are kept, never above what they belong to. The slot keeps its title, time and type, and a free meal becomes a dish. On the draft the checks run again; on a stored plan the version is updated in place.

- **Cerca nel database** (free, no Claude request; `GET /api/foods/search?q=`, `GET /api/foods/:id?amount=`, `routes/foods.ts`, parser `parsers/foods.ts`): in the dish editor, for each food the person searches USDA FoodData Central through the Nutrition server's `search_foods` / `get_food_macros`, picks the right entry and the values for the grams of the row are added up into the editor's fields. The database is in English, so the person types the English name (the food's name is only the starting text); foods not picked are not counted and the editor says "N of M foods". It is part of Alimentazione (no key needed) and shares the 60 requests a minute, so the app searches only when asked.
- **Ricalcola con l'IA** (paid, marked with the sparkles; `POST /api/plans/estimate`, part Pasti da foto): one small request estimating the nutrients of the meal from its foods and amounts; the editor's fields are filled, nothing is saved until "Salva".
- **Alternativa** (paid, sparkles; `POST /api/plans/:id/alternative`, part Pasti da foto): on a stored plan, another dish for one meal, in its slot, close to its calories and protein, within the saved constraints (the generation preferences, or the defaults for an uploaded plan) and not already in the week; an optional wish ("senza forno"). It is shown next to the current dish and nothing changes until "Usa questo" (saved with the edit route, replacing the old dish's optional nutrients too); "Un'altra" asks again.
- `PATCH /api/plans/:id/start` {validFrom}: a scheduled version starts on another day, used by "Applica da oggi" (Piano shows a banner while a plan is scheduled). Versions already in effect answer 409.

- **Scarica il piano (JSON)** (Piano › ⋯): the plan Piano shows as a `.json` file (`piano-<date>.json`, the Intake meal plan format of `docs/meal-plan-format.md`, with the edits made in the app), made in the browser; on phones it opens the share sheet. It can be uploaded again with "Carica nuovo piano".

- **Values per food.** The generated plan carries the nutrients of every food (the AI answers with them and the meal's macros are their sum), and a single-dish replacement or alternative does the same. This is what lets "Mangiato come previsto" log a meal food by food (`plannedItems` in `services/logPlanned.ts`: items only when every food has its values, all-or-none keys handled as for other meals) instead of as a total, so the foods can be edited afterwards. Editing a dish by hand keeps a food's values when its name, unit and amount are unchanged, scales them in proportion when only the amount changes, and drops them when the name or unit changes; the meal's nutrients are then the sum of its foods', except when the person types totals that differ by more than 3%, in which case the foods' values are dropped and the typed totals win (`editMeal`).
- **Dividi in alimenti con l'IA** (paid, sparkles; `POST /api/plans/:id/split-foods`, part Pasti da foto) for a saved plan whose foods have no values (a plan loaded from a file, or generated before this existed): in "Modifica pasto", one small request estimates each food's values from its amount, asked to add up to the meal's totals already in the plan (the totals stay the reference). The app shows the proposal food by food and only "Conferma" (`PATCH /api/plans/:id/split-foods`) writes it, in the same version; a meal already split answers 409.

The result is a health-neutral food plan for healthy adults; the app says so and does not replace a doctor or dietitian.
