# Meal plan file format

Meal plans are generated in the Claude Fitness project and uploaded on the **Plan** page (Piano; `⋯` → upload a new plan). A plan becomes active from its valid-from date; previous versions are kept as history (*Storico versioni*).

Intake accepts two formats and detects which one a file uses:

1. **Claude Fitness format** (recommended, what Claude Fitness generates): converted to Intake's model on upload.
2. **Intake format**: the internal model, described by [`schemas/meal-plan.schema.json`](../schemas/meal-plan.schema.json) (generated from [`packages/shared/src/mealPlan.ts`](../packages/shared/src/mealPlan.ts) with `npm run schema`).

Examples: [`examples/claude-fitness-plan.example.json`](../examples/claude-fitness-plan.example.json) and [`examples/meal-plan.example.json`](../examples/meal-plan.example.json).

## Claude Fitness format

The fields Intake reads; anything else (`targets`, `goal`, `macros_info`, `shopping_list`, `day_macros`, `alternative_macros`…) is ignored.

| Field | Notes |
|---|---|
| `schema_version` | `1` or `2` (version 2 adds `grams` on items and per-meal `macros`, `null` on free meals) |
| `updated` | `YYYY-MM-DD`; the plan becomes active from this date unless `valid_from` is given |
| `valid_from` | Optional `YYYY-MM-DD`, overrides `updated` as the first active day |
| `meal_slots[]` | `id`, `label`, `time` (`HH:MM`). Order defines the order of the day. `Spuntino 11` is shown as "Spuntino" at 11:00 |
| `free_meals[]` | Optional `{ day, meal }` pairs marking free slots |
| `notes[]` | Optional, shown under *Note del piano* |
| `days[]` | All seven days (`monday` … `sunday`) |
| `days[].expected_protein_g` | Shown on the day tab ("135 g") and as the day note |
| `days[].tags` | `sweet_snack` shows "dolce" on the day tab |
| `days[].free_meals` | Free slots of that day |
| `days[].meals.<slot id>` | `description`, `items[]` (`food`, `quantity`, `unit`, `note`, `grams`), optional `alternative[]`, `free`, `sweet`, `family_friendly`, `macros` |

A meal with `free: true`, listed in a free-meals field, or with no items is shown as **Libero**. The meal type (breakfast, lunch, dinner, snack) comes from the slot id or label. When an item's unit is not a weight or volume (`pz`, `fette`…), its `grams` are shown next to it: "Banana 1 pz (118 g)".

### Per-meal `macros` (needed for "Eaten as planned")

"Eaten as planned" (Mangiato come previsto) logs the planned meal to Nutrition with its nutrients. Without them the meal would be stored with no calories or macros, and that day would drop out of the averages. So **the button is disabled for meals without `macros`**, and the timeline suggests logging them through *Altro…* or Claude.

Add a `macros` object to every non-free meal:

```json
"macros": {
  "kcal": 430,
  "protein_g": 27,
  "carbs_g": 62,
  "fat_g": 8,
  "fiber_g": 6,
  "sugar_g": 28,
  "added_sugar_g": 6,
  "saturated_fat_g": 3,
  "sodium_mg": 120,
  "caffeine_mg": 63
}
```

| Field | Unit | Required |
|---|---|---|
| `kcal`, `protein_g`, `carbs_g`, `fat_g`, `fiber_g` | kcal / g | yes |
| `sugar_g` + `added_sugar_g` | g | no, but always together; `added_sugar_g` ≤ `sugar_g` |
| `saturated_fat_g` | g | no; ≤ `fat_g` |
| `sodium_mg` | mg | no; sodium, not salt (1 g salt ≈ 400 mg sodium) |
| `caffeine_mg` | mg | no; only for caffeine sources (coffee, tea, chocolate…) |

`0` is the correct value for a nutrient the meal does not contain.

## Intake format (summary)

`schemaVersion: 1`, `validFrom`, optional `notes[]`, and `days.monday` … `days.sunday`. Each day has optional `label`, `note`, `expectedProtein` and `meals[]`. A meal has `title`, optional `time` and `type`, optional `description`, and either `free: true` or `foods[]` (`name`, optional `quantity`, `unit`, `note`) plus optional `macros` (`kcal`, `protein`, `carbs`, `fat`, `fiber`, `sugar` + `addedSugar`, `saturatedFat`, `sodiumMg`, `caffeineMg`).

## Timeline behavior

- Meals without a time use default slots: breakfast 08:00, lunch 13:00, dinner 20:00, snacks 11:00 before lunch and 16:00 after.
- A planned meal is hidden once covered: by "Eaten as planned", or by a logged meal of the same type (e.g. logged through Claude) from 1 hour before to 3 hours after the planned time with, when the plan has macros, at least 40% of the planned kcal. Each logged meal covers at most one planned meal, the nearest in time.
- Uncovered planned meals are "to log" once their time has passed (or on past days), "from the plan" before that, and "free" for free slots. "Skip" marks one as skipped for that day (stored locally, restorable with "Undo").
