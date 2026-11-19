import type { FeaturesResponse } from "@intake/shared";
import { useState } from "react";
import { useSetFeatures } from "../api/queries";
import { t } from "../lib/strings";

type Choice = "nutrition" | "training" | "all";
const CHOICES: Choice[] = ["nutrition", "training", "all"];

/** The choice preselected when the setup is run again from Profilo. */
function choiceOf(features: FeaturesResponse): Choice {
  return features.health ? "all" : features.training ? "training" : "nutrition";
}

/**
 * First-run setup (docs/features.md): which optional parts to use. Step 1 picks Solo alimentazione, Alimentazione e
 * allenamenti or Tutto; step 2 says what each chosen part still needs and asks about the reminders.
 */
export function SetupPage({ features }: { features: FeaturesResponse }) {
  const s = t.setup;
  const save = useSetFeatures();
  const [step, setStep] = useState<1 | 2>(1);
  const [choice, setChoice] = useState<Choice>(() => choiceOf(features));
  const [reminders, setReminders] = useState(features.setupDone ? features.reminders : true);
  const training = choice !== "nutrition";
  const health = choice === "all";
  const apps = [features.gymApps.hevy && "Hevy", features.gymApps.opengym && "openGym"].filter(Boolean).join(" · ");

  return (
    <div className="page focus-page setup-page">
      <p className="eyebrow">{s.step(step)}</p>
      {step === 1 ? (
        <>
          <h1 className="focus-title">{s.title}</h1>
          <p className="focus-body">{s.body}</p>
          <div className="setup-choices" role="radiogroup" aria-label={s.choiceAria}>
            {CHOICES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={choice === c} className="card setup-choice" onClick={() => setChoice(c)}>
                <span className="setup-radio" aria-hidden="true" />
                <span className="connection-text">
                  <strong>{s.choices[c].title}</strong>
                  <span className="muted">{s.choices[c].note}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="focus-spacer" />
          <button type="button" className="button-primary" onClick={() => setStep(2)}>
            {s.next}
          </button>
        </>
      ) : (
        <>
          <h1 className="focus-title">{s.detailsTitle}</h1>
          <p className="focus-body">{s.detailsBody}</p>
          <section className="card profile-list setup-details">
            {training && (
              <div className="profile-row-item">
                <span className="connection-text">
                  <strong>{s.trainingTitle}</strong>
                  <span className="muted">{apps ? s.gymReady(apps) : s.gymMissing}</span>
                </span>
              </div>
            )}
            {health && (
              <div className="profile-row-item">
                <span className="connection-text">
                  <strong>{s.healthTitle}</strong>
                  <span className="muted">{s.healthNote}</span>
                </span>
              </div>
            )}
            <label className="profile-row-item setup-switch-row">
              <span className="connection-text">
                <strong>{s.remindersTitle}</strong>
                <span className="muted">{s.remindersNote}</span>
              </span>
              <input type="checkbox" role="switch" className="switch" checked={reminders} onChange={(event) => setReminders(event.target.checked)} />
            </label>
          </section>
          {save.isError && <p className="notice" data-kind="error">{s.failed}</p>}
          <div className="focus-spacer" />
          <div className="setup-actions">
            <button type="button" className="button-secondary" onClick={() => setStep(1)}>
              {s.back}
            </button>
            <button
              type="button"
              className="button-primary-inline"
              disabled={save.isPending}
              onClick={() => save.mutate({ setupDone: true, training, health, reminders })}
            >
              {s.start}
            </button>
          </div>
          <p className="focus-footnote">{s.footnote}</p>
        </>
      )}
    </div>
  );
}
