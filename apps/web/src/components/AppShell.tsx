import { useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useNutritionStatus, type User } from "../api/queries";
import { t } from "../lib/strings";
import { trackViewportHeight } from "../lib/viewport";
import { PlanIcon, PlusIcon, TimelineIcon, TodayIcon, WeekIcon } from "./icons";
import { Logo } from "./Logo";
import { ProfileLink } from "./ProfileLink";

/** Sidebar from 800 px up (docs/design § Navigation): Andamento's two pages are listed on their own. */
const SIDEBAR = [
  { path: "/", label: t.nav.today },
  { path: "/andamento", label: t.nav.nutrition },
  { path: "/andamento/salute", label: t.nav.health },
  { path: "/piano", label: t.nav.plan },
  { path: "/timeline", label: t.nav.timeline },
] as const;

/** Tab bar on phones: the round "+" sits in the middle slot. */
const TABS = [
  { path: "/", label: t.nav.today, Icon: TodayIcon },
  { path: "/andamento", label: t.nav.trends, Icon: WeekIcon },
  "+",
  { path: "/piano", label: t.nav.plan, Icon: PlanIcon },
  { path: "/timeline", label: t.nav.timeline, Icon: TimelineIcon },
] as const;

/** The section a location belongs to: meal screens sit under Timeline, Andamento covers its sub-pages. */
function sectionOf(location: string): string {
  if (location.startsWith("/pasto/")) return "/timeline";
  if (location.startsWith("/andamento")) return "/andamento";
  return location;
}

interface Props {
  user: User;
  onAdd: () => void;
  children: ReactNode;
}

/**
 * Navigation frame: a sticky sidebar from 800 px up, a fixed bottom tab bar below.
 * The sidebar also holds "+ Aggiungi" and the profile menu.
 */
export function AppShell({ user, onAdd, children }: Props) {
  const [location] = useLocation();
  const status = useNutritionStatus(true);

  // Meal detail, edit, Profilo and Apple Salute are pushed screens without the bottom tab bar (docs/design)
  const pushed = location.startsWith("/pasto/") || location.startsWith("/profilo");
  const section = sectionOf(location);
  const main = useRef<HTMLElement>(null);

  // The content area is the scroll container: start each screen at the top
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [location]);

  // Size the layout to the visible height (iOS Safari gets it wrong after a rotation)
  useEffect(() => trackViewportHeight(), []);

  return (
    <div className="shell" data-pushed={pushed || undefined}>
      <nav className="sidebar" aria-label={t.nav.label}>
        <div className="sidebar-brand">
          <Logo size={30} />
          <span>{t.appName}</span>
        </div>
        {SIDEBAR.map(({ path, label }) => (
          <Link key={path} href={path} className="sidebar-link" aria-current={(path.startsWith("/andamento") ? location === path : section === path) ? "page" : undefined}>
            {label}
          </Link>
        ))}
        <button type="button" className="sidebar-add" onClick={onAdd}>
          {t.nav.addButton}
        </button>
        <div className="sidebar-spacer" />
        {status.data?.connected && <span className="sidebar-status">{t.nav.nutritionConnected}</span>}
        <ProfileLink user={user} variant="row" />
      </nav>

      <main className="shell-main" ref={main}>
        {children}
      </main>

      <nav className="tabbar" aria-label={t.nav.label}>
        {TABS.map((slot) => {
          if (slot === "+") {
            return (
              <button key="add" type="button" className="tab-add" aria-label={t.nav.add} onClick={onAdd}>
                <PlusIcon size={24} strokeWidth={2.5} />
              </button>
            );
          }
          const { path, label, Icon } = slot;
          return (
            <Link key={path} href={path} className="tab" aria-current={section === path ? "page" : undefined}>
              <Icon />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
