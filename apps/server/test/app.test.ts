import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

describe("app", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const webDistDir = mkdtempSync(join(tmpdir(), "intake-web-"));
    writeFileSync(join(webDistDir, "index.html"), "<!doctype html><title>Intake</title>");
    app = await buildApp({ webDistDir });
  });

  afterAll(async () => {
    await app.close();
  });

  it("responds on /api/health", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("serves index.html for client-side routes", async () => {
    const response = await app.inject({ method: "GET", url: "/weight" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<title>Intake</title>");
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const response = await app.inject({ method: "GET", url: "/api/unknown" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Not found" });
  });
});
