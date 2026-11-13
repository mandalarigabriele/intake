import type {
  AddWaterRequest,
  DayView,
  FavoriteMealRequest,
  HealthDay,
  HealthImportResult,
  HealthSettings,
  HealthStatus,
  InsightResponse,
  LogWeightRequest,
  Meal,
  PlanUploadError,
  PlansResponse,
  PushStatus,
  PushSubscriptionRequest,
  ReminderSettings,
  RepeatMealRequest,
  StoredPlan,
  UpdateMealRequest,
  WeekView,
  WorkoutsResponse,
} from "@intake/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch, newIdempotencyKey } from "./client";

export interface User {
  email: string;
  name: string | null;
  picture: string | null;
}

/** The signed-in owner, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await apiFetch<{ user: User }>("/api/me")).user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: Infinity,
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(["me"], null);
    },
  });
}

const dayKey = (date: string) => ["day", date] as const;

/** Day view; `date` is YYYY-MM-DD or "today". Refetches on focus and every few minutes for the "now" marker. */
export function useDay(date: string) {
  return useQuery({
    queryKey: dayKey(date),
    queryFn: () => apiFetch<DayView>(`/api/days/${date}`),
    refetchInterval: 5 * 60 * 1000,
    // Keep showing the previous day while the next one loads
    placeholderData: keepPreviousData,
  });
}

/** Adds water now, updating today's totals optimistically. */
export function useAddWater(date: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (amountMl: number) =>
      apiFetch("/api/water", {
        method: "POST",
        json: { amountMl, idempotencyKey: newIdempotencyKey() } satisfies AddWaterRequest,
      }),
    onMutate: async (amountMl) => {
      await queryClient.cancelQueries({ queryKey: dayKey(date) });
      const previous = queryClient.getQueryData<DayView>(dayKey(date));
      if (previous) {
        queryClient.setQueryData<DayView>(dayKey(date), {
          ...previous,
          totals: { ...previous.totals, waterMl: previous.totals.waterMl + amountMl },
        });
      }
      return { previous };
    },
    onError: (_error, _amount, context) => {
      if (context?.previous) queryClient.setQueryData(dayKey(date), context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["day"] }),
  });
}

export function useNutritionStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["nutrition-status"],
    queryFn: () => apiFetch<{ connected: boolean }>("/api/nutrition/status"),
    enabled,
  });
}

export function useDisconnectNutrition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch("/api/nutrition/disconnect", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

/** "Mangiato come previsto": logs a planned meal; it disappears from the timeline right away. */
export function useLogPlanned(date: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entry: { date: string; planId: number; index: number }) =>
      apiFetch<{ mealId: string | null }>(`/api/days/${entry.date}/planned/${entry.planId}/${entry.index}`, { method: "POST" }),
    onMutate: async (entry) => {
      await queryClient.cancelQueries({ queryKey: dayKey(date) });
      const previous = queryClient.getQueryData<DayView>(dayKey(date));
      if (previous) {
        queryClient.setQueryData<DayView>(dayKey(date), {
          ...previous,
          planned: previous.planned.filter((p) => !(p.planId === entry.planId && p.index === entry.index)),
        });
      }
      return { previous };
    },
    onError: (_error, _entry, context) => {
      if (context?.previous) queryClient.setQueryData(dayKey(date), context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["day"] }),
  });
}

export function usePlans() {
  return useQuery({
    queryKey: ["plans"],
    queryFn: () => apiFetch<PlansResponse>("/api/plans"),
  });
}

export class PlanUploadFailed extends Error {
  constructor(readonly issues: PlanUploadError["issues"]) {
    super("Invalid plan");
  }
}

/** Uploads a plan file's parsed JSON; validation issues come back as PlanUploadFailed. */
export function useUploadPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (plan: unknown) => {
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(plan),
        credentials: "same-origin",
      });
      if (response.status === 400) throw new PlanUploadFailed(((await response.json()) as PlanUploadError).issues);
      if (!response.ok) throw new ApiError(response.status, null, "Plan upload failed");
      return (await response.json()) as StoredPlan;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      queryClient.invalidateQueries({ queryKey: ["day"] });
    },
  });
}

const invalidateDays = (queryClient: ReturnType<typeof useQueryClient>) => queryClient.invalidateQueries({ queryKey: ["day"] });

export function useRecentMeals(enabled: boolean) {
  return useQuery({
    queryKey: ["recent-meals"],
    queryFn: () => apiFetch<{ meals: Meal[] }>("/api/meals/recent").then((r) => r.meals),
    enabled,
  });
}

/** Logs a copy of an earlier meal now. */
export function useRepeatMeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (meal: Pick<Meal, "id" | "date">) =>
      apiFetch(`/api/meals/${meal.id}/repeat`, {
        method: "POST",
        json: { date: meal.date, idempotencyKey: newIdempotencyKey() } satisfies RepeatMealRequest,
      }),
    onSettled: () => invalidateDays(queryClient),
  });
}

export function useUpdateMeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: UpdateMealRequest }) => apiFetch(`/api/meals/${id}`, { method: "PATCH", json: request }),
    onSettled: () => invalidateDays(queryClient),
  });
}

