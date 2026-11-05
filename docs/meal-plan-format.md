# Meal plan file format

Meal plans are generated in the Claude Fitness project and uploaded to Intake as a JSON file. A plan becomes active from its `validFrom` date onward; previous versions are kept as history.

- JSON Schema: [`schemas/meal-plan.schema.json`](../schemas/meal-plan.schema.json). Paste it into the Claude Fitness project so that generated plans match it.
- Example: [`examples/meal-plan.example.json`](../examples/meal-plan.example.json)
- Source of truth: the zod schema in [`packages/shared/src/mealPlan.ts`](../packages/shared/src/mealPlan.ts). The JSON Schema is generated from it with `npm run schema`.

## Structure

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `1` | Format version |
| `validFrom` | `YYYY-MM-DD` | First day the plan is active |
| `days` | object | Keys `monday` … `sunday`, all seven required |
| `days.<day>.meals[]` | array | Meals of that weekday (may be empty) |
| `meals[].time` | `HH:MM` | Local time, 24-hour |
| `meals[].title` | string | e.g. "Breakfast" |
| `meals[].foods[]` | array | At least one food: `name`, `quantity` (> 0), `unit` (e.g. `g`, `ml`, `piece`) |
| `meals[].macros` | object | Estimated nutrients for the whole meal, see below |

## Nutrients (`macros`)

| Field | Unit | Required |
|---|---|---|
| `kcal` | kcal | yes |
| `protein` | g | yes |
| `carbs` | g | yes |
| `fat` | g | yes |
| `fiber` | g | yes |
| `sugar` | g | no, but must be given together with `addedSugar` |
| `addedSugar` | g | no, but must be given together with `sugar` |
| `saturatedFat` | g | no |
| `sodiumMg` | mg | no |
| `caffeineMg` | mg | no |

Rules:

- `addedSugar` ≤ `sugar` and `saturatedFat` ≤ `fat`.
- `sodiumMg` is sodium, not salt: 1 g of salt holds about 400 mg of sodium.
- `caffeineMg` only applies to caffeine sources (coffee, tea, cola, energy drinks, chocolate…). Leave it out for other meals.
- `0` is the correct value for a nutrient the meal does not contain (e.g. `addedSugar: 0` for plain yogurt and fruit).
- Unknown fields are rejected.

## Why the optional nutrients matter

"Mark as eaten as planned" logs the planned meal to the Nutrition MCP server with these values. The server stores a missing nutrient as "not measured" and leaves that whole day out of the averages, goal lines and charts for that nutrient. Filling in sugar, added sugar, saturated fat, sodium and caffeine keeps those days in.
