import type { Workout, WorkoutExercise } from "@intake/shared";
import { formatGrams, formatKcal } from "../lib/format";
import { t } from "../lib/strings";

/** "57 min", "1 h 5 min". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

function exerciseNote(exercise: WorkoutExercise): string {
  const parts = [t.workouts.sets(exercise.workingSets)];
  if (exercise.best) parts.push(t.workouts.best(formatGrams(exercise.best.weightKg), exercise.best.reps));
  else if (exercise.durationSeconds > 0) parts.push(formatDuration(Math.max(1, Math.round(exercise.durationSeconds / 60))));
  return parts.join(" · ");
}

/** A Hevy workout in the day timeline: title, time, duration, sets, volume and exercises. */
export function WorkoutCard({ workout }: { workout: Workout }) {
  return (
    <article className="meal-card workout-card" aria-label={`${t.workouts.label} ${workout.title}`}>
      <div className="workout-head">
        <span className="workout-chip">{t.workouts.label.toUpperCase()}</span>
        <span className="muted">
          {workout.start}–{workout.end}
        </span>
      </div>
      <h3>{workout.title}</h3>
      <p className="muted workout-summary">{t.workouts.summary(formatDuration(workout.durationMinutes), workout.sets, formatKcal(workout.volumeKg))}</p>
      <ul className="workout-exercises">
        {workout.exercises.map((exercise, i) => (
          <li key={i}>
            <span>{exercise.title}</span>
            <span className="muted">{exerciseNote(exercise)}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

/** Settimana: the week's workouts with sessions, total time and volume. */
export function WeekWorkoutsCard({ workouts, failed }: { workouts: Workout[]; failed: boolean }) {
  const minutes = workouts.reduce((sum, w) => sum + w.durationMinutes, 0);
  const volume = workouts.reduce((sum, w) => sum + w.volumeKg, 0);
  return (
    <section className="card consistency-card" aria-label={t.workouts.weekTitle}>
      <div className="plan-compare-head">
        <h2>{t.workouts.weekTitle}</h2>
        {workouts.length > 0 && <span className="muted">{t.workouts.weekSummary(workouts.length, formatDuration(minutes), formatKcal(volume))}</span>}
      </div>
      {failed && <p className="muted workout-empty">{t.workouts.failed}</p>}
      {!failed && workouts.length === 0 && <p className="muted workout-empty">{t.workouts.none}</p>}
      {workouts.map((workout) => (
        <div key={workout.id} className="consistency-row">
          <div>
            <strong>{workout.title}</strong>
            <span className="muted">{t.workouts.weekRow(workout.date, workout.start, formatDuration(workout.durationMinutes), workout.sets, formatKcal(workout.volumeKg))}</span>
          </div>
        </div>
      ))}
    </section>
  );
}
