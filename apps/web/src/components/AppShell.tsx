import { useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useNutritionStatus, type User } from "../api/queries";
import { t } from "../lib/strings";
import { trackViewportHeight } from "../lib/viewport";
import { PlanIcon, PlusIcon, TimelineIcon, TodayIcon, WeekIcon } from "./icons";
import { Logo } from "./Logo";
import { ProfileMenu } from "./ProfileMenu";

export const SECTIONS = [
  { path: "/", label: t.nav.today, Icon: TodayIcon },
  { path: "/settimana", label: t.nav.week, Icon: WeekIcon },
  { path: "/piano", label: t.nav.plan, Icon: PlanIcon },
  { path: "/timeline", label: t.nav.timeline, Icon: TimelineIcon },
] as const;

/** Tab bar order on phones: the round "+" sits in the middle slot (docs/design/DESIGN.md). */
const TAB_ORDER = ["/", "/settimana", "+", "/piano", "/timeline"] as const;

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

  // Meal detail, edit and Apple Salute are pushed screens without the bottom tab bar (docs/design)
  const pushed = location.startsWith("/pasto/") || location === "/salute";
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
        {SECTIONS.map(({ path, label }) => (
          <Link key={path} href={path} className="sidebar-link" aria-current={location === path || (path === "/timeline" && location.startsWith("/pasto/")) ? "page" : undefined}>
            {label}
          </Link>
        ))}
        <button type="button" className="sidebar-add" onClick={onAdd}>
          {t.nav.addButton}
        </button>
        <div className="sidebar-spacer" />
        {status.data?.connected && <span className="sidebar-status">{t.nav.nutritionConnected}</span>}
        <ProfileMenu user={user} variant="row" />
      </nav>

      <main className="shell-main" ref={main}>
        {children}
      </main>

      <nav className="tabbar" aria-label={t.nav.label}>
        {TAB_ORDER.map((slot) => {
          if (slot === "+") {
            return (
              <button key="add" type="button" className="tab-add" aria-label={t.nav.add} onClick={onAdd}>
                <PlusIcon size={24} strokeWidth={2.5} />
              </button>
            );
          }
          const { path, label, Icon } = SECTIONS.find((section) => section.path === slot)!;
          return (
            <Link key={path} href={path} className="tab" aria-current={location === path ? "page" : undefined}>
              <Icon />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
