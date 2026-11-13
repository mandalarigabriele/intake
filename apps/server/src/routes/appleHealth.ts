import type { HealthDay, HealthImportResult, HealthSettings, HealthStatus, HealthSyncStatus, HealthTrends } from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { HealthStore } from "../db/healthStore.js";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { ParseError } from "../parsers/common.js";
import { parseHealthExport } from "../parsers/healthAutoExport.js";
import { healthDay } from "../services/healthDay.js";
import { healthStatus, importPreview, isEmptyExport } from "../services/healthImport.js";
import type { HealthIngestToken } from "../services/healthSync.js";
import { healthTrends, TREND_PERIODS } from "../services/healthTrends.js";
import { isValidDate } from "../services/dayView.js";

export interface AppleHealthRoutesOptions {
  store: HealthStore;
  /** "Today" in the Nutrition profile timezone, for the coverage and the stale state. */
  api: Pick<NutritionApi, "clock">;
  requireOwner: preHandlerHookHandler;
  /** Automatic upload settings; without it the sync routes answer 404. */
  sync?: { token: HealthIngestToken; endpoint: string };
}

/** Health Auto Export files can be large: a few months of daily data with workouts. */
export const HEALTH_IMPORT_MAX_BYTES = 50 * 1024 * 1024;

const settingsSchema = z.object({ stepGoal: z.number().int().min(2000).max(30000) });

/** Apple Health import and status under /api/health (docs/apple-health.md). */
export const appleHealthRoutes: FastifyPluginAsync<AppleHealthRoutesOptions> = async (app, { store, api, requireOwner, sync }) => {
  app.addHook("preHandler", requireOwner);

  app.get("/health/status", async (): Promise<HealthStatus> => {
    const today = (await api.clock()).localDate;
    return healthStatus(store, today);
  });

  // A day of Apple Health data for Today; "today" is resolved in the Nutrition profile timezone
  app.get<{ Params: { date: string } }>("/health/days/:date", async (request, reply): Promise<HealthDay | void> => {
    const today = (await api.clock()).localDate;
    const date = request.params.date === "today" ? today : request.params.date;
    if (!isValidDate(date)) return reply.code(400).send({ error: "date must be YYYY-MM-DD or today" });
    return healthDay(store, date, today);
  });

  // Andamento › Salute: the last 7, 30 or 90 days ending today
  app.get<{ Querystring: { days?: string } }>("/health/trends", async (request, reply): Promise<HealthTrends | void> => {
    const period = Number(request.query.days ?? 7);
    if (!TREND_PERIODS.includes(period as 7)) return reply.code(400).send({ error: "days must be 7, 30 or 90" });
    const today = (await api.clock()).localDate;
    return healthTrends(store, today, period as 7 | 30 | 90);
  });

  // ?commit=true writes the data; without it the same request only returns the preview
  app.post<{ Querystring: { commit?: string } }>(
    "/health/import",
    { bodyLimit: HEALTH_IMPORT_MAX_BYTES },
    async (request, reply): Promise<HealthImportResult | void> => {
      let parsed;
      try {
        parsed = parseHealthExport(request.body);
      } catch (error) {
        if (error instanceof ParseError) return reply.code(400).send({ error: "not_health_export" });
        throw error;
      }
      const data = parsed.value;
      if (parsed.warnings.length) request.log.warn({ warnings: parsed.warnings }, "Health Auto Export import warnings");
      if (isEmptyExport(data)) return reply.code(422).send({ error: "no_data" });

      const commit = request.query.commit === "true";
      const counts = commit ? store.save(data, "file") : store.counts(data);
      return { preview: importPreview(data, counts) };
    },
  );

  const syncStatus = (): HealthSyncStatus => {
    const token = sync!.token.current();
    const last = store.imports(100).find((i) => i.kind === "sync");
    return { enabled: token !== null, token, endpoint: sync!.endpoint, lastReceivedAt: last?.receivedAt ?? null };
  };

  // Profilo › Apple Salute › "Sincronizzazione automatica": status, new token (also turns it on), turn off
  app.get("/health/sync", async (_request, reply): Promise<HealthSyncStatus | void> => {
    if (!sync) return reply.code(404).send({ error: "sync_unavailable" });
    return syncStatus();
  });
  app.post("/health/sync/token", async (_request, reply): Promise<HealthSyncStatus | void> => {
    if (!sync) return reply.code(404).send({ error: "sync_unavailable" });
    sync.token.rotate();
    return syncStatus();
  });
  app.delete("/health/sync", async (_request, reply): Promise<HealthSyncStatus | void> => {
    if (!sync) return reply.code(404).send({ error: "sync_unavailable" });
    sync.token.disable();
    return syncStatus();
  });

  app.put("/health/settings", async (request, reply): Promise<HealthSettings | void> => {
    const result = settingsSchema.safeParse(request.body);
    if (!result.success) return reply.code(400).send({ error: "stepGoal must be an integer between 2000 and 30000" });
    store.setSettings(result.data);
    return result.data;
  });
};
