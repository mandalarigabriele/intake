import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { BackupStore } from "../src/db/backupStore.js";
import { NotConnectedError } from "../src/mcp/connection.js";
import { NutritionBackups } from "../src/services/nutritionBackups.js";
import { authOptions, signIn } from "./helpers.js";

const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("archive body")]);
const LINK = { url: "https://p.supabase.co/storage/v1/object/sign/exports/x/nutrition-mcp-export.zip?token=t", summary: "Exported all data" };

function setup(options: { date?: string; body?: Buffer } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "intake-backups-"));
  const store = new BackupStore(openDatabase(":memory:"));
  let now = new Date("2026-11-21T00:00:30Z");
  let date = options.date ?? "2026-11-21";
  const api = {
    clock: vi.fn(async () => ({ timezone: "Europe/Rome", localDate: date, localTime: "00:00:30", utc: now.toISOString() })),
    exportAllData: vi.fn(async () => LINK),
  };
  const download = vi.fn(async () => options.body ?? ZIP);
  const log = { warn: vi.fn(), info: vi.fn() };
  const backups = new NutritionBackups({ dir, api, store, log, download, now: () => now });
  return {
    dir,
    store,
    api,
    download,
    backups,
    setDay(day: string, at: string) {
      date = day;
      now = new Date(at);
    },
  };
}

describe("daily Nutrition backups", () => {
  it("saves the export ZIP unchanged, once per local day", async () => {
    const { dir, backups, api, download } = setup();
    expect(await backups.tick()).toBe(true);
    expect(readdirSync(dir)).toEqual(["nutrition-2026-11-21.zip"]);
    expect(readFileSync(join(dir, "nutrition-2026-11-21.zip")).equals(ZIP)).toBe(true);
    expect(download).toHaveBeenCalledWith(LINK.url);
    // Later the same day: nothing to do, no export requested
    expect(await backups.tick()).toBe(false);
    expect(api.exportAllData).toHaveBeenCalledTimes(1);
  });

  it("keeps only the newest backups, and fewer at once when the setting goes down", async () => {
    const { dir, backups, store, setDay } = setup();
    store.setKeep(3);
    for (const day of ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]) {
      setDay(day, `${day}T00:01:00Z`);
      await backups.tick();
    }
    expect(readdirSync(dir).sort()).toEqual(["nutrition-2026-11-19.zip", "nutrition-2026-11-20.zip", "nutrition-2026-11-21.zip"]);
    await backups.setKeep(1);
    expect(readdirSync(dir)).toEqual(["nutrition-2026-11-21.zip"]);
    expect((await backups.status()).files.map((f) => f.date)).toEqual(["2026-11-21"]);
  });

  it("refuses an answer that is not a ZIP and waits 30 minutes before trying again", async () => {
    const { dir, backups, store, api, setDay } = setup({ body: Buffer.from("<html>expired</html>") });
    expect(await backups.tick()).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
    expect(store.lastRun()).toMatchObject({ error: "not_zip" });
    setDay("2026-11-21", "2026-11-21T00:20:00Z");
    expect(await backups.tick()).toBe(false);
    expect(api.exportAllData).toHaveBeenCalledTimes(1);
    setDay("2026-11-21", "2026-11-21T00:31:00Z");
    await backups.tick();
    expect(api.exportAllData).toHaveBeenCalledTimes(2);
  });

  it("records why it failed when Nutrition is not connected", async () => {
    const { backups, store, api } = setup();
    api.exportAllData.mockRejectedValueOnce(new NotConnectedError());
    expect(await backups.run()).toBe(false);
    expect(store.lastRun()).toMatchObject({ error: "not_connected" });
    expect(await backups.run()).toBe(true);
    expect(store.lastRun()).toMatchObject({ error: null });
  });

  it("serves only saved backups to the owner", async () => {
    const { dir, backups } = setup();
    await backups.run();
    writeFileSync(join(dir, "other.txt"), "not a backup");
    const app = await buildApp({ auth: authOptions(), backups: { backups } });
    expect((await app.inject({ method: "GET", url: "/api/backups" })).statusCode).toBe(401);

    const { cookie } = await signIn(app);
    const headers = { cookie };
    const status = (await app.inject({ method: "GET", url: "/api/backups", headers })).json();
    expect(status).toMatchObject({ keep: 10, running: false, files: [{ name: "nutrition-2026-11-21.zip", date: "2026-11-21", size: ZIP.length }] });

    const file = await app.inject({ method: "GET", url: "/api/backups/nutrition-2026-11-21.zip", headers });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("application/zip");
    expect(file.headers["content-disposition"]).toContain('filename="intake-nutrition-2026-11-21.zip"');
    expect(file.rawPayload.equals(ZIP)).toBe(true);

    expect((await app.inject({ method: "GET", url: "/api/backups/other.txt", headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/backups/..%2Fintake.db", headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: "/api/backups/settings", headers, payload: { keep: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/backups/settings", headers, payload: { keep: 5 } })).json()).toMatchObject({ keep: 5 });
  });
});
