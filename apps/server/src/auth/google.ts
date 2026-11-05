import { createHash, randomBytes } from "node:crypto";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

/** Values kept in a short-lived cookie between the redirect to Google and the callback. */
export interface LoginTransaction {
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
}

export interface GoogleSignInPort {
  createLogin(returnTo: string): { url: URL; transaction: LoginTransaction };
  completeLogin(code: string, transaction: LoginTransaction): Promise<GoogleIdentity>;
}

export interface GoogleSignInOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

const random = () => randomBytes(32).toString("base64url");

/**
 * "Sign in with Google" using the OpenID Connect authorization code flow with PKCE and a nonce.
 *
 * The ID token comes straight from Google's token endpoint over TLS, authenticated with the
 * client secret, so its claims are validated (issuer, audience, expiry, nonce, verified email)
 * without fetching Google's signing keys (OpenID Connect Core, section 3.1.3.7).
 */
export class GoogleSignIn implements GoogleSignInPort {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: GoogleSignInOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
  }

  createLogin(returnTo: string): { url: URL; transaction: LoginTransaction } {
    const transaction: LoginTransaction = { state: random(), codeVerifier: random(), nonce: random(), returnTo };
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: createHash("sha256").update(transaction.codeVerifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return { url, transaction };
  }

  async completeLogin(code: string, transaction: LoginTransaction): Promise<GoogleIdentity> {
    const response = await this.fetchFn(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        redirect_uri: this.options.redirectUri,
        grant_type: "authorization_code",
        code_verifier: transaction.codeVerifier,
      }),
    });
    if (!response.ok) {
      throw new Error(`Google token exchange failed with status ${response.status}`);
    }
    const body = (await response.json()) as { id_token?: unknown };
    if (typeof body.id_token !== "string") throw new Error("Google response has no ID token");
    return this.validateIdToken(body.id_token, transaction.nonce);
  }

  private validateIdToken(idToken: string, nonce: string): GoogleIdentity {
    const payload = idToken.split(".")[1];
    if (!payload) throw new Error("Malformed ID token");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;

    if (!ISSUERS.has(String(claims.iss))) throw new Error("ID token has an unexpected issuer");
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audience.includes(this.options.clientId)) throw new Error("ID token was issued for another client");
    if (typeof claims.exp !== "number" || claims.exp * 1000 < this.now()) throw new Error("ID token has expired");
    if (claims.nonce !== nonce) throw new Error("ID token nonce mismatch");
    if (claims.email_verified !== true || typeof claims.email !== "string") throw new Error("Google account email is not verified");
    if (typeof claims.sub !== "string") throw new Error("ID token has no subject");

    return {
      sub: claims.sub,
      email: claims.email.toLowerCase(),
      name: typeof claims.name === "string" ? claims.name : null,
      picture: typeof claims.picture === "string" ? claims.picture : null,
    };
  }
}
