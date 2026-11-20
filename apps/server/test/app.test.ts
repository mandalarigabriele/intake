import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

describe("static files", () => {
  it("serves files added after startup (rebuilt web app)", async () => {
    const webDistDir = mkdtempSync(join(tmpdir(), "intake-web-"));
    writeFileSync(join(webDistDir, "index.html"), "<!doctype html><title>Intake</title>");
    const app = await buildApp({ webDistDir });
    writeFileSync(join(webDistDir, "app-123.js"), "console.log(1)");
    const response = await app.inject({ method: "GET", url: "/app-123.js" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("javascript");
    await app.close();
  });

  it("never serves a file outside the web folder, also with encoded separators", async () => {
    // A secret next to the web folder, as the data folder would be on the server
    const parent = mkdtempSync(join(tmpdir(), "intake-root-"));
    const webDistDir = join(parent, "web");
    mkdirSync(webDistDir);
    writeFileSync(join(webDistDir, "index.html"), "<!doctype html><title>Intake</title>");
    writeFileSync(join(parent, "secret.txt"), "TOP-SECRET");
    const app = await buildApp({ webDistDir });
    for (const url of ["/../secret.txt", "/..%2fsecret.txt", "/%2e%2e/secret.txt", "/..%5csecret.txt", "/%2e%2e%2fsecret.txt"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.body, url).not.toContain("TOP-SECRET");
    }
    await app.close();
  });
});
