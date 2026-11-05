import { readFileSync } from "node:fs";

const dir = new URL("../../src/parsers/__fixtures__/", import.meta.url);

export function fixture(name: string): string {
  return readFileSync(new URL(name, dir), "utf8");
}
