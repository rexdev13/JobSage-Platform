import { Router, type Request, type Response } from "express";
import {
  LIVENESS_HTTP_BUDGET_MS,
  PROFESSION_BACKFILL_HTTP_BUDGET_MS,
  PROFESSION_BACKFILL_HTTP_CATEGORY_LIMIT,
  PROFESSION_BACKFILL_HTTP_MAX_CATEGORY_LIMIT,
  FREE_BOARD_HTTP_BUDGET_MS,
  runVacancyJob,
  isFreeBoardSourceId,
  type VacancyJobKind,
} from "../lib/vacancyJobRunner";
import { getVacancyAiWebSearchDailyCap } from "../lib/vacancyAiBudget";
import {
  COMPANY_SITE_PROBE_BATCH_SIZE,
  COMPANY_SITE_PROBE_HTTP_BUDGET_MS,
} from "../lib/companySiteProbe";

const router = Router();

/**
 * Company-site checks can involve several politely paced requests per employer.
 * Ten concurrent employer slots fit inside the bounded API-side HTTP window
 * while giving this slower source materially more coverage than board search.
 */
export const DEFAULT_COMPANY_SITE_HTTP_BATCH_SIZE = 10;

export function getCompanySiteHttpBatchSize(): number {
  const configured = Number.parseInt(process.env["COMPANY_SITE_BATCH_SIZE"] ?? "", 10);
  return Number.isFinite(configured) && configured >= 1 && configured <= DEFAULT_COMPANY_SITE_HTTP_BATCH_SIZE
    ? configured
    : DEFAULT_COMPANY_SITE_HTTP_BATCH_SIZE;
}

function getHttpDefaultLimits(): Record<VacancyJobKind, number> {
  return {
    job_board: 50,
    company_site: getCompanySiteHttpBatchSize(),
    company_site_direct_feed: Math.min(5, getCompanySiteHttpBatchSize()),
    company_site_probe: COMPANY_SITE_PROBE_BATCH_SIZE,
    liveness: 50,
    contact: 5,
    reed_professions: PROFESSION_BACKFILL_HTTP_CATEGORY_LIMIT,
    additional_boards: PROFESSION_BACKFILL_HTTP_CATEGORY_LIMIT,
    free_board_sources: 2,
    free_source_ats: 5,
  };
}

function getHttpMaxLimits(): Record<VacancyJobKind, number> {
  return {
    job_board: 50,
    company_site: getCompanySiteHttpBatchSize(),
    company_site_direct_feed: getCompanySiteHttpBatchSize(),
    company_site_probe: COMPANY_SITE_PROBE_BATCH_SIZE,
    liveness: 50,
    contact: 5,
    reed_professions: PROFESSION_BACKFILL_HTTP_MAX_CATEGORY_LIMIT,
    additional_boards: PROFESSION_BACKFILL_HTTP_MAX_CATEGORY_LIMIT,
    free_board_sources: 5,
    free_source_ats: 10,
  };
}

