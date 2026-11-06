import type { DayView } from "@intake/shared";
import { useLogPlanned, useSkipPlanned, type User } from "../api/queries";
import { DayScreen } from "../components/DayScreen";
import { Timeline } from "../components/Timeline";
import { t } from "../lib/strings";

interface Props {
  user: User;
  onAdd: () => void;
}

/** Timeline: logged and planned meals of the selected day, with the "now" marker for today. */
export function TimelinePage({ user, onAdd }: Props) {
  return (
    <DayScreen
      user={user}
      notice={null}
      variant="timeline"
      className="timeline-page"
      title={() => t.timeline.title}
      skeleton={<div className="card skeleton" style={{ height: 320 }} aria-label={t.loading} />}
    >
      {(view, selected) => <DayTimeline view={view} selected={selected} onAdd={onAdd} />}
    </DayScreen>
  );
}

function DayTimeline({ view, selected, onAdd }: { view: DayView; selected: string; onAdd: () => void }) {
  const logPlanned = useLogPlanned(selected);
  const skipPlanned = useSkipPlanned(selected);
  const pending = logPlanned.variables && (logPlanned.isPending || logPlanned.isError) ? logPlanned.variables : null;
  return (
    <Timeline
      date={view.date}
      meals={view.meals}
      planned={view.planned}
      hasPlan={view.hasPlan}
      now={view.isToday ? view.clock.localTime : null}
      heading={false}
      onLogPlanned={(entry) => logPlanned.mutate({ date: view.date, planId: entry.planId, index: entry.index })}
      onSkipPlanned={(entry, skip) => skipPlanned.mutate({ date: view.date, planId: entry.planId, index: entry.index, skip })}
      loggingPlanned={pending ? (view.planned.find((p) => p.planId === pending.planId && p.index === pending.index) ?? null) : null}
      logFailed={logPlanned.isError}
      onOther={onAdd}
    />
  );
}
