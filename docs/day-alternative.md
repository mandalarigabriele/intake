# Alternativa per oggi

Part of **Pasti da foto** (needs `ANTHROPIC_API_KEY`; paid, marked with the sparkles). A button "Alternativa per oggi" on a planned meal still to eat, in **Oggi** (the next meal card) and in the **Timeline** (today only). It is a suggestion for that day: the meal plan is never changed.

## Flow

1. The person taps the button and may write a hint ("ho zucchine e uova, poco tempo"; up to 300 characters). The ingredients they have are used as the base of the dish.
2. `POST /api/days/today/alternative` {index, note} (`routes/dayAlternative.ts`) builds the context and asks the AI for one dish (`PlanGenerator.suggestForDay`, plan model, structured output, low effort). Nothing is saved.
3. The app shows the dish with its foods and doses, its kcal and macros, the budget it aimed for and a short "Perché".
4. "Un'altra" asks again. "Registra questo" opens the confirmation screen (`/pasto/nuovo/alternativa`, `NewMealPage`) with the foods to correct (amounts in their unit, type of the planned meal, time now); "Registra pasto" logs it with `log_meal`. A logged meal of the same type near the planned time covers the planned meal as usual, so the Timeline shows it as eaten.

The proposal travels to the confirmation screen through `sessionStorage` (`lib/dayAlternativeDraft.ts`): it lives in the tab only and nothing of it is stored on the server.

## How it is calibrated

`dayBudget` (`packages/shared/src/dayAlternative.ts`): for each of kcal, protein, carbs, fat and fiber, the room for the meal is the day's goal minus what is eaten (Nutrition's totals of today) minus what the other planned meals still to eat bring (the meals covered by a logged meal, skipped or free count for nothing). It never goes below 150 kcal / 5 g protein, so a day already over its goals still gets a small meal; without a goal the meal's own planned value is used.

The request also carries the week so far (Monday to yesterday: days with meals, average kcal and protein, from `get_nutrition_summary`; a failure there only drops this hint), the stored generation preferences (diet, allergies, dislikes, cooking time; the defaults for an uploaded plan) and the dish being replaced. The system prompt asks to aim for the budget within about 10%, to follow the WHO healthy diet guidance (free sugars and saturated fat under 10% of energy, no industrial trans fat, little salt, at least 400 g of fruit and vegetables a day, fiber from whole grains and legumes, little processed meat), to lean slightly the other way when the week is under or over its goals, and to give no medical advice. The AI estimates the nutrients of every food from standard tables; the confirmation screen then scales them with the amounts.

## Limits

- Only for today, and only for a meal that is still open (`todo` or `planned`): an eaten, skipped or free meal answers 409 `meal_not_open`; without a plan in effect, 404 `no_plan`.
- The route is part of Pasti da foto (`FEATURE_ROUTES`): 404 `feature_disabled` while it is off, 503 without a key. Each request costs one Claude call and logs only its token usage.
- Nutrition requests per tap: the day's goals and meals (shared with the Oggi view, kept 30 seconds) and one summary of the week.
