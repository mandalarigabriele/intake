import { Link } from "wouter";
import { useFeatures } from "../api/queries";
import { t } from "../lib/strings";

/**
 * Andamento on phones: "Alimentazione | Salute | Allenamenti" under the title (docs/design § Navigation update).
 * Only the parts that are on are listed, and the switch is left out when Alimentazione is the only one
 * (docs/features.md). From 800 px the sidebar lists the pages, so the switch is hidden there.
 */
export function TrendsSwitch({ current }: { current: "nutrition" | "health" | "training" }) {
  const features = useFeatures().data;
  const options = [
    { key: "nutrition", href: "/andamento", label: t.nav.nutrition, on: true },
    { key: "health", href: "/andamento/salute", label: t.nav.health, on: features?.health ?? false },
    { key: "training", href: "/andamento/allenamenti", label: t.nav.training, on: features?.training ?? false },
  ].filter((o) => o.on);
  if (options.length < 2) return null;
  return (
    <nav className="trends-switch" aria-label={t.nav.trendsSwitch}>
      {options.map((o) => (
        <Link key={o.key} href={o.href} className="trends-switch-option" aria-current={current === o.key ? "page" : undefined}>
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

/** "Andamento" on phones, the page name ("Alimentazione", "Salute") where the sidebar is shown. */
export function TrendsTitle({ page }: { page: string }) {
  return (
    <h1 className="page-title">
      <span className="title-phone">{t.nav.trends}</span>
      <span className="title-wide">{page}</span>
    </h1>
  );
}
