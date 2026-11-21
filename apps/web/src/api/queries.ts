import type {
  RecognitionModelResponse,
  DailyScores,
  AddWaterRequest,
  CreateMealRequest,
  RecognizeMealRequest,
  RecognizedMeal,
  DayView,
  FavoriteMealRequest,
  HealthDay,
  HealthImportResult,
  HealthSettings,
  HealthStatus,
  HealthSyncStatus,
  HealthTrends,
  InsightResponse,
  LogWeightRequest,
  Meal,
  PlanUploadError,
  PlansResponse,
  PushStatus,
  PushSubscriptionRequest,
  ReminderSettings,
  RepeatMealRequest,
  SavedMeal,
  SavedMealsResponse,
  StoredPlan,
  UpdateMealRequest,
  WeekView,
  ProfileView,
  TrainingView,
  TrainingSourceId,
  TrainingSourceStatus,
  HevySyncStatus,
  WorkoutsResponse,
  FeatureKey,
  FeaturesResponse,
  FeaturesUpdate,
  GoalsUpdate,
  BackupStatus,
  PlanGenerationJob,
  MealMove,
  MealReplace,
  MealTimeChange,
  PlanGenerationView,
  PlanPreferences,
  MealPhotosResponse,
  MealPhotoUpload,
  Language,
  LanguageResponse,
  NeedsAiOpinion,
  NeedsApplyRequest,
  NeedsProfile,
  NeedsView,
} from "@intake/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch, newIdempotencyKey } from "./client";
import { rememberLanguage } from "../lib/strings";

export interface User {
  email: string;
  name: string | null;
  picture: string | null;
}

const featuresKey = ["features"] as const;

/** Which optional parts are on (Allenamenti, Salute, Promemoria) and whether the first-run setup was done (docs/features.md). */
export function useFeatures() {
  return useQuery({ queryKey: featuresKey, queryFn: () => apiFetch<FeaturesResponse>("/api/features"), staleTime: 5 * 60_000 });
}

/** Whether an optional part is on; false until the switches are loaded, so its routes are never asked while off. */
export function useFeature(key: FeatureKey): boolean {
  return useFeatures().data?.[key] ?? false;
}

/** Changes the switches; every screen reloads so hidden parts disappear and turned-on parts load. */
export function useSetFeatures() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: FeaturesUpdate) => apiFetch<FeaturesResponse>("/api/features", { method: "PUT", json: update }),
    onSuccess: (features) => {
      queryClient.setQueryData(featuresKey, features);
      void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "features" });
    },
  });
}

/** Claude model of the meal recognition (Pasti da foto); asked only while the part is on and the key is set. */
export function useRecognitionModel(enabled: boolean) {
  return useQuery({ queryKey: ["recognition-model"], queryFn: () => apiFetch<RecognitionModelResponse>("/api/meals/recognize/model"), enabled, staleTime: 5 * 60_000 });
}

export function useSetRecognitionModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (model: string) => apiFetch<RecognitionModelResponse>("/api/meals/recognize/model", { method: "PUT", json: { model } }),
    onSuccess: (data) => queryClient.setQueryData(["recognition-model"], data),
  });
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

/** Foods, grams and nutrition from a photo or a description (Claude API); nothing is logged yet. */
export function useRecognizeMeal() {
  return useMutation({
    mutationFn: (request: RecognizeMealRequest) => apiFetch<RecognizedMeal>("/api/meals/recognize", { method: "POST", json: request }),
  });
}

/** Logs a new meal confirmed by the user (e.g. after the recognition). */
export function useCreateMeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateMealRequest) => apiFetch<{ mealId: string | null; photosSaved: number; favoriteSaved: boolean }>("/api/meals", { method: "POST", json: request }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["meal-photos"] });
      void queryClient.invalidateQueries({ queryKey: ["saved-meals"] });
      return invalidateDays(queryClient);
    },
  });
}

/** Meal id → photo ids (oldest first) of the photos kept on the server (Pasti da foto). */
export function useMealPhotos() {
  // Kept photos belong to the photo meals part: while it is off they are not shown (and the route answers 404)
  const on = useFeatures().data?.recognition ?? false;
  return useQuery({
    queryKey: ["meal-photos"],
    enabled: on,
    queryFn: () => apiFetch<MealPhotosResponse>("/api/meals/photos").then((r) => new Map(Object.entries(r.photos))),
    staleTime: 5 * 60_000,
  });
}

