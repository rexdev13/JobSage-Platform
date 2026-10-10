import { Router, type Request, type Response } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import {
  applyReviewedPublicBoardCsv,
  previewReviewedPublicBoardCsv,
  REVIEWED_PUBLIC_BOARD_IMPORT_CONFIRMATION,
  REVIEWED_PUBLIC_BOARD_IMPORT_MAX_BYTES,
  ReviewedPublicBoardImportInputError,
  ReviewedPublicBoardImportTokenError,
} from "../lib/reviewedPublicBoardImport";
import {
  inspectReviewedPublicBoardRevalidationInput,
  revalidateReviewedPublicBoardCsv,
  ReviewedPublicBoardRevalidationInputError,
  type ReviewedPublicBoardRevalidationResult,
} from "../lib/reviewedPublicBoardRevalidation";
import { saveWorkflowReport } from "../lib/companySiteWorkflowReports";

const router = Router();
type RevalidationJob = {
  id: string;
  status: "running" | "complete" | "failed";
  createdAt: number;
  total: number;
  completed: number;
  currentHost: string;
  result?: ReviewedPublicBoardRevalidationResult;
  reportId?: string;
  reportSaveError?: string;
  error?: string;
};
const revalidationJobs = new Map<string, RevalidationJob>();
let activeRevalidationJobId: string | null = null;
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: REVIEWED_PUBLIC_BOARD_IMPORT_MAX_BYTES, files: 1, fields: 4 },
}).single("file");

function authenticate(req: Request, res: Response): boolean {
  const secret = process.env["VACANCY_JOB_SECRET"];
  if (!secret) {
    res.status(503).json({ error: "Internal vacancy workflow endpoint is not configured." });
    return false;
  }
  if (req.headers["x-jobsage-job-secret"] !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function authenticateMiddleware(req: Request, res: Response, next: () => void): void {
  if (authenticate(req, res)) next();
}

function requireReviewedImportEnabled(_req: Request, res: Response, next: () => void): void {
  if (process.env["SPONSOR_PUBLIC_BOARD_REVIEWED_IMPORT_ENABLED"] !== "true") {
    res.status(503).json({ error: "Reviewed public-board import is disabled." });
    return;
  }
  next();
}

function parseCsvUpload(req: Request, res: Response, next: () => void): void {
  csvUpload(req, res, (error) => {
    if (error) {
      res.status(400).json({
        error: `Reviewed public-board CSV is invalid or exceeds the ${REVIEWED_PUBLIC_BOARD_IMPORT_MAX_BYTES}-byte limit.`,
      });
      return;
    }
    next();
  });
}

function requireCsvFile(req: Request, res: Response): boolean {
  if (!req.file || !req.file.originalname.toLowerCase().endsWith(".csv")) {
    res.status(400).json({ error: "Attach the CSV as a .csv file named file." });
    return false;
  }
  return true;
}

function pruneRevalidationJobs(): void {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of revalidationJobs) {
    if (job.status !== "running" && job.createdAt < cutoff) revalidationJobs.delete(id);
  }
  while (revalidationJobs.size > 4) {
    const oldestFinished = [...revalidationJobs.values()]
      .filter((job) => job.status !== "running")
      .sort((left, right) => left.createdAt - right.createdAt)[0];
    if (!oldestFinished) break;
    revalidationJobs.delete(oldestFinished.id);
  }
}

router.post(
  "/internal/public-board-vacancies/revalidate",
  authenticateMiddleware,
  parseCsvUpload,
  async (req, res) => {
    if (!requireCsvFile(req, res)) return;
    pruneRevalidationJobs();
    if (activeRevalidationJobId) {
      res.status(409).json({ error: "A public-board URL revalidation job is already running." });
      return;
    }

    const input = req.file!.buffer;
    let totalRows: number;
    try {
      totalRows = inspectReviewedPublicBoardRevalidationInput(input).rows;
    } catch (error) {
      if (error instanceof ReviewedPublicBoardRevalidationInputError) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: "Public-board URL revalidation is not configured." });
      return;
    }

    const id = randomUUID();
    const job: RevalidationJob = {
      id,
      status: "running",
      createdAt: Date.now(),
      total: totalRows,
      completed: 0,
      currentHost: "",
    };
    revalidationJobs.set(id, job);
    activeRevalidationJobId = id;

    void revalidateReviewedPublicBoardCsv(input, (progress) => {
      job.completed = progress.completed;
      job.total = progress.total;
      job.currentHost = progress.currentHost;
    }).then(async (result) => {
      job.result = result;
      try {
        const saved = await saveWorkflowReport("dry-run", {
          workflow: "reviewed_public_board_url_revalidation",
          ...result,
        });
        job.reportId = typeof saved?.reportId === "string" ? saved.reportId : undefined;
      } catch {
        job.reportSaveError = "The completed CSV is available in this process, but its durable report could not be saved.";
      }
      job.status = "complete";
      if (activeRevalidationJobId === id) activeRevalidationJobId = null;
    }).catch((error: unknown) => {
      job.status = "failed";
      job.error = error instanceof Error
        ? error.message.slice(0, 300)
        : "Public-board URL revalidation failed.";
      if (activeRevalidationJobId === id) activeRevalidationJobId = null;
    });

    res.status(202).json({ jobId: id, status: "running", total: totalRows });
  },
);

