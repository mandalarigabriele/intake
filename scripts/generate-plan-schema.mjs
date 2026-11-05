// Writes schemas/meal-plan.schema.json from the zod schema in @intake/shared.
// Run with `npm run schema` (builds the shared package first).
import { writeFileSync } from "node:fs";
import { mealPlanJsonSchema } from "@intake/shared";

const target = new URL("../schemas/meal-plan.schema.json", import.meta.url);
writeFileSync(target, JSON.stringify(mealPlanJsonSchema(), null, 2) + "\n");
console.log(`Wrote ${target.pathname}`);
