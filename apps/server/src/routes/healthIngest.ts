import type { FastifyPluginAsync } from "fastify";
import type { HealthStore } from "../db/healthStore.js";
import { ParseError } from "../parsers/common.js";
import { parseHealthExport } from "../parsers/healthAutoExport.js";
import { isEmptyExport } from "../services/healthImport.js";
import type { HealthIngestToken } from "../services/healthSync.js";
import { HEALTH_IMPORT_MAX_BYTES } from "./appleHealth.js";

export interface HealthIngestRoutesOptions {
  store: Pick<HealthStore, "save">;
  token: Pick<HealthIngestToken, "verify">;
}

/**
 * POST /api/health/ingest: automatic uploads from Health Auto Export ("REST API" automation).
 * Outside Google sign-in, protected by the token instead; the body is never logged.
 */
export const healthIngestRoutes: FastifyPluginAsync<HealthIngestRoutesOptions> = async (app, { store, token }) => {
  app.post("/health/ingest", { bodyLimit: HEALTH_IMPORT_MAX_BYTES }, async (request, reply) => {
    if (!token.verify(request.headers.authorization)) return reply.code(401).send({ error: "invalid_token" });
    let parsed;
    try {
      parsed = parseHealthExport(request.body);
    } catch (error) {
      if (error instanceof ParseError) return reply.code(400).send({ error: "not_health_export" });
      throw error;
    }
    if (parsed.warnings.length) request.log.warn({ warnings: parsed.warnings }, "Health Auto Export ingest warnings");
    // An upload with nothing we keep (e.g. only ignored metrics) is accepted, so the automation does not retry it
    if (isEmptyExport(parsed.value)) return reply.code(200).send({ ok: true, saved: false });
    const counts = store.save(parsed.value, "sync");
    return { ok: true, saved: true, counts };
  });
};
