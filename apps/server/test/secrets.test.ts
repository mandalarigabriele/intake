import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { SecretBox } from "../src/db/secretBox.js";
import { SecretStore } from "../src/db/secretStore.js";
import { NutritionConnection } from "../src/mcp/connection.js";
import { NutritionOAuthProvider } from "../src/mcp/oauthProvider.js";

const KEY = "k".repeat(32);

describe("SecretBox", () => {
  it("round-trips and does not store plaintext", () => {
    const box = new SecretBox(KEY);
    const sealed = box.seal("refresh-token-123");
    expect(sealed).not.toContain("refresh-token-123");
    expect(box.open(sealed)).toBe("refresh-token-123");
  });

  it("uses a fresh IV for every value", () => {
    const box = new SecretBox(KEY);
    expect(box.seal("same")).not.toBe(box.seal("same"));
  });

  it("rejects a value sealed with another key or tampered with", () => {
    const sealed = new SecretBox(KEY).seal("secret");
    expect(() => new SecretBox("x".repeat(32)).open(sealed)).toThrow();
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
    expect(() => new SecretBox(KEY).open(tampered)).toThrow();
  });
});

describe("SecretStore", () => {
  it("stores JSON values encrypted", () => {
    const db = openDatabase(":memory:");
    const store = new SecretStore(db, new SecretBox(KEY));
    store.set("tokens", { refresh_token: "abc" });
    expect(store.get("tokens")).toEqual({ refresh_token: "abc" });

    const raw = db.prepare("SELECT value FROM secrets WHERE key = 'tokens'").get() as { value: string };
    expect(raw.value).not.toContain("abc");

    store.delete("tokens");
    expect(store.get("tokens")).toBeUndefined();
  });

  it("treats values sealed with a previous key as missing", () => {
    const db = openDatabase(":memory:");
    new SecretStore(db, new SecretBox(KEY)).set("tokens", { refresh_token: "abc" });
    expect(new SecretStore(db, new SecretBox("x".repeat(32))).get("tokens")).toBeUndefined();
  });
});

describe("NutritionOAuthProvider", () => {
  const newStore = () => new SecretStore(openDatabase(":memory:"), new SecretBox(KEY));

  it("discards a client registered with a different redirect URL", () => {
    const store = newStore();
    new NutritionOAuthProvider(store, "http://localhost:3000/connect/nutrition/callback").saveClientInformation({
      client_id: "dev-client",
    });
    expect(new NutritionOAuthProvider(store, "http://localhost:3000/connect/nutrition/callback").clientInformation()).toEqual({
      client_id: "dev-client",
    });
    expect(new NutritionOAuthProvider(store, "https://intake.example.com/connect/nutrition/callback").clientInformation()).toBeUndefined();
  });

  it("registers as a public client with the refresh token grant", () => {
    const provider = new NutritionOAuthProvider(newStore(), "https://intake.example.com/connect/nutrition/callback");
    expect(provider.clientMetadata).toMatchObject({
      redirect_uris: ["https://intake.example.com/connect/nutrition/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
    });
  });

  it("persists state and verifier until the authorization completes", () => {
    const store = newStore();
    const provider = new NutritionOAuthProvider(store, "http://localhost/cb");
    const state = provider.state();
    provider.saveCodeVerifier("verifier");
    const later = new NutritionOAuthProvider(store, "http://localhost/cb");
    expect(later.pendingState()).toBe(state);
    expect(later.codeVerifier()).toBe("verifier");
    later.clearPendingAuthorization();
    expect(later.pendingState()).toBeUndefined();
    expect(() => later.codeVerifier()).toThrow();
  });

  it("invalidates everything on 'all'", () => {
    const store = newStore();
    const provider = new NutritionOAuthProvider(store, "http://localhost/cb");
    provider.saveTokens({ access_token: "a", token_type: "Bearer", refresh_token: "r" });
    provider.saveClientInformation({ client_id: "c" });
    provider.invalidateCredentials("all");
    expect(provider.tokens()).toBeUndefined();
    expect(provider.clientInformation()).toBeUndefined();
  });
});

describe("NutritionConnection", () => {
  const connection = () =>
    new NutritionConnection({
      serverUrl: "https://nutrition.invalid/mcp",
      redirectUrl: "http://localhost/cb",
      store: new SecretStore(openDatabase(":memory:"), new SecretBox(KEY)),
    });

  it("is not connected without tokens and refuses tool calls", async () => {
    const conn = connection();
    expect(conn.isConnected()).toBe(false);
    await expect(conn.callTool("get_current_time")).rejects.toThrow("not connected");
  });

  it("rejects a callback whose state does not match the pending authorization", async () => {
    await expect(connection().finishAuthorization("code", "forged")).rejects.toThrow("state mismatch");
  });
});
