# Google sign-in setup

Intake uses "Sign in with Google" to protect the app. Only the account in `OWNER_EMAIL` is admitted. This is separate from the Nutrition MCP connection.

## Create the OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project named **Intake** (project selector → **New project**).
2. Go to **Google Auth Platform** (search "OAuth consent screen" if the menu differs) and click **Get started**:
   - App name: `Intake`; user support email: the owner's address.
   - Audience: **External**.
   - Contact email: the owner's address. Accept the policy and click **Create**.
3. **Audience** → **Test users** → **Add users** → the owner's address. Leaving the app in *Testing* status is fine and adds a second gate: only listed test users can sign in.
4. **Clients** → **Create client**:
   - Application type: **Web application**, name `Intake`.
   - **Authorized redirect URIs**: `http://localhost:3000/auth/callback` for local development, plus `https://<public-hostname>/auth/callback` for production.
   - No JavaScript origins are needed.
5. Copy the **Client ID** and **Client secret** into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then restart the server.

The requested scopes are `openid email profile`, which are non-sensitive and need no verification.

## How it works

- `/auth/google` redirects to Google with PKCE, `state` and `nonce`, stored in a signed, httpOnly cookie valid for 10 minutes.
- `/auth/callback` exchanges the code server-side, validates the ID token claims (issuer, audience, expiry, nonce, verified email) and checks the email against `OWNER_EMAIL`.
- The session is a signed, httpOnly, `SameSite=Lax` cookie valid for 30 days (`Secure` when `PUBLIC_BASE_URL` is https). Changing `SESSION_SECRET` signs everyone out.
- Owner-only API routes return `401` without a session; owner-only browser routes such as `/connect/nutrition` redirect to sign-in and come back afterwards.
