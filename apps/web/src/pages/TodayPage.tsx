import type { DayView } from "@intake/shared";
import { useAddWater, type User } from "../api/queries";
import { ActivityCard } from "../components/ActivityCard";
import { CalorieCard } from "../components/CalorieCard";
import { DayScreen } from "../components/DayScreen";
import { InsightCard } from "../components/InsightCard";
import { MacroCard } from "../components/MacroCard";
import { NextMealCard } from "../components/NextMealCard";
import { DayPlanCard } from "../components/PlanCompare";
import { WaterCard } from "../components/WaterCard";
import { formatWeekday } from "../lib/format";
import { t } from "../lib/strings";

interface Props {
  user: User;
  notice: string | null;
  onAdd: () => void;
}

/**
 * Oggi (summary): Next meal, calories, macros, water, activity & rest and the daily insight. On wide screens the
 * left column holds calories, macros and water, the right one Next meal and the insight.
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
  return (
    <div className="today-grid">
      <div className="today-main">
        <CalorieCard eaten={view.totals.kcal} goal={view.goals.kcal} />
        <MacroCard totals={view.totals} goals={view.goals} />
        <WaterCard
          totalMl={view.totals.waterMl}
          goalMl={view.goals.waterMl}
          canAdd={view.isToday}
          adding={addWater.isPending}
          failed={addWater.isError}
          onAdd={(amount) => addWater.mutate(amount)}
        />
      </div>
      <div className="today-side">
        <NextMealCard view={view} onAdd={onAdd} />
        <DayPlanCard view={view} />
        <ActivityCard date={view.date} />
        {view.isToday && <InsightCard />}
      </div>
    </div>
  );
}