/** One photo of a meal; without a photo id, the first one (timeline thumbnail). */
export const mealPhotoUrl = (mealId: string, photoId?: string) => (photoId ? `/api/meals/${mealId}/photos/${photoId}` : `/api/meals/${mealId}/photo`);

/** Modifica pasto, after the meal itself is saved: photos removed and photos added (the second course, …). */
export function useSaveMealPhotos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ mealId, remove, add }: { mealId: string; remove: string[]; add: MealPhotoUpload[] }) => {
      for (const photoId of remove) await apiFetch(`/api/meals/${mealId}/photos/${photoId}`, { method: "DELETE" });
      for (const photo of add) await apiFetch(`/api/meals/${mealId}/photos`, { method: "POST", json: photo });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["meal-photos"] }),
  });
}

/** Saved meals ("preferiti") on Nutrition, for the add sheet. */
export function useSavedMeals() {
  return useQuery({
    queryKey: ["saved-meals"],
    queryFn: () => apiFetch<SavedMealsResponse>("/api/meals/saved").then((r) => r.meals),
    staleTime: 60_000,
  });
}

/** Logs a saved meal now; the server picks the meal type (the saved meal's default, else the time of day). */
export function useLogSavedMeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (meal: SavedMeal) => apiFetch(`/api/meals/saved/${meal.id}/log`, { method: "POST", json: { idempotencyKey: newIdempotencyKey() } }),
    onSettled: () => invalidateDays(queryClient),
  });
}

/** Deletes a favorite on Nutrition; the list of the add sheet reloads. */
export function useDeleteSavedMeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (meal: SavedMeal) => apiFetch(`/api/meals/saved/${meal.id}`, { method: "DELETE" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["saved-meals"] }),
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
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["meal-photos"] });
      return invalidateDays(queryClient);
    },
  });
}

export function useFavoriteMeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch(`/api/meals/${id}/favorite`, { method: "POST", json: { name } satisfies FavoriteMealRequest }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved-meals"] }),
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
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });
}

/** Profilo: weigh-ins, daily goals and whether Hevy is set up (two Nutrition reads). */
export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: () => apiFetch<ProfileView>("/api/profile"),
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
  const on = useFeature("reminders");
  return useQuery({ queryKey: ["push"], queryFn: () => apiFetch<PushStatus>("/api/push"), enabled: enabled && on });
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
/** Andamento › Allenamenti: next routine, week, load progress and recent workouts, live from Hevy. */
export function useTraining() {
  const on = useFeature("training");
  return useQuery({
    enabled: on,
    queryKey: ["training"],
    queryFn: () => apiFetch<TrainingView>("/api/training"),
    staleTime: 5 * 60_000,
  });
}

const trainingSourceKey = ["training", "source"] as const;

/** Which workout sources are configured and which one is active (Hevy or openGym). */
export function useTrainingSource() {
  const on = useFeature("training");
  return useQuery({ enabled: on, queryKey: trainingSourceKey, queryFn: () => apiFetch<TrainingSourceStatus>("/api/training/source") });
}

/** Switches the workout source; everything that shows workouts reloads from the new one. */
export function useSetTrainingSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (source: TrainingSourceId) => apiFetch<TrainingSourceStatus>("/api/training/source", { method: "PUT", json: { source } }),
    onSuccess: (status) => {
      queryClient.setQueryData(trainingSourceKey, status);
      void queryClient.invalidateQueries({ queryKey: ["training"], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["workouts"] });
    },
  });
}

const hevySyncKey = ["hevy-sync"] as const;

/** The optional openGym → Hevy copy, with a preview of what the next run sends (Profilo › Collegamenti). */
export function useHevySync() {
  const on = useFeature("training");
  return useQuery({ enabled: on, queryKey: hevySyncKey, queryFn: () => apiFetch<HevySyncStatus>("/api/hevy-sync") });
}

/** Turns the copy on (it runs right away) or off, or runs it now. */
export function useHevySyncAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: "on" | "off" | "run") =>
      action === "run"
        ? apiFetch<HevySyncStatus>("/api/hevy-sync/run", { method: "POST" })
        : apiFetch<HevySyncStatus>("/api/hevy-sync", { method: "PUT", json: { enabled: action === "on" } }),
    onSuccess: (status) => {
      queryClient.setQueryData(hevySyncKey, status);
      void queryClient.invalidateQueries({ queryKey: ["training"] });
      void queryClient.invalidateQueries({ queryKey: ["workouts"] });
    },
  });
}

