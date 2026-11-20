import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BackupFile, BackupStatus } from "@intake/shared";
import type { BackupStore } from "../db/backupStore.js";
import { NotConnectedError, RateLimitedError } from "../mcp/connection.js";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { isNutritionExportUrl, ParseError } from "../parsers/index.js";

/** "nutrition-2026-11-21.zip": one file per local day; a backup by hand on the same day replaces it. */
const FILE = /^nutrition-(\d{4}-\d{2}-\d{2})\.zip$/;
/** After a failed attempt the automatic backup waits this long before trying again. */
const RETRY_MS = 30 * 60 * 1000;
/** Larger answers are refused (a full export is a few MB). */
const MAX_BYTES = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** Short reasons stored with the last attempt; the web app turns them into text. */
export type BackupError = "not_connected" | "rate_limited" | "unexpected_answer" | "download_failed" | "not_zip" | "failed";

class BackupFailure extends Error {
  constructor(readonly reason: BackupError) {
    super(reason);
  }
}

export interface NutritionBackupsDeps {
  /** Folder in the data volume, e.g. /data/backups/nutrition. */
  dir: string;
  api: Pick<NutritionApi, "clock" | "exportAllData">;
  store: BackupStore;
  log: { warn(details: object, message: string): void; info(details: object, message: string): void };
  /** Downloads the archive (replaced in tests). */
  download?: (url: string) => Promise<Buffer>;
  now?: () => Date;
}

/** Downloads the export within its 60 minutes, refusing anything that is not a reasonably sized file. */
async function fetchArchive(url: string): Promise<Buffer> {
  if (!isNutritionExportUrl(url)) throw new BackupFailure("unexpected_answer");
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch {
    throw new BackupFailure("download_failed");
  }
  if (!response.ok) throw new BackupFailure("download_failed");
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) throw new BackupFailure("download_failed");
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_BYTES) throw new BackupFailure("download_failed");
  return body;
}

/** A ZIP archive starts with "PK\x03\x04". */
const isZip = (body: Buffer) => body.length > 4 && body[0] === 0x50 && body[1] === 0x4b && body[2] === 0x03 && body[3] === 0x04;

function reasonOf(error: unknown): BackupError {
  if (error instanceof BackupFailure) return error.reason;
  if (error instanceof NotConnectedError) return "not_connected";
  if (error instanceof RateLimitedError) return "rate_limited";
  if (error instanceof ParseError) return "unexpected_answer";
  return "failed";
}

/**
 * Daily backup of everything stored in Nutrition (docs/backups.md). Once a minute it checks whether today's backup
 * (Nutrition profile timezone) exists; the first check after midnight takes it. The ZIP from export_all_data is saved
 * exactly as Nutrition produced it, never opened; the newest `keep` files are kept. Two Nutrition calls a day.
 */
export class NutritionBackups {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly download: (url: string) => Promise<Buffer>;
  private readonly now: () => Date;

  constructor(private readonly deps: NutritionBackupsDeps) {
    this.download = deps.download ?? fetchArchive;
    this.now = deps.now ?? (() => new Date());
  }

  start(intervalMs = 60_000): void {
    void this.removePartial();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The automatic check: takes today's backup if it is missing, waiting 30 minutes after a failure. */
  async tick(): Promise<boolean> {
    if (this.running) return false;
    const last = this.deps.store.lastRun();
    if (last?.error && this.now().getTime() - Date.parse(last.at) < RETRY_MS) return false;
    let date: string;
    try {
      date = (await this.deps.api.clock()).localDate;
    } catch (error) {
      this.fail(error);
      return false;
    }
    if ((await this.list()).some((file) => file.date === date)) return false;
    return this.run();
  }

  /** Takes a backup now (also "Fai un backup ora"); returns whether it was saved. Never throws. */
  async run(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      const date = (await this.deps.api.clock()).localDate;
      const link = await this.deps.api.exportAllData();
      const body = await this.download(link.url);
      if (!isZip(body)) throw new BackupFailure("not_zip");
      await mkdir(this.deps.dir, { recursive: true });
      const name = `nutrition-${date}.zip`;
      const partial = join(this.deps.dir, `${name}.part`);
      await writeFile(partial, body, { mode: 0o600 });
      await rename(partial, join(this.deps.dir, name));
      await this.prune();
      this.deps.store.recordRun(this.now().toISOString(), null);
      this.deps.log.info({ file: name, bytes: body.length, summary: link.summary }, "Nutrition backup saved");
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    } finally {
      this.running = false;
    }
  }

  private fail(error: unknown): void {
    const reason = reasonOf(error);
    this.deps.store.recordRun(this.now().toISOString(), reason);
    this.deps.log.warn({ reason, err: (error as Error)?.message }, "Nutrition backup failed");
  }

  /** Saved backups, newest first. */
  async list(): Promise<BackupFile[]> {
    let names: string[];
    try {
      names = await readdir(this.deps.dir);
    } catch {
      return [];
    }
    const files = await Promise.all(
      names
        .map((name) => ({ name, match: FILE.exec(name) }))
        .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
        .map(async ({ name, match }) => {
          const info = await stat(join(this.deps.dir, name));
          return { name, date: match[1]!, createdAt: info.mtime.toISOString(), size: info.size };
        }),
    );
    return files.sort((a, b) => b.date.localeCompare(a.date));
  }

  /** Path of a saved backup, or null for any name that is not one (no other file can be reached). */
  async path(name: string): Promise<string | null> {
    if (!FILE.test(name)) return null;
    return (await this.list()).some((file) => file.name === name) ? join(this.deps.dir, name) : null;
  }

  /** Keeps the newest `keep` backups. */
  async prune(): Promise<void> {
    const keep = this.deps.store.keep();
    for (const file of (await this.list()).slice(keep)) await unlink(join(this.deps.dir, file.name));
  }

  /** At start: leftovers of a write interrupted by a restart. */
  async removePartial(): Promise<void> {
    const names = await readdir(this.deps.dir).catch(() => [] as string[]);
    for (const name of names.filter((n) => n.endsWith(".zip.part"))) await unlink(join(this.deps.dir, name)).catch(() => {});
  }

  async setKeep(keep: number): Promise<void> {
    this.deps.store.setKeep(keep);
    await this.prune();
  }

  async status(): Promise<BackupStatus> {
    return { keep: this.deps.store.keep(), files: await this.list(), lastRun: this.deps.store.lastRun(), running: this.running };
  }
}
