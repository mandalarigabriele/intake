import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createServices } from "./services.js";

const config = loadConfig();
const services = createServices(config);

const app = await buildApp({
  webDistDir: config.WEB_DIST_DIR ?? resolve(import.meta.dirname, "../../web/dist"),
  logger: true,
  isProduction: config.NODE_ENV === "production",
  nutrition: services.nutrition,
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
