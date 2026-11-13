import { Link } from "wouter";
import { t } from "../lib/strings";

/**
 * Andamento on phones: "Alimentazione | Salute | Allenamenti" under the title (docs/design § Navigation update).
 * From 800 px the sidebar lists both pages, so the switch is hidden there.
 */
export function TrendsSwitch({ current }: { current: "nutrition" | "health" | "training" }) {
  return (
    <nav className="trends-switch" aria-label={t.nav.trendsSwitch}>
      <Link href="/andamento" className="trends-switch-option" aria-current={current === "nutrition" ? "page" : undefined}>
        {t.nav.nutrition}
      </Link>
      <Link href="/andamento/salute" className="trends-switch-option" aria-current={current === "health" ? "page" : undefined}>
        {t.nav.health}
      </Link>
      <Link href="/andamento/allenamenti" className="trends-switch-option" aria-current={current === "training" ? "page" : undefined}>
        {t.nav.training}
      </Link>
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
