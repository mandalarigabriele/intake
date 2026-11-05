import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useMe } from "./api/queries";
import { t } from "./lib/strings";
import { TodayPage } from "./pages/TodayPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 30_000 } },
});

/** One-off notice from a redirect (e.g. /?signin=denied), removed from the address bar after reading. */
function useRedirectNotice(): string | null {
  const [notice] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of params) {
      const message = t.notices[`${key}=${value}`];
      if (message) return message;
    }
    return null;
  });
  useEffect(() => {
    if (!notice) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("signin");
    url.searchParams.delete("nutrition");
    window.history.replaceState(null, "", url);
  }, [notice]);
  return notice;
}

function Root() {
  const me = useMe();
  const notice = useRedirectNotice();

  if (me.isPending) return <div className="page"><p className="muted">{t.loading}</p></div>;
  if (!me.data) return <SignInPage notice={notice} />;
  return <TodayPage user={me.data} notice={notice} />;
}

function SignInPage({ notice }: { notice: string | null }) {
  return (
    <div className="page">
      <section className="card signin">
        <img src="/favicon.svg" alt="" width={56} height={56} />
        <h1>{t.signIn.title}</h1>
        <p className="muted">{t.signIn.subtitle}</p>
        {notice && <p className="notice">{notice}</p>}
        <a className="button" href="/auth/google">
          {t.signIn.button}
        </a>
      </section>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  );
}
