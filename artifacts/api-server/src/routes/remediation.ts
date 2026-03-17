import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  remediationPlansTable,
  remediationStepsTable,
  decisionRecordsTable,
  rulesetRulesTable,
  profilesTable,
} from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import { generateRemediationSteps } from "../lib/remediationGenerator";

const router: IRouter = Router();

export async function ensureRemediationPlan(
  userId: string,
  decisionId: number
): Promise<void> {
  const [decision] = await db
    .select()
    .from(decisionRecordsTable)
    .where(eq(decisionRecordsTable.id, decisionId));

  if (!decision || decision.outcome === "eligible") return;

  const [existing] = await db
    .select()
    .from(remediationPlansTable)
    .where(
      and(
        eq(remediationPlansTable.userId, userId),
        eq(remediationPlansTable.decisionRecordId, decisionId)
      )
    )
    .limit(1);

  if (existing) return;

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  const nonGenericReasonCodes = decision.reasonCodes.filter(
    (rc) => rc !== "NO_RULE_MATCHED" && rc !== "REVIEW_FLAGGED"
  );

  let matchedRules: typeof rulesetRulesTable.$inferSelect[] = [];
  if (nonGenericReasonCodes.length > 0) {
    matchedRules = await db
      .select()
      .from(rulesetRulesTable)
      .where(
        and(
          eq(rulesetRulesTable.rulesetId, decision.rulesetId),
          inArray(rulesetRulesTable.reasonCode, nonGenericReasonCodes)
        )
      );
  }

  const requiresSponsorship = profile?.requiresSponsorship ?? false;
  const stepDrafts = generateRemediationSteps(decision, matchedRules, requiresSponsorship);

  const [plan] = await db
    .insert(remediationPlansTable)
    .values({ userId, decisionRecordId: decision.id })
    .returning();

  if (stepDrafts.length > 0) {
    await db.insert(remediationStepsTable).values(
      stepDrafts.map((s) => ({
        planId: plan.id,
        stepOrder: s.stepOrder,
        title: s.title,
        description: s.description,
        gap: s.gap,
        pathway: s.pathway,
        timelineRange: s.timelineRange,
        costRange: s.costRange,
        stepSource: s.stepSource,
        ruleId: s.ruleId ?? null,
        rulesetVersion: s.rulesetVersion,
        status: "planned" as const,
      }))
    );
  }
}

router.get("/remediation/plan", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const userId = req.user!.id;

  const [decision] = await db
    .select()
    .from(decisionRecordsTable)
    .where(eq(decisionRecordsTable.userId, userId))
    .orderBy(desc(decisionRecordsTable.createdAt))
    .limit(1);

  if (!decision) {
    res.status(404).json({ error: "No eligibility assessment found. Please run your eligibility check first." });
    return;
  }

  if (decision.outcome === "eligible") {
    res.status(404).json({
      error: "You are eligible for UK registration. No remediation plan is required.",
    });
    return;
  }

  const [existingPlan] = await db
    .select()
    .from(remediationPlansTable)
    .where(
      and(
        eq(remediationPlansTable.userId, userId),
        eq(remediationPlansTable.decisionRecordId, decision.id)
      )
    )
    .limit(1);

  if (existingPlan) {
    const steps = await db
      .select()
      .from(remediationStepsTable)
      .where(eq(remediationStepsTable.planId, existingPlan.id))
      .orderBy(remediationStepsTable.stepOrder);

    res.json({
      ...existingPlan,
      steps,
      reviewFlagged: decision.reviewFlagged === 1,
      reviewNote: decision.reviewNote ?? null,
    });
    return;
  }

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  const nonGenericReasonCodes = decision.reasonCodes.filter(
    (rc) => rc !== "NO_RULE_MATCHED" && rc !== "REVIEW_FLAGGED"
  );

  let matchedRules: typeof rulesetRulesTable.$inferSelect[] = [];
  if (nonGenericReasonCodes.length > 0) {
    matchedRules = await db
      .select()
      .from(rulesetRulesTable)
      .where(
        and(
          eq(rulesetRulesTable.rulesetId, decision.rulesetId),
          inArray(rulesetRulesTable.reasonCode, nonGenericReasonCodes)
        )
      );
  }

  const requiresSponsorship = profile?.requiresSponsorship ?? false;
  const stepDrafts = generateRemediationSteps(decision, matchedRules, requiresSponsorship);

  const [plan] = await db
    .insert(remediationPlansTable)
    .values({ userId, decisionRecordId: decision.id })
    .returning();

  const insertedSteps =
    stepDrafts.length > 0
      ? await db
          .insert(remediationStepsTable)
          .values(
            stepDrafts.map((s) => ({
              planId: plan.id,
              stepOrder: s.stepOrder,
              title: s.title,
              description: s.description,
              gap: s.gap,
              pathway: s.pathway,
              timelineRange: s.timelineRange,
              costRange: s.costRange,
              stepSource: s.stepSource,
              ruleId: s.ruleId ?? null,
              rulesetVersion: s.rulesetVersion,
              status: "planned" as const,
            }))
          )
          .returning()
      : [];

  res.json({
    ...plan,
    steps: insertedSteps,
    reviewFlagged: decision.reviewFlagged === 1,
    reviewNote: decision.reviewNote ?? null,
  });
});

router.patch("/remediation/plans/:id/ordering", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const planId = parseInt(req.params.id as string, 10);
  if (isNaN(planId)) {
    res.status(400).json({ error: "Invalid planId." });
    return;
  }

  const { stepOrder } = req.body as { stepOrder?: unknown };
  if (!Array.isArray(stepOrder) || !stepOrder.every((x) => typeof x === "number")) {
    res.status(400).json({ error: "stepOrder must be an array of step IDs." });
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

  const [updated] = await db
    .update(remediationPlansTable)
    .set({ orderedStepIds: stepOrder as number[] })
    .where(eq(remediationPlansTable.id, planId))
    .returning();

  const steps = await db
    .select()
    .from(remediationStepsTable)
    .where(eq(remediationStepsTable.planId, planId))
    .orderBy(remediationStepsTable.stepOrder);

  res.json({ ...updated, steps });
});

router.patch("/remediation/steps/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid step id." });
    return;
  }

  const { status } = req.body as { status?: string };
  if (!status || !["planned", "in_progress", "done"].includes(status)) {
    res.status(400).json({ error: "status must be one of: planned, in_progress, done" });
    return;
  }

  const [step] = await db
    .select()
    .from(remediationStepsTable)
    .where(eq(remediationStepsTable.id, id));

  if (!step) {
    res.status(404).json({ error: "Remediation step not found." });
    return;
  }

  const [plan] = await db
    .select()
    .from(remediationPlansTable)
    .where(eq(remediationPlansTable.id, step.planId));

  if (!plan || plan.userId !== req.user!.id) {
    res.status(404).json({ error: "Remediation step not found." });
    return;
  }

  const [updated] = await db
    .update(remediationStepsTable)
    .set({ status: status as "planned" | "in_progress" | "done" })
    .where(eq(remediationStepsTable.id, id))
    .returning();

  res.json(updated);
});

export default router;