export function useWorkouts(from: string | undefined, to: string | undefined) {
  const features = useFeatures().data;
  return useQuery({
    queryKey: ["workouts", from, to],
    queryFn: () => apiFetch<WorkoutsResponse>(`/api/workouts?from=${from}&to=${to}`),
    // The list carries the gym app and the Apple Health sessions: hidden only when both parts are off
    enabled: Boolean(from && to) && Boolean(features?.training || features?.health),
    staleTime: 5 * 60_000,
  });
}

const healthStatusKey = ["health", "status"] as const;

/** Apple Health data status (Profile › Apple Salute). */
export function useHealthStatus() {
  const on = useFeature("health");
  return useQuery({
    enabled: on,
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

const healthSyncKey = ["health", "sync"] as const;

/** Automatic upload from Health Auto Export: on/off, token and last upload. */
export function useHealthSync() {
  const on = useFeature("health");
  return useQuery({ enabled: on, queryKey: healthSyncKey, queryFn: () => apiFetch<HealthSyncStatus>("/api/health/sync") });
}

/** Creates a new token (turning the sync on) or turns it off; the old token stops working at once. */
export function useHealthSyncAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: "token" | "off") =>
      apiFetch<HealthSyncStatus>(action === "token" ? "/api/health/sync/token" : "/api/health/sync", { method: action === "token" ? "POST" : "DELETE" }),
    onSuccess: (status) => queryClient.setQueryData(healthSyncKey, status),
  });
}

/** Andamento › Salute: the last 7, 30 or 90 days of Apple Health data (SQLite only, no Nutrition calls). */
export function useHealthTrends(period: 7 | 30 | 90) {
  const on = useFeature("health");
  return useQuery({
    enabled: on,
    queryKey: ["health", "trends", period],
    queryFn: () => apiFetch<HealthTrends>(`/api/health/trends?days=${period}`),
    placeholderData: keepPreviousData,
  });
}

/** Sforzo, Recupero and Sonno for the rings on Oggi (SQLite only). */
export function useHealthScores(date: string) {
  const on = useFeature("health");
  return useQuery({
    enabled: on,
    queryKey: ["health", "scores", date],
    queryFn: () => apiFetch<DailyScores>(`/api/health/scores/${date}`),
  });
}

/** Apple Health values of one day for the "Attività e riposo" card. */
export function useHealthDay(date: string) {
  const on = useFeature("health");
  return useQuery({
    enabled: on,
    queryKey: ["health", "day", date],
    queryFn: () => apiFetch<HealthDay>(`/api/health/days/${date}`),
    placeholderData: keepPreviousData,
  });
}

/** Profilo › Lingua: one language for the whole installation; the app reloads in it once saved. */
export function useSetLanguage() {
  return useMutation({
    mutationFn: (language: Language) => apiFetch<LanguageResponse>("/api/language", { method: "PUT", json: { language } }),
    onSuccess: ({ language }) => {
      if (rememberLanguage(language)) window.location.reload();
    },
  });
}

/** Profilo › Obiettivi: saved in Nutrition; every screen reloads, since Today, Trends and the plan compare against the goals. */
export function useSetGoals() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: GoalsUpdate) => apiFetch<{ ok: true }>("/api/goals", { method: "PUT", json: update }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

const backupsKey = ["backups"] as const;

/** Impostazioni › Backup: the daily Nutrition backups saved on the server (docs/backups.md). */
export function useBackups() {
  return useQuery({ queryKey: backupsKey, queryFn: () => apiFetch<BackupStatus>("/api/backups") });
}

/** "Fai un backup ora", or a new number of backups to keep. */
export function useBackupAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: { run: true } | { keep: number }) =>
      "run" in action
        ? apiFetch<BackupStatus>("/api/backups/run", { method: "POST" })
        : apiFetch<BackupStatus>("/api/backups/settings", { method: "PUT", json: { keep: action.keep } }),
    onSuccess: (status) => queryClient.setQueryData(backupsKey, status),
  });
}

const needsKey = ["needs"] as const;

/** Piano › Il tuo fabbisogno: the saved fields, the calculation, the data check and the last AI opinion (docs/needs.md). */
export function useNeeds() {
  return useQuery({ queryKey: needsKey, queryFn: () => apiFetch<NeedsView>("/api/needs") });
}

export function useSaveNeedsProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profile: NeedsProfile) => apiFetch<NeedsView>("/api/needs/profile", { method: "PUT", json: profile }),
    onSuccess: (view) => queryClient.setQueryData(needsKey, view),
  });
}

