import { createReadStream } from "node:fs";
import { BACKUP_KEEP, type BackupStatus } from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { NutritionBackups } from "../services/nutritionBackups.js";

export interface BackupRoutesOptions {
  backups: NutritionBackups;
  requireOwner: preHandlerHookHandler;
}

const settingsBody = z.object({ keep: z.number().int().min(BACKUP_KEEP.min).max(BACKUP_KEEP.max) }).strict();

/** Impostazioni › Backup (docs/backups.md): list, backup now, how many to keep, download. Owner only. */
export const backupRoutes: FastifyPluginAsync<BackupRoutesOptions> = async (app, { backups, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  app.get("/backups", async (): Promise<BackupStatus> => backups.status());

  app.post("/backups/run", async (): Promise<BackupStatus> => {
    await backups.run();
    return backups.status();
  });

  app.put("/backups/settings", async (request, reply) => {
    const body = settingsBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_settings" });
    await backups.setKeep(body.data.keep);
    return backups.status();
  });

  // The ZIP exactly as Nutrition produced it
  app.get<{ Params: { name: string } }>("/backups/:name", async (request, reply) => {
    const path = await backups.path(request.params.name);
    if (!path) return reply.code(404).send({ error: "not_found" });
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", `attachment; filename="intake-${request.params.name}"`)
      .header("cache-control", "no-store")
      .send(createReadStream(path));
  });
};
