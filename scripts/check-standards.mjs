#!/usr/bin/env node
// Checks the project rules that a machine can verify (see CONTRIBUTING.md). Runs in CI on every
// pull request and locally with `npm run check:standards`. Exits with 1 and lists every problem.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const problems = [];
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);

// 1. No environment files with real values: only .env.example belongs in the repository.
for (const file of tracked) {
  const name = file.split("/").pop();
  if (/^\.env(\..+)?$/.test(name) && name !== ".env.example") problems.push(`${file}: environment files must not be committed, only .env.example`);
}

// 2. .env.example holds variable names only, never values.
for (const [i, line] of readFileSync(".env.example", "utf8").split("\n").entries()) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && /(SECRET|TOKEN|KEY|PASSWORD)/.test(m[1]) && m[2].trim() !== "") problems.push(`.env.example:${i + 1}: ${m[1]} must be left empty`);
}

// 3. Colors come from tokens: no raw hex in the web app outside tokens.css.
// Allowed: the Google logo (brand colors) and the browser theme-color meta, which cannot use CSS variables.
const HEX_ALLOWED = new Set(["apps/web/src/styles/tokens.css", "apps/web/src/components/icons.tsx", "apps/web/src/lib/theme.ts"]);
for (const file of tracked) {
  if (!file.startsWith("apps/web/src/") || !/\.(tsx?|css)$/.test(file) || HEX_ALLOWED.has(file)) continue;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (/#[0-9a-fA-F]{3,8}\b/.test(line) && !/^\s*(\/\/|\*)/.test(line)) problems.push(`${file}:${i + 1}: raw hex color, use a token from styles/tokens.css`);
    });
}

// 4. The meal plan JSON schema is generated, never edited by hand: it must match the zod schema.
execFileSync("node", ["scripts/generate-plan-schema.mjs"], { stdio: "ignore" });
const drift = execFileSync("git", ["status", "--porcelain", "schemas/"], { encoding: "utf8" }).trim();
if (drift) problems.push("schemas/meal-plan.schema.json is out of date: run `npm run schema` and commit the result");

if (problems.length) {
  console.error(`Project standards: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("Project standards: OK");
