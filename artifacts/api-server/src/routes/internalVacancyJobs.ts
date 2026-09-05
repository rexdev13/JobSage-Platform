import { Router, type Request, type Response } from "express";
import {
  runVacancyJob,
  type VacancyJobKind,
} from "../lib/vacancyJobRunner";
import { getVacancyAiWebSearchDailyCap } from "../lib/vacancyAiBudget";

const router = Router();

const HTTP_DEFAULT_LIMITS: Record<VacancyJobKind, number> = {
  job_board: 50,
  company_site: 30,
  liveness: 100,
  contact: 5,
};

const HTTP_MAX_LIMITS: Record<VacancyJobKind, number> = {
  job_board: 50,
  company_site: 40,
  liveness: 120,
  contact: 5,
};

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
    requestedLimit ?? HTTP_DEFAULT_LIMITS[kind],
    HTTP_MAX_LIMITS[kind],
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