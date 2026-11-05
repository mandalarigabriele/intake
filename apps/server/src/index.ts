import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { GoogleSignIn } from "./auth/google.js";
import { loadConfig } from "./config.js";
import { NutritionApi } from "./mcp/nutritionApi.js";
import { createServices } from "./services.js";

const config = loadConfig();
const services = createServices(config);
const api = new NutritionApi(services.nutrition, (tool, warnings) => {
  app.log.warn({ tool, warnings }, "Unrecognized content in Nutrition MCP response");
});

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
  plans: services.plans,
});

app.addHook("onClose", async () => {
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
app.log.info(`Nutrition account ${services.nutrition.isConnected() ? "connected" : "not connected yet: open /connect/nutrition"}`);
