import "@fontsource-variable/manrope";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Redirect, Route, Switch } from "wouter";
import { retryDelay, shouldRetry } from "./api/client";
import { useFeatures, useMe, useNutritionStatus, type User } from "./api/queries";
import { AddSheet } from "./components/AddSheet";
import { AppShell } from "./components/AppShell";
import { t } from "./lib/strings";
import { EditMealPage } from "./pages/EditMealPage";
import { HealthPage } from "./pages/HealthPage";
import { HealthTrendsPage } from "./pages/HealthTrendsPage";
import { MealPage } from "./pages/MealPage";
import { PlanPage } from "./pages/PlanPage";
import { ProfilePage } from "./pages/ProfilePage";
import { WeekPage } from "./pages/WeekPage";
import { SetupPage } from "./pages/SetupPage";
import { SignInPage } from "./pages/SignInPage";
import { TimelinePage } from "./pages/TimelinePage";
import { TodayPage } from "./pages/TodayPage";
import { TrainingPage } from "./pages/TrainingPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 30_000, retry: shouldRetry, retryDelay } },
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
  return <SignedIn user={me.data} notice={notice} adding={adding} openAdd={openAdd} closeAdd={closeAdd} />;
}

interface SignedInProps {
  user: User;
  notice: string | null;
  adding: boolean;
  openAdd: () => void;
  closeAdd: () => void;
}

/**
 * The app once signed in. After the Nutrition connection a new installation first runs the setup (docs/features.md);
 * pages of the optional parts that are off go back to Oggi.
 */
function SignedIn({ user, notice, adding, openAdd, closeAdd }: SignedInProps) {
  const features = useFeatures();
  const nutrition = useNutritionStatus(true);
  if (features.isPending) return <div className="page" aria-busy="true" />;
  const on = features.data;
  if (on && !on.setupDone && nutrition.data?.connected) return <SetupPage features={on} />;
  const home = <Redirect to="/" replace />;

  return (
    <AppShell user={user} onAdd={openAdd}>
      <Switch>
        <Route path="/andamento/allenamenti">{on?.training ? <TrainingPage /> : home}</Route>
        <Route path="/andamento/salute">{on?.health ? <HealthTrendsPage /> : home}</Route>
        <Route path="/andamento">
          <WeekPage />
        </Route>
        {/* Old addresses, still in sent notifications and home-screen history */}
        <Route path="/settimana">
          <Redirect to="/andamento" replace />
        </Route>
        <Route path="/salute">
          <Redirect to="/profilo/salute" replace />
        </Route>
        <Route path="/pasto/:date/:id/modifica">{(params) => <EditMealPage date={params.date} id={params.id} />}</Route>
        <Route path="/pasto/:date/:id">{(params) => <MealPage date={params.date} id={params.id} />}</Route>
        <Route path="/profilo/salute">{on?.health ? <HealthPage /> : home}</Route>
        <Route path="/profilo">
          <ProfilePage user={user} />
        </Route>
        <Route path="/piano">
          <PlanPage />
        </Route>
        <Route path="/timeline">
          <TimelinePage user={user} onAdd={openAdd} />
        </Route>
        <Route>
          <TodayPage user={user} notice={notice} onAdd={openAdd} />
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