router.get(
  "/internal/public-board-vacancies/revalidate/:jobId",
  authenticateMiddleware,
  (req, res) => {
    pruneRevalidationJobs();
    const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
    const job = revalidationJobs.get(jobId ?? "");
    if (!job) {
      res.status(404).json({ error: "Revalidation job not found or expired." });
      return;
    }
    res.status(job.status === "failed" ? 500 : 200).json({
      jobId: job.id,
      status: job.status,
      completed: job.completed,
      total: job.total,
      currentHost: job.currentHost,
      ...(job.result ? {
        inputSha256: job.result.inputSha256,
        outputSha256: job.result.outputSha256,
        hostCount: job.result.hostCount,
        counts: job.result.counts,
        completedAt: job.result.completedAt,
      } : {}),
      ...(job.reportId ? { reportId: job.reportId } : {}),
      ...(job.reportSaveError ? { reportSaveError: job.reportSaveError } : {}),
      ...(job.error ? { error: job.error } : {}),
    });
  },
);

router.get(
  "/internal/public-board-vacancies/revalidate/:jobId/download",
  authenticateMiddleware,
  (req, res) => {
    const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
    const job = revalidationJobs.get(jobId ?? "");
    if (!job) {
      res.status(404).json({ error: "Revalidation job not found or expired." });
      return;
    }
    if (job.status === "running") {
      res.status(409).json({ error: "Revalidation is still running." });
      return;
    }
    if (job.status !== "complete" || !job.result) {
      res.status(500).json({ error: job.error ?? "Revalidation did not produce a CSV." });
      return;
    }
    res
      .type("text/csv")
      .attachment(`public-board-revalidated-${job.id}.csv`)
      .send(job.result.csv);
  },
);

router.post(
  "/internal/public-board-vacancies/reviewed-import/dry-run",
  authenticateMiddleware,
  requireReviewedImportEnabled,
  parseCsvUpload,
  async (req, res) => {
    if (!requireCsvFile(req, res)) return;
    try {
      const preview = await previewReviewedPublicBoardCsv(req.file!.buffer);
      const { dryRunToken, tokenExpiresAt, ...auditableReport } = preview;
      const saved = await saveWorkflowReport("dry-run", {
        workflow: "reviewed_public_board_vacancy_import",
        ...auditableReport,
      });
      res.status(200).json({ ...saved, dryRunToken, tokenExpiresAt });
    } catch (error) {
      if (error instanceof ReviewedPublicBoardImportInputError) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: "Reviewed public-board dry-run failed; no vacancy rows were written." });
    }
  },
);

router.post(
  "/internal/public-board-vacancies/reviewed-import/apply",
  authenticateMiddleware,
  requireReviewedImportEnabled,
  parseCsvUpload,
  async (req, res) => {
    if (!requireCsvFile(req, res)) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.confirmApply !== REVIEWED_PUBLIC_BOARD_IMPORT_CONFIRMATION) {
      res.status(400).json({
        error: `apply requires confirmApply to equal "${REVIEWED_PUBLIC_BOARD_IMPORT_CONFIRMATION}".`,
      });
      return;
    }
    if (typeof body.dryRunToken !== "string" || body.dryRunToken.length > 4096) {
      res.status(400).json({ error: "A dry-run token for this exact file and target environment is required." });
      return;
    }

    let report: Awaited<ReturnType<typeof applyReviewedPublicBoardCsv>>;
    try {
      report = await applyReviewedPublicBoardCsv(req.file!.buffer, body.dryRunToken);
    } catch (error) {
      if (error instanceof ReviewedPublicBoardImportInputError) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof ReviewedPublicBoardImportTokenError) {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: "Reviewed public-board apply failed before the writer confirmed an outcome." });
      return;
    }

    try {
      const saved = await saveWorkflowReport("apply", {
        workflow: "reviewed_public_board_vacancy_import",
        ...report,
      });
      res.status(200).json(saved);
    } catch {
      res.status(500).json({
        error: "Apply returned, but the durable report could not be saved. Do not assume the vacancy transaction was rolled back.",
        applyResult: report,
      });
    }
  },
);

export default router;
