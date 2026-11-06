import type { DayView } from "@intake/shared";
import { useAddWater, type User } from "../api/queries";
import { CalorieCard } from "../components/CalorieCard";
import { DayScreen } from "../components/DayScreen";
import { MacroCard } from "../components/MacroCard";
import { WaterCard } from "../components/WaterCard";
import { formatWeekday } from "../lib/format";
import { t } from "../lib/strings";

interface Props {
  user: User;
  notice: string | null;
  onAdd: () => void;
}

/** Oggi: the day's recap (calories, macros, water). The meals are on the Timeline page. */
export function TodayPage({ user, notice, onAdd }: Props) {
  return (
    <DayScreen
      user={user}
      notice={notice}
      onAdd={onAdd}
      title={(view) => (view && !view.isToday ? formatWeekday(view.date) : t.today)}
      skeleton={
        <div className="day-recap" aria-label={t.loading}>
          <div className="card skeleton" style={{ height: 172 }} />
          <div className="card skeleton" style={{ height: 196 }} />
          <div className="card skeleton recap-water" style={{ height: 80 }} />
        </div>
      }
    >
      {(view, selected) => <Recap view={view} selected={selected} />}
    </DayScreen>
  );
}

function Recap({ view, selected }: { view: DayView; selected: string }) {
  const addWater = useAddWater(selected);
  return (
    <div className="day-recap">
      <CalorieCard eaten={view.totals.kcal} goal={view.goals.kcal} />
      <MacroCard totals={view.totals} goals={view.goals} />
      <div className="recap-water">
        <WaterCard
          totalMl={view.totals.waterMl}
          goalMl={view.goals.waterMl}
          canAdd={view.isToday}
          adding={addWater.isPending}
          failed={addWater.isError}
          onAdd={(amount) => addWater.mutate(amount)}
        />
      </div>
    </div>
  );
}