router.post("/internal/vacancy-jobs", async (req: Request, res: Response): Promise<void> => {
  const secret = process.env["VACANCY_JOB_SECRET"];
  if (!secret) {
    res.status(503).json({ error: "Vacancy job endpoint is not configured." });
    return;
  }
  if (req.headers["x-jobsage-job-secret"] !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (getVacancyAiWebSearchDailyCap() !== 0) {
    res.status(503).json({ error: "Vacancy jobs require the AI web-search cap to remain disabled." });
    return;
  }

  const requestedKind = req.body?.kind;
  if (
    requestedKind !== "job_board" &&
    requestedKind !== "company_site" &&
    requestedKind !== "company_site_direct_feed" &&
    requestedKind !== "company_site_probe" &&
    requestedKind !== "liveness" &&
    requestedKind !== "contact" &&
    requestedKind !== "reed_professions" &&
    requestedKind !== "additional_boards" &&
    requestedKind !== "free_board_sources" &&
    requestedKind !== "free_source_ats"
  ) {
    res.status(400).json({
      error: "kind must be job_board, company_site, company_site_direct_feed, company_site_probe, liveness, contact, reed_professions, additional_boards, free_board_sources, or free_source_ats.",
    });
    return;
  }
  const kind: VacancyJobKind = requestedKind;

  const requestedLimit = req.body?.limit;
  if (
    requestedLimit != null &&
    (!Number.isInteger(requestedLimit) || requestedLimit < 1)
  ) {
    res.status(400).json({ error: "limit must be a positive integer." });
    return;
  }
  const limit = Math.min(
    requestedLimit ?? getHttpDefaultLimits()[kind],
    getHttpMaxLimits()[kind],
  );

  const isProfessionBackfill =
    kind === "reed_professions" || kind === "additional_boards";
  const supportsCursor = isProfessionBackfill || kind === "free_source_ats";
  const requestedCursor = req.body?.cursor;
  if (
    supportsCursor &&
    requestedCursor != null &&
    (!Number.isInteger(requestedCursor) || requestedCursor < 0)
  ) {
    res.status(400).json({ error: "cursor must be a non-negative integer." });
    return;
  }
  if (!supportsCursor && requestedCursor != null) {
    res.status(400).json({ error: "cursor is only supported for profession backfills and reference ATS targets." });
    return;
  }

  const requestedSourceId = req.body?.sourceId;
  let sourceId: string | undefined;
  if (requestedSourceId != null) {
    if (
      kind !== "free_board_sources" ||
      typeof requestedSourceId !== "string" ||
      !isFreeBoardSourceId(requestedSourceId)
    ) {
      res.status(400).json({
        error: "sourceId must identify a registered feed and is only supported for free_board_sources.",
      });
      return;
    }
    sourceId = requestedSourceId;
  }

  let organisationNames: string[] | undefined;
  const requestedOrganisationNames = req.body?.organisationNames;
  if (requestedOrganisationNames != null) {
    const maximumNames = getHttpMaxLimits().company_site;
    if (kind !== "company_site" && kind !== "company_site_direct_feed") {
      res.status(400).json({
        error: "organisationNames is only supported for company_site or company_site_direct_feed jobs.",
      });
      return;
    }
    if (
      !Array.isArray(requestedOrganisationNames) ||
      requestedOrganisationNames.length < 1 ||
      requestedOrganisationNames.length > maximumNames ||
      requestedOrganisationNames.some(
        (name) => typeof name !== "string" || !name.trim(),
      )
    ) {
      res.status(400).json({
        error: `organisationNames must contain 1–${maximumNames} non-empty employer names.`,
      });
      return;
    }
    const cleanedNames = requestedOrganisationNames.map((name: string) => name.trim());
    const normalizedNames = cleanedNames.map((name: string) => name.toLowerCase());
    if (new Set(normalizedNames).size !== cleanedNames.length) {
      res.status(400).json({
        error: "organisationNames must not contain duplicate names.",
      });
      return;
    }
    organisationNames = cleanedNames;
  }

  try {
    const deadlineMs = kind === "company_site_probe"
      ? Date.now() + COMPANY_SITE_PROBE_HTTP_BUDGET_MS
      : kind === "liveness"
      ? Date.now() + LIVENESS_HTTP_BUDGET_MS
      : isProfessionBackfill
        ? Date.now() + PROFESSION_BACKFILL_HTTP_BUDGET_MS
        : kind === "free_board_sources"
          ? Date.now() + FREE_BOARD_HTTP_BUDGET_MS
        : undefined;
    const summary = isProfessionBackfill
      ? await runVacancyJob(kind, limit, {
        deadlineMs,
        cursor: requestedCursor ?? 0,
        categoryLimit: limit,
      })
      : kind === "free_source_ats"
        ? await runVacancyJob(kind, limit, { deadlineMs, cursor: requestedCursor ?? 0 })
      : organisationNames
        ? await runVacancyJob(kind, limit, { deadlineMs, organisationNames })
        : sourceId
          ? await runVacancyJob(kind, limit, { deadlineMs, sourceId })
        : await runVacancyJob(kind, limit, { deadlineMs });
    if (!summary) {
      res
        .status(409)
        .set("Retry-After", "30")
        .json({ error: "Another vacancy pipeline batch is already running." });
      return;
    }
    res.status(200).json(summary);
  } catch (error) {
    const deadlineReached =
      error instanceof Error && error.message === "VACANCY_JOB_DEADLINE";
    const safeError = kind === "company_site_direct_feed"
      ? deadlineReached ? "direct-feed deadline reached" : "direct-feed batch failed"
      : error instanceof Error ? error.message : error;
    console.error(
      `[vacancy-job-http] kind=${kind} failed:`,
      safeError,
    );
    if (deadlineReached) res.set("Retry-After", "30");
    res.status(deadlineReached ? 504 : 500).json({
      selected: 0,
      upserted: 0,
      live: 0,
      dead: 0,
      inconclusive: 0,
      errors: 1,
      done: false,
      ...(deadlineReached
        ? { error: "Vacancy batch reached its HTTP deadline and is finalizing safely." }
        : {}),
    });
  }
});

export default router;