/** Sets the goals in Nutrition; every screen reloads, as with Profilo › Obiettivi. */
export function useApplyNeeds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: NeedsApplyRequest) => apiFetch<{ ok: true }>("/api/needs/apply", { method: "POST", json: request }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

/** "Chiedi un parere all'IA" (Claude API); nothing is applied until the user chooses. */
export function useAskNeedsAi() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<NeedsAiOpinion>("/api/needs/ai", { method: "POST" }),
    onSuccess: (ai) => queryClient.setQueryData<NeedsView>(needsKey, (view) => (view ? { ...view, ai } : view)),
  });
}

const planGenerationKey = ["plan-generation"] as const;

/** "Genera con l'IA": the preferences (or the defaults), the targets and the plan model. */
export function usePlanGeneration(enabled = true) {
  return useQuery({ queryKey: planGenerationKey, queryFn: () => apiFetch<PlanGenerationView>("/api/plans/generation"), enabled });
}

export function useSavePlanPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (preferences: PlanPreferences) => apiFetch<PlanGenerationView>("/api/plans/generation/preferences", { method: "PUT", json: preferences }),
    onSuccess: (view) => queryClient.setQueryData(planGenerationKey, view),
  });
}

export function useSetPlanModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (model: string) => apiFetch<PlanGenerationView>("/api/plans/generation/model", { method: "PUT", json: { model } }),
    onSuccess: (view) => queryClient.setQueryData(planGenerationKey, view),
  });
}

/** Starts a generation with the saved preferences; the job is then read every few seconds. */
export function useStartPlanGeneration() {
  return useMutation({ mutationFn: () => apiFetch<{ id: string }>("/api/plans/generate", { method: "POST" }) });
}

export function usePlanGenerationJob(id: string | null) {
  return useQuery({
    queryKey: ["plan-generation-job", id ?? ""],
    queryFn: () => apiFetch<PlanGenerationJob>(`/api/plans/generate/${id}`),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" || !query.state.data ? 2000 : false),
  });
}

/** "Attiva piano": the draft becomes a new plan version. */
export function useActivatePlanDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, validFrom }: { id: string; validFrom: string }) => apiFetch(`/api/plans/generate/${id}/activate`, { method: "POST", json: { validFrom } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["plans"] });
      return invalidateDays(queryClient);
    },
  });
}

const planJobKey = (id: string) => ["plan-generation-job", id] as const;

/** A meal time of the draft, on one day or on every day. */
export function useSetDraftTime(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: MealTimeChange) => apiFetch<PlanGenerationJob>(`/api/plans/generate/${id}/time`, { method: "PATCH", json: change }),
    onSuccess: (job) => queryClient.setQueryData(planJobKey(id), job),
  });
}

/** "Sostituisci": another dish for one meal of the draft. */
export function useReplaceDraftMeal(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: MealReplace) => apiFetch<PlanGenerationJob>(`/api/plans/generate/${id}/replace`, { method: "POST", json: request }),
    onSuccess: (job) => queryClient.setQueryData(planJobKey(id), job),
  });
}

/** One stored plan version (Piano shows the scheduled one when none is active yet). */
export function usePlan(id: number | undefined) {
  return useQuery({ queryKey: ["plans", id], queryFn: () => apiFetch<StoredPlan>(`/api/plans/${id}`), enabled: id !== undefined });
}

/** A meal time of a stored version; Oggi and Timeline follow the new time. */
export function useSetPlanTime() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...change }: MealTimeChange & { id: number }) => apiFetch<StoredPlan>(`/api/plans/${id}/time`, { method: "PATCH", json: change }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["plans"] });
      return invalidateDays(queryClient);
    },
  });
}

/** The plan Piano shows: the one in effect today, or the next scheduled one when none is active yet. */
export function useShownPlan() {
  const plans = usePlans();
  const data = plans.data;
  const scheduled = data?.versions.filter((v) => v.status === "scheduled").at(-1);
  const scheduledPlan = usePlan(data && !data.active ? scheduled?.id : undefined).data ?? null;
  return { plans, shown: data?.active ?? scheduledPlan };
}

/** "Sposta": a dish of the draft swapped with the same meal of another day. */
export function useSwapDraftMeal(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (move: MealMove) => apiFetch<PlanGenerationJob>(`/api/plans/generate/${id}/swap`, { method: "PATCH", json: move }),
    onSuccess: (job) => queryClient.setQueryData(planJobKey(id), job),
  });
}

/** "Sposta" on a stored version; Oggi and Timeline follow. */
export function useSwapPlanMeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...move }: MealMove & { id: number }) => apiFetch<StoredPlan>(`/api/plans/${id}/swap`, { method: "PATCH", json: move }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["plans"] });
      return invalidateDays(queryClient);
    },
  });
}
