import { db } from "@workspace/db";
import { sponsorLicencesTable, vacancySyncLogTable } from "@workspace/db";
import { runVacancyCheck } from "./vacancyCheckHelper";
import { rescoreVacanciesForUser, rescoreVacanciesForAllUsers } from "./sponsorVacancyScoring";
import type { VacancySyncTriggeredBy } from "./vacancyCheckScheduler";

export interface CheckAllStatus {
  isRunning: boolean;
  total: number;
  processed: number;
  newChecks: number;
  cacheHits: number;
  errors: number;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  triggeredBy: VacancySyncTriggeredBy | null;
}

function initialState(): CheckAllStatus {
  return {
    isRunning: false,
    total: 0,
    processed: 0,
    newChecks: 0,
    cacheHits: 0,
    errors: 0,
    startedAt: null,
    completedAt: null,
    lastError: null,
    triggeredBy: null,
  };
}

let state: CheckAllStatus = initialState();

export function getCheckAllStatus(): CheckAllStatus {
  return { ...state };
}

const CONCURRENCY = 15;

async function checkAllOrganisations(): Promise<{ checked: number; cacheHits: number; errors: number; lastError: string | null }> {
  const orgs = await db.selectDistinct({ organisationName: sponsorLicencesTable.organisationName }).from(sponsorLicencesTable);
  state.total = orgs.length;

  let idx = 0;
  let checked = 0;
  let cacheHits = 0;
  let errors = 0;
  let lastError: string | null = null;

  async function worker(): Promise<void> {
    while (idx < orgs.length) {
      const myIdx = idx++;
      const org = orgs[myIdx];
      if (!org) continue;
      try {
        const result = await runVacancyCheck(org.organisationName);
        if (result.fromCache) cacheHits++;
        else checked++;
      } catch (err) {
        errors++;
        lastError = err instanceof Error ? err.message : String(err);
        console.error(`[check-all-vacancies] Failed for "${org.organisationName}":`, lastError);
      }
      state.processed++;
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, orgs.length || 1) }, () => worker()));

  return { checked, cacheHits, errors, lastError };
}

/**
 * Run one full pass: check vacancies for every sponsor licence org (leveraging the
 * existing 24h cache in runVacancyCheck), then rescore vacancies for the requesting
 * candidate and/or all candidates, then log the outcome. Throws if a pass is already
 * running so callers (manual or scheduled) don't stomp on shared progress state.
 */
export async function runCheckAllVacanciesPass(
  triggeredBy: VacancySyncTriggeredBy,
  opts: { rescoreUserId?: string; rescoreAllUsers?: boolean } = {},
): Promise<void> {
  if (state.isRunning) {
    throw new Error("A vacancy check pass is already running.");
  }

  state = { ...initialState(), isRunning: true, startedAt: new Date().toISOString(), triggeredBy };
  const startMs = Date.now();

  try {
    const { checked, cacheHits, errors, lastError } = await checkAllOrganisations();
    state.newChecks = checked;
    state.cacheHits = cacheHits;
    state.errors = errors;
    state.lastError = lastError;

    if (opts.rescoreUserId) {
      try {
        await rescoreVacanciesForUser(opts.rescoreUserId);
      } catch (err) {
        console.error("[check-all-vacancies] Rescoring for requesting user failed:", err instanceof Error ? err.message : err);
      }
    }

    if (opts.rescoreAllUsers) {
      try {
        await rescoreVacanciesForAllUsers();
      } catch (err) {
        console.error("[check-all-vacancies] Rescoring for all users failed:", err instanceof Error ? err.message : err);
      }
    }

    const durationMs = Date.now() - startMs;
    const status = errors > 0 && checked === 0 && cacheHits === 0 ? "error" : "success";

    await db
      .insert(vacancySyncLogTable)
      .values({
        status,
        batchSize: state.total,
        checkedCount: checked,
        cacheHitCount: cacheHits,
        errorCount: errors,
        errorMessage: lastError ? lastError.slice(0, 2000) : null,
        triggeredBy,
        durationMs,
      })
      .catch((err) => console.error("[check-all-vacancies] Failed to write sync log:", err));

    console.log(
      `[check-all-vacancies] Pass complete (${triggeredBy}) — new checks: ${checked}, cache hits: ${cacheHits}, errors: ${errors}, ${durationMs}ms`,
    );
  } finally {
    state.isRunning = false;
    state.completedAt = new Date().toISOString();
  }
}

/**
 * Fire-and-forget entry point for the manual "Check All Vacancies" button.
 * Returns immediately; progress is polled via getCheckAllStatus().
 */
export function startCheckAllVacancies(userId: string): { started: boolean } {
  if (state.isRunning) return { started: false };

  void runCheckAllVacanciesPass("manual", { rescoreUserId: userId }).catch((err) => {
    console.error("[check-all-vacancies] Unhandled error during manual pass:", err instanceof Error ? err.message : err);
  });

  return { started: true };
}
