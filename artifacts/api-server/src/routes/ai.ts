import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { remediationPlansTable, remediationStepsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { prioritiseRemediationSteps } from "../lib/aiPrioritiser";

const router: IRouter = Router();

const DISCLAIMER =
  "This platform provides decision support only. Final decisions rest with the relevant regulator. AI-generated suggestions should be reviewed alongside professional advice.";

router.get("/ai/remediation-suggestions/:planId", requireAuthenticated, async (req, res): Promise<void> => {
  const planId = parseInt(req.params.planId as string, 10);
  if (isNaN(planId)) {
    res.status(400).json({ error: "Invalid planId." });
    return;
  }

  const [plan] = await db
    .select()
    .from(remediationPlansTable)
    .where(
      and(
        eq(remediationPlansTable.id, planId),
        eq(remediationPlansTable.userId, req.user!.id)
      )
    )
    .limit(1);

  if (!plan) {
    res.status(404).json({ error: "Remediation plan not found." });
    return;
  }

  const steps = await db
    .select()
    .from(remediationStepsTable)
    .where(eq(remediationStepsTable.planId, plan.id))
    .orderBy(remediationStepsTable.stepOrder);

  if (steps.length === 0) {
    res.json({
      planId: plan.id,
      suggestions: [],
      overallRationale: "No steps found in this plan.",
      disclaimer: DISCLAIMER,
    });
    return;
  }

  try {
    const result = await prioritiseRemediationSteps(plan.id, steps);
    res.json({
      planId: plan.id,
      suggestions: result.suggestions,
      overallRationale: result.overallRationale,
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    console.error("AI suggestion error:", err);
    res.status(500).json({ error: "AI service unavailable. Please try again later." });
  }
});

export default router;
