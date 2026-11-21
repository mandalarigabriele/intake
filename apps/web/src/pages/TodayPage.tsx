import { completeHomeLayout, type DayView, type HomeCardId } from "@intake/shared";
import type { ReactNode } from "react";
import { useAddWater, useFeatures, useHomeLayout, type User } from "../api/queries";
import { ActivityCard } from "../components/ActivityCard";
import { CalorieCard } from "../components/CalorieCard";
import { DayCurve } from "../components/DayCurve";
import { ScoreRings } from "../components/ScoreRings";
import { TodayTrainingCard } from "../components/TodayTrainingCard";
import { DayScreen } from "../components/DayScreen";
import { InsightCard } from "../components/InsightCard";
import { MacroCard } from "../components/MacroCard";
import { NextMealCard } from "../components/NextMealCard";
import { DayPlanCard } from "../components/PlanCompare";
import { WaterCard } from "../components/WaterCard";
import { TimezoneNotice } from "../components/TimezoneNotice";
import { formatWeekday } from "../lib/format";
import { t } from "../lib/strings";

interface Props {
  user: User;
  notice: string | null;
  onAdd: () => void;
}

/**
 * Oggi (summary): Next meal, calories, macros, water, activity & rest and the daily insight. On wide screens the
 * left column holds calories, macros and water, the right one Next meal and the insight. The order and the hidden
 * cards come from Profilo › Personalizza home (HOME_CARDS).
 */
export function TodayPage({ user, notice, onAdd }: Props) {
  return (
    <DayScreen
      user={user}
      notice={notice}
      variant="today"
      title={(view) => (view && !view.isToday ? formatWeekday(view.date) : t.today)}
      skeleton={
        <div className="today-grid" aria-label={t.loading}>
          <div className="today-main">
            <div className="card skeleton" style={{ height: 172 }} />
            <div className="card skeleton" style={{ height: 196 }} />
          </div>
        </div>
      }
    >
      {(view, selected) => <Summary view={view} selected={selected} onAdd={onAdd} />}
    </DayScreen>
  );
}

function Summary({ view, selected, onAdd }: { view: DayView; selected: string; onAdd: () => void }) {
  const addWater = useAddWater(selected);
  const features = useFeatures().data;
  const layout = useHomeLayout().data ?? completeHomeLayout(null);

  // Each card keeps its column on wide screens; on phones the columns melt into one list (display: contents) and
  // the order chosen in Profilo › Personalizza home applies to all of them
  const cards: Record<HomeCardId, { column: "main" | "side"; node: ReactNode }> = {
    calories: {
      column: "main",
      node: (
        <CalorieCard eaten={view.totals.kcal} goal={view.goals.kcal}>
          <DayCurve view={view} />
        </CalorieCard>
      ),
    },
    // Effort, recovery and sleep: on phones they sit right after the next meal, as before the layout could change
    scores: { column: "main", node: features?.health && <ScoreRings date={view.date} /> },
    macros: { column: "main", node: <MacroCard totals={view.totals} goals={view.goals} /> },
    water: {
      column: "main",
      node: features?.water && (
        <WaterCard
          totalMl={view.totals.waterMl}
          goalMl={view.goals.waterMl}
          canAdd={view.isToday}
          adding={addWater.isPending}
          failed={addWater.isError}
          onAdd={(amount) => addWater.mutate(amount)}
        />
      ),
    },
    nextMeal: { column: "side", node: <NextMealCard view={view} onAdd={onAdd} /> },
    training: { column: "side", node: view.isToday && features?.training && <TodayTrainingCard date={view.date} /> },
    plan: { column: "side", node: <DayPlanCard view={view} /> },
    activity: { column: "side", node: features?.health && <ActivityCard date={view.date} /> },
    insight: { column: "side", node: view.isToday && <InsightCard /> },
  };
  const slots = (column: "main" | "side") =>
    layout.order
      .filter((id) => cards[id].column === column && !layout.hidden.includes(id) && cards[id].node)
      .map((id) => (
        <div key={id} className="home-slot" data-card={id} style={{ order: layout.order.indexOf(id) }}>
          {cards[id].node}
        </div>
      ));

  return (
    <div className="today-grid">
      <div className="today-main">
        {/* Not movable: the UTC notice stays first */}
        {view.isToday && (
          <div className="home-slot" style={{ order: -1 }}>
            <TimezoneNotice timezone={view.clock.timezone} />
          </div>
        )}
        {slots("main")}
      </div>
      <div className="today-side">{slots("side")}</div>
    </div>
  );
}
