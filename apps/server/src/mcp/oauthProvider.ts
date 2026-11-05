import { randomBytes } from "node:crypto";
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { SecretStore } from "../db/secretStore.js";

const KEYS = {
  client: "nutrition.client",
  tokens: "nutrition.tokens",
  verifier: "nutrition.codeVerifier",
  state: "nutrition.state",
  discovery: "nutrition.discovery",
} as const;

interface StoredClient {
  /** Redirect URL the client was registered with; a different PUBLIC_BASE_URL needs a new registration. */
  redirectUrl: string;
  info: OAuthClientInformationMixed;
}

/**
 * OAuth client for the Nutrition MCP server, backed by the encrypted secret store.
 *
 * The server supports dynamic client registration and PKCE, so Intake registers itself as a
 * public client on first connection. The refresh token is kept server-side and the SDK renews
 * access tokens on its own.
 */
export class NutritionOAuthProvider implements OAuthClientProvider {
  /** Set when the SDK wants the user to authorize; the connect route redirects there. */
  authorizationUrl: URL | undefined;

  constructor(
    private readonly store: SecretStore,
    private readonly redirect: string,
  ) {}

  get redirectUrl(): string {
    return this.redirect;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Intake",
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    const state = randomBytes(24).toString("base64url");
    this.store.set(KEYS.state, state);
    return state;
  }

  /** The state sent with the pending authorization request, if any. */
  pendingState(): string | undefined {
    return this.store.get<string>(KEYS.state);
  }

  clearPendingAuthorization(): void {
    this.store.delete(KEYS.state, KEYS.verifier);
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const saved = this.store.get<StoredClient>(KEYS.client);
    return saved && saved.redirectUrl === this.redirect ? saved.info : undefined;
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.store.set(KEYS.client, { redirectUrl: this.redirect, info } satisfies StoredClient);
  }

  tokens(): OAuthTokens | undefined {
    return this.store.get<OAuthTokens>(KEYS.tokens);
  }

  saveTokens(tokens: OAuthTokens): void {
    this.store.set(KEYS.tokens, tokens);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.store.set(KEYS.verifier, codeVerifier);
  }

  codeVerifier(): string {
    const verifier = this.store.get<string>(KEYS.verifier);
    if (!verifier) throw new Error("No pending Nutrition authorization (missing PKCE code verifier)");
    return verifier;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.store.set(KEYS.discovery, state);
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.store.get<OAuthDiscoveryState>(KEYS.discovery);
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    switch (scope) {
      case "all":
        this.store.delete(...Object.values(KEYS));
        break;
      case "client":
        this.store.delete(KEYS.client);
        break;
      case "tokens":
        this.store.delete(KEYS.tokens);
        break;
      case "verifier":
        this.store.delete(KEYS.verifier);
        break;
      case "discovery":
        this.store.delete(KEYS.discovery);
        break;
    }
  }
}
