import type { PushStatus } from "@intake/shared";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { ReminderStore } from "../db/reminderStore.js";
import type { ReminderScheduler } from "../services/reminderScheduler.js";

export interface PushRoutesOptions {
  store: ReminderStore;
  scheduler: Pick<ReminderScheduler, "sendAll">;
  publicKey: string;
  requireOwner: preHandlerHookHandler;
}

const subscriptionBody = z.object({
  endpoint: z.url().startsWith("https://").max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

const settingsBody = z.object({ meal: z.boolean(), todo: z.boolean(), water: z.boolean(), summary: z.boolean() });

/** Reminders: device subscriptions (/api/push/subscriptions), settings and a test notification. */
export const pushRoutes: FastifyPluginAsync<PushRoutesOptions> = async (app, { store, scheduler, publicKey, requireOwner }) => {
  app.addHook("preHandler", requireOwner);

  const status = (): PushStatus => ({ publicKey, devices: store.subscriptions().length, settings: store.settings() });

  app.get("/push", async () => status());

  app.post("/push/subscriptions", async (request, reply) => {
    const body = subscriptionBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid subscription" });
    store.addSubscription(body.data);
    return reply.code(201).send(status());
  });

  app.delete("/push/subscriptions", async (request, reply) => {
    const body = z.object({ endpoint: z.string().min(1).max(2000) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid subscription" });
    store.removeSubscription(body.data.endpoint);
    return status();
  });

  app.put("/push/settings", async (request, reply) => {
    const body = settingsBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid settings" });
    store.setSettings(body.data);
    return status();
  });

  app.post("/push/test", async () => {
    const sent = await scheduler.sendAll({ title: "Intake", body: "I promemoria funzionano su questo dispositivo.", url: "/", tag: "test" });
    return { sent };
  });
};
