import type { HevySyncStatus } from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { HevySyncStore } from "../db/hevySyncStore.js";
import type { HevySync } from "../services/hevySync.js";

export interface HevySyncRoutesOptions {
  /** Null when Hevy or openGym is not configured. */
  sync: HevySync | null;
  store: HevySyncStore;
  requireOwner: preHandlerHookHandler;
}

const putSchema = z.object({ enabled: z.boolean() });

/** The optional openGym → Hevy copy (docs/hevy-sync.md): status with a preview, on/off, and "copy now". */
export const hevySyncRoutes: FastifyPluginAsync<HevySyncRoutesOptions> = async (app, { sync, store, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  const status = async (log: { warn(details: object, message: string): void }): Promise<HevySyncStatus> => {
    if (!sync) return { available: false, enabled: false, lastRun: null, pending: null };
    let pending: HevySyncStatus["pending"] = null;
    try {
      pending = (await sync.plan()).items;
    } catch (error) {
      log.warn({ err: (error as Error).message }, "openGym → Hevy preview unavailable");
    }
    return { available: true, enabled: store.enabled(), lastRun: store.lastRun(), pending };
  };

  app.get("/hevy-sync", async (request) => status(request.log));

  app.put("/hevy-sync", async (request, reply) => {
    if (!sync) return reply.code(409).send({ error: "Hevy and openGym must both be configured" });
    const body = putSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid body" });
    store.setEnabled(body.data.enabled);
    // Turning it on copies right away, so the result shows up in the status
    if (body.data.enabled) await sync.run();
    return status(request.log);
  });

  app.post("/hevy-sync/run", async (request, reply) => {
    if (!sync) return reply.code(409).send({ error: "Hevy and openGym must both be configured" });
    await sync.run();
    return status(request.log);
  });
};
