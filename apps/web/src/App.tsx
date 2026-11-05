import { useEffect, useState } from "react";

interface User {
  email: string;
  name: string | null;
  picture: string | null;
}

type AuthState = { status: "loading" } | { status: "signed-out" } | { status: "signed-in"; user: User };

const NOTICES: Record<string, string> = {
  "signin=denied": "This Google account is not allowed to use Intake.",
  "signin=error": "Sign-in did not complete. Please try again.",
  "nutrition=connected": "Nutrition account connected.",
  "nutrition=error": "Connecting the Nutrition account failed. Please try again.",
};

/** One-off notice from a redirect (e.g. /?signin=denied), removed from the address bar after reading. */
function useRedirectNotice(): string | null {
  const [notice] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of params) {
      const message = NOTICES[`${key}=${value}`];
      if (message) return message;
    }
    return null;
  });
  useEffect(() => {
    if (notice) window.history.replaceState(null, "", window.location.pathname);
  }, [notice]);
  return notice;
}

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [nutritionConnected, setNutritionConnected] = useState<boolean | null>(null);
  const notice = useRedirectNotice();

  useEffect(() => {
    fetch("/api/me")
      .then(async (response) => {
        if (!response.ok) return setAuth({ status: "signed-out" });
        const { user } = (await response.json()) as { user: User };
        setAuth({ status: "signed-in", user });
      })
      .catch(() => setAuth({ status: "signed-out" }));
  }, []);

  useEffect(() => {
    if (auth.status !== "signed-in") return;
    fetch("/api/nutrition/status")
      .then((response) => response.json() as Promise<{ connected: boolean }>)
      .then(({ connected }) => setNutritionConnected(connected))
      .catch(() => setNutritionConnected(null));
  }, [auth.status]);

  async function signOut() {
    await fetch("/auth/logout", { method: "POST" });
    setAuth({ status: "signed-out" });
  }

  return (
    <div className="app">
      <header className="app-header">
        <img src="/favicon.svg" alt="" width={32} height={32} />
        <h1>Intake</h1>
        {auth.status === "signed-in" && (
          <button type="button" className="button-link" onClick={signOut}>
            Sign out
          </button>
        )}
      </header>
      <main className="app-main">
        {notice && <p className="notice">{notice}</p>}

        {auth.status === "loading" && <p className="muted">Loading…</p>}

        {auth.status === "signed-out" && (
          <section className="card signin">
            <h2>Welcome</h2>
            <p className="muted">Sign in with the owner's Google account to continue.</p>
            <a className="button" href="/auth/google">
              Sign in with Google
            </a>
          </section>
        )}

        {auth.status === "signed-in" && (
          <section className="card">
            <p>Signed in as {auth.user.email}.</p>
            {nutritionConnected === true && <p className="muted">Nutrition account connected.</p>}
            {nutritionConnected === false && (
              <p>
                <a className="button" href="/connect/nutrition">
                  Connect Nutrition account
                </a>
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
