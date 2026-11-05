# MCP response fixtures

Real text responses from the Nutrition MCP server, used as parser test cases.
Meal IDs are replaced with placeholder UUIDs; everything else is kept verbatim.

| File | Tool | Arguments |
|---|---|---|
| `meals-full-today.txt` | `get_meals_today` | `detail: "full"` |
| `meals-full-by-date.txt` | `get_meals_by_date` | `date`, `detail: "full"` |
| `meals-empty.txt` | `get_meals_by_date` | a date with no meals |
| `goals.txt` | `get_nutrition_goals` | – |
| `current-time.txt` | `get_current_time` | – |
| `profile.txt` | `get_profile` | – |

When the server output changes, add the new response as a fixture before changing the parser.
