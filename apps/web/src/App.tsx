import "@fontsource-variable/manrope";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Route, Switch } from "wouter";
import { useMe } from "./api/queries";
import { AddSheet } from "./components/AddSheet";
import { AppShell } from "./components/AppShell";
import { TrainingIcon } from "./components/icons";
import { t } from "./lib/strings";
import { ComingSoonPage } from "./pages/ComingSoonPage";
import { EditMealPage } from "./pages/EditMealPage";
import { MealPage } from "./pages/MealPage";
import { PlanPage } from "./pages/PlanPage";
import { WeekPage } from "./pages/WeekPage";
import { SignInPage } from "./pages/SignInPage";
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
    window.history.replaceState(window.history.state, "", url);
  }, [notice]);
  return notice;
}

function Root() {
  const me = useMe();
  const notice = useRedirectNotice();
  const [adding, setAdding] = useState(false);
  const openAdd = useCallback(() => setAdding(true), []);
  const closeAdd = useCallback(() => setAdding(false), []);

  if (me.isPending) return <div className="page" aria-busy="true" />;
  if (!me.data) return <SignInPage notice={notice} />;

  return (
    <AppShell user={me.data} onAdd={openAdd}>
      <Switch>
        <Route path="/settimana">
          <WeekPage />
        </Route>
        <Route path="/pasto/:date/:id/modifica">{(params) => <EditMealPage date={params.date} id={params.id} />}</Route>
        <Route path="/pasto/:date/:id">{(params) => <MealPage date={params.date} id={params.id} />}</Route>
        <Route path="/piano">
          <PlanPage />
        </Route>
        <Route path="/allenamenti">
          <ComingSoonPage title={t.training.title} heading={t.training.soon} body={t.training.body} Icon={TrainingIcon} />
        </Route>
        <Route>
          <TodayPage user={me.data} notice={notice} onAdd={openAdd} />
        </Route>
      </Switch>
      {adding && <AddSheet onClose={closeAdd} />}
    </AppShell>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  );
}
