import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useNutritionStatus, type User } from "../api/queries";
import { t } from "../lib/strings";
import { PlanIcon, TodayIcon, TrainingIcon, WeekIcon } from "./icons";
import { Logo } from "./Logo";
import { ProfileMenu } from "./ProfileMenu";

export const SECTIONS = [
  { path: "/", label: t.nav.today, Icon: TodayIcon },
  { path: "/settimana", label: t.nav.week, Icon: WeekIcon },
  { path: "/piano", label: t.nav.plan, Icon: PlanIcon },
  { path: "/allenamenti", label: t.nav.training, Icon: TrainingIcon },
] as const;

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

  // Meal detail and edit are pushed screens without the bottom tab bar (docs/design)
  const pushed = location.startsWith("/pasto/");

  return (
    <div className="shell" data-pushed={pushed || undefined}>
      <nav className="sidebar" aria-label={t.nav.label}>
        <div className="sidebar-brand">
          <Logo size={30} />
          <span>{t.appName}</span>
        </div>
        {SECTIONS.map(({ path, label }) => (
          <Link key={path} href={path} className="sidebar-link" aria-current={location === path || (path === "/" && pushed) ? "page" : undefined}>
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

      <main className="shell-main">{children}</main>

      <nav className="tabbar" aria-label={t.nav.label}>
        {SECTIONS.map(({ path, label, Icon }) => (
          <Link key={path} href={path} className="tab" aria-current={location === path ? "page" : undefined}>
            <Icon />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
