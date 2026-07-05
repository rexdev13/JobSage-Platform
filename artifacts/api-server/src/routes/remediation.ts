import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  remediationPlansTable,
  remediationStepsTable,
  decisionRecordsTable,
  rulesetRulesTable,
  profilesTable,
  rolesTable,
} from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import { generateRemediationSteps } from "../lib/remediationGenerator";
import { requireAuthenticated } from "../middlewares/requireRole";

const REGISTERED_STATUSES = ["registered", "fully_registered", "full_registration"];

function parseMonthsFromRange(range: string | null): number {
  if (!range) return 0;
  const nums = range.match(/\d+(\.\d+)?/g);
  if (!nums || nums.length === 0) return 0;
  const values = nums.map(Number);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function regulatorForProfession(profession: string): "GMC" | "NMC" | "HCPC" | null {
  if (profession === "doctor" || profession === "clinical_academic") return "GMC";
  if (profession === "nurse" || profession === "midwife") return "NMC";
  if (profession === "allied_health_professional") return "HCPC";
  return null;
}

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

router.get("/remediation/plan", requireAuthenticated, async (req, res): Promise<void> => {
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
    const rawSteps = await db
      .select()
      .from(remediationStepsTable)
      .where(eq(remediationStepsTable.planId, existingPlan.id))
      .orderBy(remediationStepsTable.stepOrder);

    const orderedIds = existingPlan.orderedStepIds as number[] | null;
    const steps =
      orderedIds && orderedIds.length > 0
        ? orderedIds
            .map((id) => rawSteps.find((s) => s.id === id))
            .filter(Boolean)
            .concat(rawSteps.filter((s) => !orderedIds.includes(s.id))) as typeof rawSteps
        : rawSteps;

    res.json({
      ...existingPlan,
      steps,
      reviewFlagged: decision.reviewFlagged === 1,
      reviewComplete: decision.reviewFlagged === 2,
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
    reviewComplete: decision.reviewFlagged === 2,
    reviewNote: decision.reviewNote ?? null,
  });
});

router.patch("/remediation/plans/:id/ordering", requireAuthenticated, async (req, res): Promise<void> => {
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

router.patch("/remediation/steps/:id", requireAuthenticated, async (req, res): Promise<void> => {
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

router.get("/remediation/forward-eligibility", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  if (!profile) {
    res.status(400).json({ error: "Profile not found." });
    return;
  }

  const regulator = regulatorForProfession(profile.profession);
  if (!regulator) {
    res.status(400).json({ error: "Could not determine regulatory body." });
    return;
  }

  const [latestPlan] = await db
    .select()
    .from(remediationPlansTable)
    .where(eq(remediationPlansTable.userId, userId))
    .orderBy(desc(remediationPlansTable.id))
    .limit(1);

  let remainingSteps: typeof remediationStepsTable.$inferSelect[] = [];
  if (latestPlan) {
    remainingSteps = await db
      .select()
      .from(remediationStepsTable)
      .where(and(
        eq(remediationStepsTable.planId, latestPlan.id),
      ))
      .orderBy(remediationStepsTable.stepOrder);
  }

  const incompleteSteps = remainingSteps.filter((s) => s.status !== "done");
  const totalMonths = incompleteSteps.reduce((sum, s) => sum + parseMonthsFromRange(s.timelineRange), 0);
  const roundedMonths = Math.round(totalMonths);

  const allRoles = await db
    .select()
    .from(rolesTable)
    .where(eq(rolesTable.active, true));

  const regulatorRoles = allRoles.filter((r) => r.regulator === regulator);

  const isCurrentlyRegistered =
    profile.registrationStatus != null &&
    REGISTERED_STATUSES.includes(profile.registrationStatus.toLowerCase());
  const isCurrentlyLicenceReady = profile.licenceReady === true;

  // Determine whether completing the remediation plan would lead to registration.
  // We look for steps in the plan that address registration gaps (e.g. PLAB, OSCE, licence steps).
  const hasRegistrationPlanSteps = incompleteSteps.some(
    (s) =>
      s.gap?.toLowerCase().includes("registrat") ||
      s.title?.toLowerCase().includes("registrat") ||
      s.title?.toLowerCase().includes("plab") ||
      s.title?.toLowerCase().includes("osce") ||
      s.title?.toLowerCase().includes("licence") ||
      s.stepSource === "registration"
  );

  // After completing the plan the candidate would be considered registration-ready if:
  //   - they already are, OR
  //   - they have explicit registration steps in the plan
  const wouldBeRegisteredAfterPlan =
    isCurrentlyRegistered || isCurrentlyLicenceReady || hasRegistrationPlanSteps;

  const newlyUnlockedRoles = regulatorRoles.filter((role) => {
    const reqReg = role.requiredRegistration.toLowerCase();
    const roleRequiresFull = reqReg.includes("full") || reqReg.includes("registered");

    const currentlyEligible = !roleRequiresFull || isCurrentlyRegistered || isCurrentlyLicenceReady;
    const futureEligible = !roleRequiresFull || wouldBeRegisteredAfterPlan;

    return !currentlyEligible && futureEligible;
  });

  const professionLabel = profile.profession.replace(/_/g, " ");

  let timeToEligibilityLabel: string;
  if (roundedMonths === 0) {
    timeToEligibilityLabel = "You may already be close to eligibility";
  } else if (roundedMonths === 1) {
    timeToEligibilityLabel = "approximately 1 month";
  } else if (roundedMonths < 12) {
    timeToEligibilityLabel = `approximately ${roundedMonths} months`;
  } else {
    const years = Math.round((roundedMonths / 12) * 10) / 10;
    timeToEligibilityLabel = `approximately ${years} year${years !== 1 ? "s" : ""}`;
  }

  // Build per-gap grouped data for the Unlock More UI
  // Each incomplete step gets 2–3 sample roles from the newly unlocked set
  const unlockableRolesSample = newlyUnlockedRoles.slice(0, 9).map((role) => ({
    id: role.id,
    title: role.title,
    employer: role.employer,
    location: role.location,
    sponsorshipOffered: role.sponsorshipOffered,
    requiredRegistration: role.requiredRegistration,
  }));

  const gapsWithRoles = incompleteSteps.map((step, idx) => {
    // Distribute the unlockable roles across steps (round-robin 2–3 per step)
    const chunkSize = 2;
    const start = (idx * chunkSize) % Math.max(1, unlockableRolesSample.length);
    const chunk = unlockableRolesSample.slice(start, start + chunkSize);
    // Wrap around if needed
    const rolesForStep = chunk.length < chunkSize && unlockableRolesSample.length > 0
      ? [...chunk, ...unlockableRolesSample.slice(0, chunkSize - chunk.length)]
      : chunk;

    return {
      stepId: step.id,
      title: step.title,
      gap: step.gap ?? null,
      timelineRange: step.timelineRange,
      stepSource: step.stepSource,
      estimatedMonths: parseMonthsFromRange(step.timelineRange),
      sampleRolesUnlocked: rolesForStep,
    };
  });

  res.json({
    profession: professionLabel,
    regulator,
    timeToEligibilityMonths: roundedMonths,
    timeToEligibilityLabel,
    incompleteStepCount: incompleteSteps.length,
    newlyUnlockedRoles: newlyUnlockedRoles.map((role) => ({
      id: role.id,
      title: role.title,
      employer: role.employer,
      location: role.location,
      sponsorshipOffered: role.sponsorshipOffered,
      requiredRegistration: role.requiredRegistration,
    })),
    gapsWithRoles,
    disclaimer:
      "Time estimates are indicative and based on step timeline ranges. Actual timelines vary by individual circumstance and regulatory body decisions.",
  });
});

export default router;
