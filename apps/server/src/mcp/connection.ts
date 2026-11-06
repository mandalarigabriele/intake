import { auth, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpError, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { SecretStore } from "../db/secretStore.js";
import { NutritionOAuthProvider } from "./oauthProvider.js";

/** The Nutrition account is not connected yet, or its refresh token is no longer valid. */
export class NotConnectedError extends Error {
  constructor(message = "Nutrition account is not connected") {
    super(message);
    this.name = "NotConnectedError";
  }
}

/**
 * The Nutrition MCP server allows 60 requests per minute per account. Hitting the limit must not
 * trigger a reconnect (that costs more requests and closes calls still in flight).
 */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Nutrition rate limit exceeded; retry after ${retryAfterSeconds}s`);
    this.name = "RateLimitedError";
  }
}

const RATE_LIMITED = /rate_limited|rate limit exceeded/i;
const RETRY_AFTER = /retry after (\d+)\s*s/i;

/** The server answers an over-limit request with HTTP 429 and {"error":"rate_limited",…}. */
export function rateLimitFrom(error: unknown): RateLimitedError | null {
  if (error instanceof RateLimitedError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (!RATE_LIMITED.test(message)) return null;
  return new RateLimitedError(Number(RETRY_AFTER.exec(message)?.[1] ?? 30));
}

export interface ToolResult {
  /** All text content parts joined by newlines. */
  text: string;
  /** `structuredContent` when the tool provides it. */
  structured: unknown;
  isError: boolean;
  /** The unmodified MCP result, for fixture capture. */
  raw: unknown;
}

export type StartAuthorizationResult = { status: "redirect"; url: URL } | { status: "authorized" };

/** What the HTTP routes need from the connection; lets tests use a fake. */
export interface NutritionConnectionPort {
  isConnected(): boolean;
  startAuthorization(): Promise<StartAuthorizationResult>;
  finishAuthorization(code: string, state: string | undefined): Promise<void>;
  disconnect(): Promise<void>;
}

export interface NutritionConnectionOptions {
  serverUrl: string;
  redirectUrl: string;
  store: SecretStore;
  clientVersion?: string;
}

/**
 * Single long-lived MCP client session to the Nutrition MCP server.
 * Connects lazily, shares one connection between concurrent requests and reconnects once
 * when the session is lost.
 */
export class NutritionConnection implements NutritionConnectionPort {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(private readonly options: NutritionConnectionOptions) {}

  private provider(): NutritionOAuthProvider {
    return new NutritionOAuthProvider(this.options.store, this.options.redirectUrl);
  }

  isConnected(): boolean {
    return this.provider().tokens() !== undefined;
  }

  /** Starts the one-time OAuth flow. Returns the URL to send the owner to. */
  async startAuthorization(): Promise<StartAuthorizationResult> {
    const provider = this.provider();
    const result = await auth(provider, { serverUrl: this.options.serverUrl });
    if (result === "AUTHORIZED") return { status: "authorized" };
    if (!provider.authorizationUrl) throw new Error("Nutrition server did not return an authorization URL");
    return { status: "redirect", url: provider.authorizationUrl };
  }

  /** Completes the OAuth flow with the code from the callback and stores the tokens. */
  async finishAuthorization(code: string, state: string | undefined): Promise<void> {
    const provider = this.provider();
    const expected = provider.pendingState();
    if (!expected || state !== expected) {
      throw new Error("Nutrition authorization state mismatch");
    }
    try {
      const result = await auth(provider, { serverUrl: this.options.serverUrl, authorizationCode: code });
      if (result !== "AUTHORIZED") throw new Error("Nutrition authorization did not complete");
    } finally {
      provider.clearPendingAuthorization();
    }
    await this.reset();
  }

  async disconnect(): Promise<void> {
    await this.reset();
    this.provider().invalidateCredentials("all");
  }

  async listTools(): Promise<Tool[]> {
    return this.withClient(async (client) => {
      const tools: Tool[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : {});
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
      return tools;
    });
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    return this.withClient(async (client) => {
      const result = await client.callTool({ name, arguments: args });
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .filter((part): part is { type: "text"; text: string } => part?.type === "text")
        .map((part) => part.text)
        .join("\n");
      return { text, structured: result.structuredContent ?? null, isError: result.isError === true, raw: result };
    });
  }

  async close(): Promise<void> {
    await this.reset();
  }

  /** Runs `fn` with a connected client, reconnecting and retrying once if the session was lost. */
  private async withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const client = await this.getClient();
      try {
        return await fn(client);
      } catch (error) {
        const limited = rateLimitFrom(error);
        if (limited) throw limited;
        if (error instanceof UnauthorizedError) {
          await this.reset();
          throw new NotConnectedError("Nutrition authorization expired; reconnect the account");
        }
        // Protocol errors (invalid arguments, unknown tool…) will not go away on retry
        if (error instanceof McpError || attempt >= 2) throw error;
        await this.reset();
      }
    }
  }

  private async getClient(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.isConnected()) throw new NotConnectedError();

    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL(this.options.serverUrl), {
      authProvider: this.provider(),
    });
    const client = new Client({ name: "intake", version: this.options.clientVersion ?? "0.1.0" });
    client.onclose = () => {
      if (this.client === client) this.client = null;
    };
    try {
      await client.connect(transport);
    } catch (error) {
      if (error instanceof UnauthorizedError) throw new NotConnectedError("Nutrition authorization expired; reconnect the account");
      throw rateLimitFrom(error) ?? error;
    }
    this.client = client;
    return client;
  }

  private async reset(): Promise<void> {
    const client = this.client;
    this.client = null;
    await client?.close().catch(() => {});
  }
}
