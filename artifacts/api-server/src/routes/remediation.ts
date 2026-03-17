import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  remediationPlansTable,
  remediationStepsTable,
  decisionRecordsTable,
  rulesetRulesTable,
  profilesTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { generateRemediationSteps } from "../lib/remediationGenerator";

const router: IRouter = Router();

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

    res.json({ ...existingPlan, steps });
    return;
  }

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  let matchedRule = null;
  if (decision.reasonCodes.length > 0 && decision.reasonCodes[0] !== "NO_RULE_MATCHED") {
    const reasonCode = decision.reasonCodes[0];
    const [rule] = await db
      .select()
      .from(rulesetRulesTable)
      .where(
        and(
          eq(rulesetRulesTable.rulesetId, decision.rulesetId),
          eq(rulesetRulesTable.reasonCode, reasonCode)
        )
      )
      .limit(1);
    matchedRule = rule ?? null;
  }

  const requiresSponsorship = profile?.requiresSponsorship ?? false;
  const stepDrafts = generateRemediationSteps(decision, matchedRule, requiresSponsorship);

  const [plan] = await db
    .insert(remediationPlansTable)
    .values({ userId, decisionRecordId: decision.id })
    .returning();

  const insertedSteps = await db
    .insert(remediationStepsTable)
    .values(
      stepDrafts.map((s) => ({
        planId: plan.id,
        stepOrder: s.stepOrder,
        title: s.title,
        description: s.description,
        gap: s.gap,
        timelineRange: s.timelineRange,
        costRange: s.costRange,
        ruleId: s.ruleId,
        rulesetVersion: s.rulesetVersion,
        status: "planned" as const,
      }))
    )
    .returning();

  res.json({ ...plan, steps: insertedSteps });
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
