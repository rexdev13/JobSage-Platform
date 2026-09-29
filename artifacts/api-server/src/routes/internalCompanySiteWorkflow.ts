import { Router, type Request, type Response } from "express";
import multer from "multer";
import {
  runMappingApply,
  runMappingDryRun,
  runReadOnlyDiscovery,
} from "../lib/companySiteWorkflow";
import { loadWorkflowReport, saveWorkflowReport } from "../lib/companySiteWorkflowReports";
import { runHealthcareCompanySiteBatch } from "../lib/healthcareCompanySiteBatch";
import {
  HEALTHCARE_BATCH_APPLY_CONFIRMATION,
  HEALTHCARE_BATCH_DEFAULT_BUDGET_MS,
  NAMED_BATCH_APPLY_CONFIRMATION,
  parseHealthcareBatchEmployers,
  SCHEDULED_NAMED_BATCH_APPLY_CONFIRMATION,
  type CompanySiteBatchApplyMode,
} from "../lib/namedCompanySiteBatchPolicy";
import { parseStrictRolePageSector } from "../lib/healthcareRoleEvidence";

export { HEALTHCARE_BATCH_APPLY_CONFIRMATION } from "../lib/namedCompanySiteBatchPolicy";

const router = Router();
const reviewedMappingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1_000_000, files: 1, fields: 8 },
}).single("file");

function authenticate(req: Request, res: Response): boolean {
  const secret = process.env["VACANCY_JOB_SECRET"];
  if (!secret) {
    res.status(503).json({ error: "Internal workflow endpoint is not configured." });
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

function parseReviewedMappingUpload(req: Request, res: Response, next: () => void): void {
  reviewedMappingUpload(req, res, (error) => {
    if (error) {
      res.status(400).json({ error: "Reviewed mapping upload is invalid or exceeds the 1 MB limit." });
      return;
    }
    next();
  });
}

router.post("/internal/company-site-discovery/read-only", async (req, res) => {
  if (!authenticate(req, res)) return;
  try {
    res.status(200).json(await runReadOnlyDiscovery(req.body ?? {}));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Workflow failed." });
  }
});

router.post(
  "/internal/company-site-mappings/dry-run",
  authenticateMiddleware,
  parseReviewedMappingUpload,
  async (req, res) => {
  try {
    const input = { ...(req.body ?? {}) } as Record<string, unknown>;
    if (req.file) {
      if (!req.file.originalname.toLowerCase().endsWith(".json")) {
        res.status(400).json({ error: "Reviewed mapping upload must be a .json file." });
        return;
      }
      if (input.discoveryReportId !== undefined || input.reviewedMappingFile !== undefined) {
        res.status(400).json({ error: "Provide either a discovery report ID or one reviewed JSON file." });
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(req.file.buffer.toString("utf8"));
      } catch {
        res.status(400).json({ error: "Reviewed mapping file must contain valid JSON." });
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        !Array.isArray((parsed as Record<string, unknown>).records)) {
        res.status(400).json({ error: "Reviewed mapping JSON must contain a records array." });
        return;
      }
      input.reviewedMappingFile = parsed;
    }
    if (input.reviewed === "true") input.reviewed = true;
    if (input.allowVerifiedOverwrite === "true") input.allowVerifiedOverwrite = true;
    res.status(200).json(await runMappingDryRun(input));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Workflow failed." });
  }
  },
);

router.post("/internal/company-site-mappings/apply", async (req, res) => {
  if (!authenticate(req, res)) return;
  try {
    res.status(200).json(await runMappingApply(req.body ?? {}));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Workflow failed." });
  }
});

/**
 * Reviewed named-employer company-site batch. Sector defaults to healthcare so
 * the existing Kingsley cron body keeps working. Dry-run is read-only.
 * Human apply requires the healthcare or named confirmation string. Scheduled
 * apply uses a separate confirmation and refuses to write when discovery is
 * empty, paced, or missing a https apply/recruitment route.
 */
router.post("/internal/healthcare-company-site-batch", async (req, res) => {
  if (!authenticate(req, res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  let employers;
  let sector;
  try {
    employers = parseHealthcareBatchEmployers(body.employers);
    sector = parseStrictRolePageSector(body.sector);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid employers." });
    return;
  }
  const apply = body.apply === true;
  let applyMode: CompanySiteBatchApplyMode = "reviewed";
  if (apply) {
    if (body.confirmApply === SCHEDULED_NAMED_BATCH_APPLY_CONFIRMATION) {
      applyMode = "scheduled";
    } else if (body.confirmApply === NAMED_BATCH_APPLY_CONFIRMATION) {
      applyMode = "reviewed";
    } else if (body.confirmApply === HEALTHCARE_BATCH_APPLY_CONFIRMATION && sector === "healthcare") {
      applyMode = "reviewed";
    } else {
      res.status(400).json({
        error: `apply requires confirmApply to equal "${HEALTHCARE_BATCH_APPLY_CONFIRMATION}", "${NAMED_BATCH_APPLY_CONFIRMATION}", or "${SCHEDULED_NAMED_BATCH_APPLY_CONFIRMATION}".`,
      });
      return;
    }
  }
  const budgetMs = typeof body.budgetMs === "number" && Number.isInteger(body.budgetMs)
    ? Math.min(Math.max(body.budgetMs, 30_000), HEALTHCARE_BATCH_DEFAULT_BUDGET_MS)
    : HEALTHCARE_BATCH_DEFAULT_BUDGET_MS;
  try {
    const result = await runHealthcareCompanySiteBatch({ employers, apply, applyMode, sector, budgetMs });
    const report = await saveWorkflowReport(apply && !result.scheduledApplyBlocked ? "apply" : "dry-run", {
      mode: "named_company_site_batch",
      parameters: { employers, apply, applyMode, sector, budgetMs },
      ...result,
    });
    res.status(200).json(report);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Named company-site batch failed." });
  }
});

router.get("/internal/company-site-workflow/reports/:reportId", async (req, res) => {
  if (!authenticate(req, res)) return;
  try {
    const report = await loadWorkflowReport(req.params.reportId);
    if (!report) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    res.status(200).json(report);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Report retrieval failed." });
  }
});

export default router;