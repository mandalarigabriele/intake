import { join, resolve } from "node:path";
import { buildApp } from "./app.js";
import { GoogleSignIn } from "./auth/google.js";
import { loadConfig } from "./config.js";
import { HevyApi } from "./hevy/hevyApi.js";
import { HealthIngestToken } from "./services/healthSync.js";
import { OpenGymApi } from "./opengym/openGymApi.js";
import { GymSources, hevySource, openGymSource } from "./services/gymSource.js";
import { NutritionApi } from "./mcp/nutritionApi.js";
import { createServices } from "./services.js";
import { healthWhenOn } from "./db/featureStore.js";
import { ReminderScheduler } from "./services/reminderScheduler.js";
import { HevySync } from "./services/hevySync.js";
import { NutritionBackups } from "./services/nutritionBackups.js";
import { MealRecognizer } from "./services/mealRecognition.js";
import { NeedsAdvisor } from "./services/needsAdvisor.js";
import { PlanGenerator } from "./services/planGenerator.js";
import { WebPushSender, vapidKeys } from "./services/webPush.js";

const config = loadConfig();
const services = createServices(config);
const api = new NutritionApi(services.nutrition, (tool, warnings) => {
  app.log.warn({ tool, warnings }, "Unrecognized content in Nutrition MCP response");
});

// Reminders: VAPID keys are generated once and kept encrypted next to the Nutrition token
const vapid = vapidKeys(services.secrets);
// Optional parts (docs/features.md): an installation from before the switches keeps what it already uses
const features = services.features;
features.adoptExisting({ gymConfigured: Boolean(config.HEVY_API_KEY || (config.OPENGYM_URL && config.OPENGYM_TOKEN)) });
const health = healthWhenOn(services.health, features);
const scheduler = new ReminderScheduler({
  store: services.reminders,
  plans: services.plans,
  api,
  sender: new WebPushSender(vapid, config.PUBLIC_BASE_URL),
  enabled: () => features.enabled("reminders"),
  language: () => services.language.get(),
  waterEnabled: () => features.enabled("water"),
  log: { warn: (details, message) => app.log.warn(details, message), info: (details, message) => app.log.info(details, message) },
});

// Daily backup of everything in Nutrition, saved as the original ZIP in the data volume (docs/backups.md)
const backups = new NutritionBackups({
  dir: join(config.DATA_DIR, "backups", "nutrition"),
  api,
  store: services.backups,
  log: { warn: (details, message) => app.log.warn(details, message), info: (details, message) => app.log.info(details, message) },
});

const healthToken = new HealthIngestToken(services.secrets);
// One client per gym app, so the workouts and training views share their caches; one source is active at a time
const hevy = config.HEVY_API_KEY ? new HevyApi(config.HEVY_API_KEY) : null;
const openGym = config.OPENGYM_URL && config.OPENGYM_TOKEN ? new OpenGymApi(config.OPENGYM_URL, config.OPENGYM_TOKEN) : null;
const gymSources = new GymSources(services.db, {
  ...(hevy ? { hevy: hevySource(hevy) } : {}),
  ...(openGym ? { opengym: openGymSource(openGym, config.OPENGYM_PUBLIC_URL ?? config.OPENGYM_URL!) } : {}),
});
const gym = () => gymSources.active();
// Optional copy of openGym workouts into Hevy, off until turned on in Profile (docs/hevy-sync.md)
const hevySync =
  hevy && openGym
    ? new HevySync({
        store: services.hevySync,
        hevy,
        openGym,
        enabled: () => features.enabled("training"),
        log: { warn: (details, message) => app.log.warn(details, message), info: (details, message) => app.log.info(details, message) },
      })
    : null;
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
  mealPhotos: services.mealPhotos,
  recognitionModel: services.recognitionModel,
  recognizer: config.ANTHROPIC_API_KEY
    ? new MealRecognizer({
        apiKey: config.ANTHROPIC_API_KEY,
        model: () => services.recognitionModel.get(),
        language: () => services.language.get(),
        // Token usage of each recognition, to read the real cost; never the photo, the text or the key
        log: { info: (details, message) => app.log.info(details, message), warn: (details, message) => app.log.warn(details, message) },
      })
    : undefined,
  needs: {
    api,
    store: services.needs,
    health,
    gym: () => (features.enabled("training") ? gym() : null),
    // Same model as the meal recognition; only token usage is logged
    advisor: config.ANTHROPIC_API_KEY
      ? new NeedsAdvisor({
          apiKey: config.ANTHROPIC_API_KEY,
          model: () => services.recognitionModel.get(),
          language: () => services.language.get(),
          log: { info: (details, message) => app.log.info(details, message), warn: (details, message) => app.log.warn(details, message) },
        })
      : undefined,
    aiEnabled: () => features.enabled("photoMeals"),
  },
  // "Genera con l'IA" in Piano: its own model (Impostazioni › Modello per i piani), only token usage is logged
  planGeneration: {
    api,
    plans: services.plans,
    store: services.planGeneration,
    needs: services.needs,
    generator: config.ANTHROPIC_API_KEY
      ? new PlanGenerator({
          apiKey: config.ANTHROPIC_API_KEY,
          model: () => services.planGeneration.get().model,
          language: () => services.language.get(),
          log: { info: (details, message) => app.log.info(details, message), warn: (details, message) => app.log.warn(details, message) },
        })
      : undefined,
  },
  weekApi: api,
  weekHealth: health,
  profile: { api, hevyConfigured: Boolean(config.HEVY_API_KEY) },
  insightApi: api,
  insightHealth: health,
  plans: services.plans,
  push: { store: services.reminders, scheduler, publicKey: vapid.publicKey },
  // With Allenamenti off the workouts list keeps only the Apple Health sessions
  workouts: { gym: () => (features.enabled("training") ? gym() : null), health, api },
  training: { gym, sources: gymSources, health, api },
  hevySync: { sync: hevySync, store: services.hevySync },
  appleHealth: { store: services.health, api, sync: { token: healthToken, endpoint: `${config.PUBLIC_BASE_URL}/api/health/ingest` } },
  healthIngest: { store: services.health, token: healthToken },
  language: services.language,
  backups: { backups },
  features: { features, gymApps: { hevy: Boolean(hevy), opengym: Boolean(openGym) }, recognition: Boolean(config.ANTHROPIC_API_KEY) },
});

app.addHook("onClose", async () => {
  scheduler.stop();
  hevySync?.stop();
  backups.stop();
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
hevySync?.start();
backups.start();
app.log.info(`Nutrition account ${services.nutrition.isConnected() ? "connected" : "not connected yet: open /connect/nutrition"}`);
