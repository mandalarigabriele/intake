import { mealTimes, planDay } from "@intake/shared";
import type { PlanStore } from "../db/planStore.js";
import type { ReminderStore, StoredSubscription } from "../db/reminderStore.js";
import type { NutritionApi } from "../mcp/nutritionApi.js";
import { plannedEntries } from "./planMatching.js";
import { buildNotification, dueSlots, type Notification, type PlannedTime } from "./reminders.js";

export interface PushSender {
  /** "gone": the device unsubscribed or the subscription expired; it is removed. */
  send(subscription: StoredSubscription, notification: Notification): Promise<"ok" | "gone">;
}

export interface ReminderSchedulerDeps {
  store: ReminderStore;
  plans: Pick<PlanStore, "activeOn" | "linksOn" | "skipsOn">;
  api: Pick<NutritionApi, "clock" | "mealsByDate" | "goalProgress">;
  sender: PushSender;
  log: { warn(details: object, message: string): void; info(details: object, message: string): void };
}

/**
 * Checks once a minute which reminders are due. Without subscribed devices or enabled reminders
 * it does nothing; otherwise the plan times decide, and Nutrition is read only when a reminder is
 * due (a few times a day), well within the 60 requests per minute.
 */
export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: ReminderSchedulerDeps) {}

  start(intervalMs = 60_000): void {
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Sends the due reminders; returns how many notifications were sent (per device). */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.check();
    } catch (error) {
      // Not connected, rate limited, network: try again next minute (still inside the window)
      this.deps.log.warn({ err: error }, "Reminder check failed");
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async check(): Promise<number> {
    const { store, plans, api } = this.deps;
    if (store.subscriptions().length === 0) return 0;
    const settings = store.settings();
    if (!Object.values(settings).some(Boolean)) return 0;

    const clock = await api.clock();
    const date = clock.localDate;
    const now = clock.localTime.slice(0, 5);
    const plan = plans.activeOn(date);
    const planned: PlannedTime[] = plan
      ? mealTimes(planDay(plan.plan, date).meals).map((time, index) => ({ planId: plan.id, index, time }))
      : [];

    const slots = dueSlots(date, now, planned, settings).filter((slot) => !store.wasSent(slot.key));
    if (slots.length === 0) return 0;

    const needsMeals = slots.some((s) => s.kind === "meal" || s.kind === "todo");
    const needsProgress = slots.some((s) => s.kind === "water" || s.kind === "summary");
    const [parsed, progress] = await Promise.all([
      needsMeals ? api.mealsByDate(date) : Promise.resolve(null),
      needsProgress ? api.goalProgress(date) : Promise.resolve(null),
    ]);
    const entries =
      parsed && plan ? plannedEntries(plan, parsed.meals, plans.linksOn(date), { date, today: date, now: clock.localTime }, plans.skipsOn(date)) : [];

    let sent = 0;
    for (const slot of slots) {
      const notification = buildNotification(slot, { now, entries, totals: progress?.totals ?? null, goals: progress?.goals ?? null });
      // Marked even when it no longer applies, so it is not checked again every minute
      store.markSent(slot.key);
      if (notification) sent += await this.sendAll(notification);
    }
    if (sent > 0) this.deps.log.info({ sent }, "Reminders sent");
    return sent;
  }

  /** Sends one notification to every subscribed device. */
  async sendAll(notification: Notification): Promise<number> {
    let sent = 0;
    for (const subscription of this.deps.store.subscriptions()) {
      try {
        const result = await this.deps.sender.send(subscription, notification);
        if (result === "gone") this.deps.store.removeSubscription(subscription.endpoint);
        else sent++;
      } catch (error) {
        this.deps.log.warn({ err: error }, "Push notification failed");
      }
    }
    return sent;
  }
}
