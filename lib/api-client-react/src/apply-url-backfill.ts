import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface BackfillRunSummary {
  found: number;
  skipped: number;
  failed: number;
  total: number;
  ranAt: string;
  triggeredBy: "scheduler" | "manual";
  durationMs: number;
}

export interface BackfillStatusResponse {
  lastRun: BackfillRunSummary | null;
}

export interface TriggerBackfillResponse {
  queued: true;
}

const BACKFILL_STATUS_KEY = ["admin", "roles", "backfill-status"] as const;
const SPONSOR_VACANCY_BACKFILL_STATUS_KEY = ["admin", "sponsor-vacancies", "backfill-status"] as const;

export function getBackfillStatusQueryKey() {
  return BACKFILL_STATUS_KEY;
}

export function getSponsorVacancyBackfillStatusQueryKey() {
  return SPONSOR_VACANCY_BACKFILL_STATUS_KEY;
}

export function useGetApplyUrlBackfillStatus() {
  return useQuery<BackfillStatusResponse>({
    queryKey: BACKFILL_STATUS_KEY,
    queryFn: ({ signal }) =>
      customFetch<BackfillStatusResponse>(
        "/api/admin/roles/backfill-apply-urls/status",
        { signal },
      ),
    refetchInterval: 15_000,
  });
}

export function useTriggerApplyUrlBackfill() {
  const qc = useQueryClient();
  return useMutation<TriggerBackfillResponse, Error, void>({
    mutationFn: () =>
      customFetch<TriggerBackfillResponse>(
        "/api/admin/roles/backfill-apply-urls",
        { method: "POST" },
      ),
    onSuccess: () => {
      // Poll for updated status after a short delay
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: BACKFILL_STATUS_KEY });
      }, 3000);
    },
  });
}

export function useGetSponsorVacancyBackfillStatus() {
  return useQuery<BackfillStatusResponse>({
    queryKey: SPONSOR_VACANCY_BACKFILL_STATUS_KEY,
    queryFn: ({ signal }) =>
      customFetch<BackfillStatusResponse>(
        "/api/admin/sponsor-vacancies/backfill-apply-urls/status",
        { signal },
      ),
    refetchInterval: 15_000,
  });
}

export function useTriggerSponsorVacancyBackfill() {
  const qc = useQueryClient();
  return useMutation<TriggerBackfillResponse, Error, void>({
    mutationFn: () =>
      customFetch<TriggerBackfillResponse>(
        "/api/admin/sponsor-vacancies/backfill-apply-urls",
        { method: "POST" },
      ),
    onSuccess: () => {
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: SPONSOR_VACANCY_BACKFILL_STATUS_KEY });
      }, 3000);
    },
  });
}
