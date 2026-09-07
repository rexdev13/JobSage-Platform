import { Router, type Request, type Response } from "express";
import {
  runVacancyJob,
  type VacancyJobKind,
} from "../lib/vacancyJobRunner";
import { getVacancyAiWebSearchDailyCap } from "../lib/vacancyAiBudget";

const router = Router();

/**
 * Company-site checks can involve several politely paced requests per employer.
 * Keep the awaited HTTP batch at five so free cron clients with a 30-second
 * timeout receive the final response comfortably before their deadline.
 */
export const DEFAULT_COMPANY_SITE_HTTP_BATCH_SIZE = 5;

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
    liveness: 100,
    contact: 5,
  };
}

function getHttpMaxLimits(): Record<VacancyJobKind, number> {
  return {
    job_board: 50,
    company_site: getCompanySiteHttpBatchSize(),
    liveness: 120,
    contact: 5,
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
    requestedKind !== "liveness" &&
    requestedKind !== "contact"
  ) {
    res.status(400).json({ error: "kind must be job_board, company_site, liveness, or contact." });
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

  try {
    const summary = await runVacancyJob(kind, limit);
    if (!summary) {
      res.status(409).json({ error: "Another vacancy pipeline batch is already running." });
      return;
    }
    res.status(200).json(summary);
  } catch (error) {
    console.error(
      `[vacancy-job-http] kind=${kind} failed:`,
      error instanceof Error ? error.message : error,
    );
    res.status(500).json({
      selected: 0,
      upserted: 0,
      live: 0,
      dead: 0,
      inconclusive: 0,
      errors: 1,
      done: false,
    });
  }
});

export default router;