export function useDeleteMeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/meals/${id}`, { method: "DELETE" }),
    onSettled: () => invalidateDays(queryClient),
  });
}

export function useFavoriteMeal() {
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch(`/api/meals/${id}/favorite`, { method: "POST", json: { name } satisfies FavoriteMealRequest }),
  });
}

export function useWeek(date: string) {
  return useQuery({
    queryKey: ["week", date],
    queryFn: () => apiFetch<WeekView>(`/api/weeks/${date}`),
    placeholderData: keepPreviousData,
  });
}

export function useLogWeight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (weightKg: number) =>
      apiFetch("/api/weight", { method: "POST", json: { weightKg, idempotencyKey: newIdempotencyKey() } satisfies LogWeightRequest }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["week"] }),
  });
}

/** "Salta" / "Annulla" on a planned meal; the card changes right away. */
export function useSkipPlanned(date: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entry: { date: string; planId: number; index: number; skip: boolean }) =>
      apiFetch(`/api/days/${entry.date}/planned/${entry.planId}/${entry.index}/skip`, { method: entry.skip ? "POST" : "DELETE" }),
    onMutate: async (entry) => {
      await queryClient.cancelQueries({ queryKey: dayKey(date) });
      const previous = queryClient.getQueryData<DayView>(dayKey(date));
      if (previous) {
        queryClient.setQueryData<DayView>(dayKey(date), {
          ...previous,
          planned: previous.planned.map((p) =>
            p.planId === entry.planId && p.index === entry.index ? { ...p, status: entry.skip ? "skipped" : p.time <= previous.clock.localTime.slice(0, 5) || !previous.isToday ? "todo" : "planned" } : p,
          ),
        });
      }
      return { previous };
    },
    onError: (_error, _entry, context) => {
      if (context?.previous) queryClient.setQueryData(dayKey(date), context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["day"] }),
  });
}

/** Daily insight; the server computes it once an hour, so it is also kept long on the client. */
export function useInsight() {
  return useQuery({
    queryKey: ["insight"],
    queryFn: () => apiFetch<InsightResponse>("/api/insight"),
    staleTime: 30 * 60 * 1000,
  });
}

/** Reminder settings and the number of subscribed devices. */
export function usePushStatus(enabled: boolean) {
  return useQuery({ queryKey: ["push"], queryFn: () => apiFetch<PushStatus>("/api/push"), enabled });
}

export function useSubscribePush() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (subscription: PushSubscriptionRequest) => apiFetch<PushStatus>("/api/push/subscriptions", { method: "POST", json: subscription }),
    onSuccess: (status) => queryClient.setQueryData(["push"], status),
  });
}

export function useUnsubscribePush() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (endpoint: string) => apiFetch<PushStatus>("/api/push/subscriptions", { method: "DELETE", json: { endpoint } }),
    onSuccess: (status) => queryClient.setQueryData(["push"], status),
  });
}

export function useReminderSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: ReminderSettings) => apiFetch<PushStatus>("/api/push/settings", { method: "PUT", json: settings }),
    onSuccess: (status) => queryClient.setQueryData(["push"], status),
  });
}

export function useTestPush() {
  return useMutation({ mutationFn: () => apiFetch<{ sent: number }>("/api/push/test", { method: "POST" }) });
}

/** Workouts between two local dates: Hevy (configured: false without a Hevy API key) and Apple Health. */
export function useWorkouts(from: string | undefined, to: string | undefined) {
  return useQuery({
    queryKey: ["workouts", from, to],
    queryFn: () => apiFetch<WorkoutsResponse>(`/api/workouts?from=${from}&to=${to}`),
    enabled: Boolean(from && to),
    staleTime: 5 * 60_000,
  });
}

const healthStatusKey = ["health", "status"] as const;

/** Apple Health data status (Profile › Apple Salute). */
export function useHealthStatus() {
  return useQuery({
    queryKey: healthStatusKey,
    queryFn: () => apiFetch<HealthStatus>("/api/health/status"),
  });
}

/**
 * Sends a Health Auto Export file: `commit: false` only returns the preview, `commit: true` imports it.
 * Errors are ApiError with code "not_health_export" / "no_data", or status 413 for files over the limit.
 */
export function useHealthImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ json, commit }: { json: unknown; commit: boolean }) =>
      apiFetch<HealthImportResult>(`/api/health/import${commit ? "?commit=true" : ""}`, { method: "POST", json }),
    onSuccess: (_result, { commit }) => {
      if (commit) {
        void queryClient.invalidateQueries({ queryKey: ["health"] });
        void queryClient.invalidateQueries({ queryKey: ["workouts"] });
      }
    },
  });
}

/** Saves Apple Health settings (step goal), updating the status optimistically. */
export function useSetHealthSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: HealthSettings) => apiFetch<HealthSettings>("/api/health/settings", { method: "PUT", json: settings }),
    onMutate: async (settings) => {
      await queryClient.cancelQueries({ queryKey: healthStatusKey });
      const previous = queryClient.getQueryData<HealthStatus>(healthStatusKey);
      if (previous) queryClient.setQueryData<HealthStatus>(healthStatusKey, { ...previous, settings });
      return { previous };
    },
    onError: (_error, _settings, context) => {
      if (context?.previous) queryClient.setQueryData(healthStatusKey, context.previous);
    },
  });
}

/** Apple Health values of one day for the "Attività e riposo" card. */
export function useHealthDay(date: string) {
  return useQuery({
    queryKey: ["health", "day", date],
    queryFn: () => apiFetch<HealthDay>(`/api/health/days/${date}`),
    placeholderData: keepPreviousData,
  });
}
