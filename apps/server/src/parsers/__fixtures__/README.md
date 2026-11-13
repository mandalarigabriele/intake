# MCP response fixtures

Real text responses from the Nutrition MCP server, used as parser test cases.
Meal IDs are replaced with placeholder UUIDs; everything else is kept verbatim.

| File | Tool | Arguments |
|---|---|---|
| `meals-full-today.txt` | `get_meals_today` | `detail: "full"` |
| `meals-full-by-date.txt` | `get_meals_by_date` | `date`, `detail: "full"` |
| `meals-empty.txt` | `get_meals_by_date` | a date with no meals |
| `meals-full-range.txt` | `get_meals_by_date_range` | two days, `detail: "full"` (shortened) |
| `goals.txt` | `get_nutrition_goals` | – |
| `current-time.txt` | `get_current_time` | – |
| `profile.txt` | `get_profile` | – |
| `meal-patterns-7d.txt` | `get_meal_patterns` | `days: 7` |
| `goal-progress.json` | `get_goal_progress` | `date` (structuredContent only) |
| `nutrition-summary.json` | `get_nutrition_summary` | 7 days (structuredContent only) |
| `weight-trends-empty.json` | `get_weight_trends` | no weigh-ins yet (structuredContent only) |
| `hevy-workouts.json` | Hevy API `GET /v1/workouts` | `page=1&pageSize=10`, first 3 workouts (IDs and notes replaced) |
| `hevy-routines.json` | Hevy API `GET /v1/routines` | `page=1&pageSize=10` (IDs and template IDs replaced, notes removed) |
| `hevy-workouts-history.json` | Hevy API `GET /v1/workouts` | workouts since 7 Sep 2026, same ID mapping as `hevy-routines.json` so routines and history match (descriptions and notes removed) |
| `health-auto-export.json` | Health Auto Export (iOS) manual JSON export | 23–30 Oct 2026, daily aggregation; workout IDs replaced, routes, splits and per-minute arrays except workout heart rate removed, device name generalized, mood and medications replaced by one placeholder each |

When the server output changes, add the new response as a fixture before changing the parser.
