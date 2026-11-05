import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "./config.js";
import { openDatabase } from "./db/database.js";
import { SecretBox } from "./db/secretBox.js";
import { SecretStore } from "./db/secretStore.js";
import { NutritionConnection } from "./mcp/connection.js";

export interface Services {
  db: DatabaseSync;
  secrets: SecretStore;
  nutrition: NutritionConnection;
  close(): Promise<void>;
}

/** Creates the long-lived services shared by the server and the CLI scripts. */
export function createServices(config: Config): Services {
  const db = openDatabase(join(config.DATA_DIR, "intake.db"));
  const secrets = new SecretStore(db, new SecretBox(config.TOKEN_ENCRYPTION_KEY));
  const nutrition = new NutritionConnection({
    serverUrl: config.NUTRITION_MCP_URL,
    redirectUrl: `${config.PUBLIC_BASE_URL}/connect/nutrition/callback`,
    store: secrets,
  });

  return {
    db,
    secrets,
    nutrition,
    async close() {
      await nutrition.close();
      db.close();
    },
  };
}
