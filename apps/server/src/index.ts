import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { GoogleSignIn } from "./auth/google.js";
import { loadConfig } from "./config.js";
import { HevyApi } from "./hevy/hevyApi.js";
import { HealthIngestToken } from "./services/healthSync.js";
import { NutritionApi } from "./mcp/nutritionApi.js";
import { createServices } from "./services.js";
import { ReminderScheduler } from "./services/reminderScheduler.js";
import { WebPushSender, vapidKeys } from "./services/webPush.js";

const config = loadConfig();
const services = createServices(config);
const api = new NutritionApi(services.nutrition, (tool, warnings) => {
  app.log.warn({ tool, warnings }, "Unrecognized content in Nutrition MCP response");
});

// Reminders: VAPID keys are generated once and kept encrypted next to the Nutrition token
const vapid = vapidKeys(services.secrets);
const scheduler = new ReminderScheduler({
  store: services.reminders,
  plans: services.plans,
  api,
  sender: new WebPushSender(vapid, config.PUBLIC_BASE_URL),
  log: { warn: (details, message) => app.log.warn(details, message), info: (details, message) => app.log.info(details, message) },
});

const healthToken = new HealthIngestToken(services.secrets);
const app = await buildApp({
  webDistDir: config.WEB_DIST_DIR ?? resolve(import.meta.dirname, "../../web/dist"),
  logger: true,
  auth: {
    google: new GoogleSignIn({
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      redirectUri: `${config.PUBLIC_BASE_URL}/auth/callback`,
    }),
    ownerEmail: config.OWNER_EMAIL,
    sessionSecret: config.SESSION_SECRET,
    secureCookies: config.PUBLIC_BASE_URL.startsWith("https://"),
  },
  nutrition: services.nutrition,
  api,
  mealsApi: api,
  weekApi: api,
  profile: { api, hevyConfigured: Boolean(config.HEVY_API_KEY) },
  insightApi: api,
  insightHealth: services.health,
  plans: services.plans,
  push: { store: services.reminders, scheduler, publicKey: vapid.publicKey },
  workouts: { hevy: config.HEVY_API_KEY ? new HevyApi(config.HEVY_API_KEY) : null, health: services.health, api },
  appleHealth: { store: services.health, api, sync: { token: healthToken, endpoint: `${config.PUBLIC_BASE_URL}/api/health/ingest` } },
  healthIngest: { store: services.health, token: healthToken },
});

app.addHook("onClose", async () => {
  scheduler.stop();
  await services.close();
});

const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down`);
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: "0.0.0.0", port: config.PORT });
scheduler.start();
app.log.info(`Nutrition account ${services.nutrition.isConnected() ? "connected" : "not connected yet: open /connect/nutrition"}`);
