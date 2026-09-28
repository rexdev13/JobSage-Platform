import { Router, type Request, type Response } from "express";
import multer from "multer";
import {
  runMappingApply,
  runMappingDryRun,
  runReadOnlyDiscovery,
} from "../lib/companySiteWorkflow";
import { loadWorkflowReport } from "../lib/companySiteWorkflowReports";

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