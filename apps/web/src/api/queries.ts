import type { AddWaterRequest, DayView, PlanUploadError, PlansResponse, StoredPlan } from "@intake/shared";
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
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
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
