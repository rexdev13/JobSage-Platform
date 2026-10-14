import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface RegisterSyncLogEntry {
  id: number;
  status: "success" | "error";
  recordCount: number | null;
  addedCount: number | null;
  updatedCount: number | null;
  removedCount: number | null;
  durationMs: number | null;
  triggeredBy: "scheduler" | "manual" | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface VacancySyncLogEntry {
  id: number;
  status: "success" | "error";
  batchSize: number | null;
  checkedCount: number | null;
  cacheHitCount: number | null;
  errorCount: number | null;
  errorMessage: string | null;
  triggeredBy: "scheduler" | "manual" | null;
  durationMs: number | null;
  createdAt: string;
}

export interface RegisterSyncLogsResponse {
  logs: RegisterSyncLogEntry[];
  lastSuccess: RegisterSyncLogEntry | null;
  lastFailure: RegisterSyncLogEntry | null;
}

export interface VacancySyncLogsResponse {
  logs: VacancySyncLogEntry[];
  lastSuccess: VacancySyncLogEntry | null;
  lastFailure: VacancySyncLogEntry | null;
}

export interface TriggerSyncResponse {
  queued: true;
}

const REGISTER_SYNC_LOGS_KEY = ["admin", "sync", "register-logs"] as const;
const VACANCY_SYNC_LOGS_KEY = ["admin", "sync", "vacancy-logs"] as const;

export function getRegisterSyncLogsQueryKey() {
  return REGISTER_SYNC_LOGS_KEY;
}

export function getVacancySyncLogsQueryKey() {
  return VACANCY_SYNC_LOGS_KEY;
}

export function useGetRegisterSyncLogs() {
  return useQuery<RegisterSyncLogsResponse>({
    queryKey: REGISTER_SYNC_LOGS_KEY,
    queryFn: ({ signal }) =>
      customFetch<RegisterSyncLogsResponse>("/api/admin/super/sync/register-logs", { signal }),
    refetchInterval: 30_000,
  });
}

export function useGetVacancySyncLogs() {
  return useQuery<VacancySyncLogsResponse>({
    queryKey: VACANCY_SYNC_LOGS_KEY,
    queryFn: ({ signal }) =>
      customFetch<VacancySyncLogsResponse>("/api/admin/super/sync/vacancy-logs", { signal }),
    refetchInterval: 30_000,
  });
}

export function useTriggerRegisterSync() {
  const qc = useQueryClient();
  return useMutation<TriggerSyncResponse, Error, void>({
    mutationFn: () =>
      customFetch<TriggerSyncResponse>("/api/admin/super/sync/trigger-register", {
        method: "POST",
      }),
    onSuccess: () => {
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: REGISTER_SYNC_LOGS_KEY });
      }, 3000);
    },
  });
}

export function useTriggerVacancySync() {
  const qc = useQueryClient();
  return useMutation<TriggerSyncResponse, Error, void>({
    mutationFn: () =>
      customFetch<TriggerSyncResponse>("/api/admin/super/sync/trigger-vacancy", {
        method: "POST",
      }),
    onSuccess: () => {
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: VACANCY_SYNC_LOGS_KEY });
      }, 3000);
    },
  });
}
