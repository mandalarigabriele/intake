import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const valid = {
  PUBLIC_BASE_URL: "https://intake.example.com/",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  OWNER_EMAIL: "Owner@Example.com",
  SESSION_SECRET: "s".repeat(32),
  TOKEN_ENCRYPTION_KEY: "k".repeat(32),
};

describe("loadConfig", () => {
  it("applies defaults and normalizes values", () => {
    const config = loadConfig(valid);
    expect(config.PORT).toBe(3000);
    expect(config.PUBLIC_BASE_URL).toBe("https://intake.example.com");
    expect(config.OWNER_EMAIL).toBe("owner@example.com");
    expect(config.NUTRITION_MCP_URL).toBe("https://nutrition-mcp.com/mcp");
  });

  it("lists every missing or invalid variable", () => {
    expect(() => loadConfig({ ...valid, SESSION_SECRET: "short", OWNER_EMAIL: undefined })).toThrow(
      /SESSION_SECRET[\s\S]*OWNER_EMAIL|OWNER_EMAIL[\s\S]*SESSION_SECRET/,
    );
  });
});
