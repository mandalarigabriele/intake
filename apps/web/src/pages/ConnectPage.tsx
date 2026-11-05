import { CheckIcon } from "../components/icons";
import { t } from "../lib/strings";

/** One-time Nutrition connection (step 2 of 2, after Google sign-in). */
export function ConnectPage() {
  return (
    <div className="page focus-page connect-page">
      <p className="eyebrow">{t.connect.step}</p>
      <h1 className="focus-title">{t.connect.title}</h1>
      <p className="focus-body">{t.connect.body}</p>

      <section className="card connect-status">
        <div className="connect-row">
          <span className="connect-badge" data-done>
            <CheckIcon size={20} strokeWidth={2.5} />
          </span>
          <span className="connect-text">
            <strong>{t.connect.google}</strong>
            <span className="muted">{t.connect.googleOk}</span>
          </span>
        </div>
        <div className="divider" />
        <div className="connect-row">
          <span className="connect-badge" />
          <span className="connect-text">
            <strong>{t.connect.nutrition}</strong>
            <span className="muted">{t.connect.nutritionPending}</span>
          </span>
        </div>
      </section>

      <ol className="connect-steps">
        {t.connect.steps.map((step, i) => (
          <li key={step}>
            <span className="connect-step-number">{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <div className="focus-spacer" />
      <a className="button-primary" href="/connect/nutrition">
        {t.connect.button}
      </a>
      <p className="focus-footnote">{t.connect.footnote}</p>
    </div>
  );
}
