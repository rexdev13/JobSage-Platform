import { Router, type IRouter } from "express";
import { createHash } from "crypto";
import { eq, and, desc, lte } from "drizzle-orm";
import { db, profilesTable, rulesetsTable, rulesetRulesTable, decisionRecordsTable, reviewCasesTable } from "@workspace/db";
import { requireConsent } from "../middlewares/consentMiddleware";
import { evaluate } from "../lib/rulesEngine";
import { ensureRemediationPlan } from "./remediation";
import type { Profile } from "@workspace/db";

const router: IRouter = Router();

function regulatorForProfession(profession: string): "GMC" | "NMC" | "HCPC" | null {
  if (profession === "doctor" || profession === "clinical_academic") return "GMC";
  if (profession === "nurse" || profession === "midwife") return "NMC";
  if (profession === "allied_health_professional") return "HCPC";
  return null;
}

function hashProfile(profile: Profile): string {
  const snapshot = JSON.stringify({
    profession: profile.profession,
    specialty: profile.specialty,
    qualificationCountry: profile.qualificationCountry,
    qualificationType: profile.qualificationType,
    qualificationYear: profile.qualificationYear,
    experienceYears: profile.experienceYears,
    registrationStatus: profile.registrationStatus,
    licenceReady: profile.licenceReady,
    residencyStatus: profile.residencyStatus,
    requiresSponsorship: profile.requiresSponsorship,
  });
  return createHash("sha256").update(snapshot).digest("hex");
}

router.post("/eligibility/evaluate", requireConsent, async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;

  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId));
  if (!profile) {
    res.status(400).json({ error: "Profile not found. Please complete your profile before running an eligibility check." });
    return;
  }

  const regulator = regulatorForProfession(profile.profession);
  if (!regulator) {
    res.status(400).json({ error: "Could not determine regulatory body from your profession." });
    return;
  }

  const now = new Date();
  const publishedRulesets = await db
    .select()
    .from(rulesetsTable)
    .where(
      and(
        eq(rulesetsTable.regulator, regulator),
        eq(rulesetsTable.status, "published"),
        lte(rulesetsTable.effectiveDate, now)
      )
    )
    .orderBy(desc(rulesetsTable.effectiveDate), desc(rulesetsTable.createdAt));

  if (publishedRulesets.length === 0) {
    res.status(400).json({ error: `No published ruleset found for ${regulator}. Please contact support.` });
    return;
  }

  const ruleset = publishedRulesets[0];
  const rules = await db.select().from(rulesetRulesTable).where(eq(rulesetRulesTable.rulesetId, ruleset.id));

  const profileSnapshotHash = hashProfile(profile);
  const result = evaluate(profile, rules);

  const [decision] = await db
    .insert(decisionRecordsTable)
    .values({
      userId,
      profileSnapshotHash,
      rulesetId: ruleset.id,
      rulesetVersion: ruleset.version,
      outcome: result.outcome,
      reasonCodes: result.reasonCodes,
      explanationText: result.explanationText,
      pathways: result.pathways.length > 0 ? result.pathways : null,
      reviewFlagged: result.reviewFlagged ? 1 : 0,
      reviewNote: result.reviewNote,
    })
    .returning();

  if (decision.outcome === "not_eligible" || decision.outcome === "ineligible") {
    ensureRemediationPlan(userId, decision.id).catch((err) =>
      console.error("[remediation] auto-generation failed:", err)
    );
  }

  if (decision.reviewFlagged === 1) {
    db.insert(reviewCasesTable)
      .values({
        userId,
        decisionRecordId: decision.id,
        flagReason: result.reviewNote ?? "Ambiguous case flagged for human review",
        status: "pending",
      })
      .catch((err) => console.error("[review] auto-flag insert failed:", err));
  }

  res.json({
    id: decision.id,
    userId: decision.userId,
    outcome: decision.outcome,
    explanationText: decision.explanationText,
    reasonCodes: decision.reasonCodes,
    pathways: decision.pathways ?? null,
    rulesetId: decision.rulesetId,
    rulesetVersion: decision.rulesetVersion,
    profileSnapshotHash: decision.profileSnapshotHash,
    reviewFlagged: decision.reviewFlagged === 1,
    reviewNote: decision.reviewNote ?? null,
    createdAt: decision.createdAt,
  });
});

router.get("/eligibility/results/:id", requireConsent, async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid decision record ID." });
    return;
  }

  const [decision] = await db
    .select()
    .from(decisionRecordsTable)
    .where(and(eq(decisionRecordsTable.id, id), eq(decisionRecordsTable.userId, userId)));

  if (!decision) {
    res.status(404).json({ error: "Decision record not found." });
    return;
  }

  res.json({
    id: decision.id,
    userId: decision.userId,
    outcome: decision.outcome,
    explanationText: decision.explanationText,
    reasonCodes: decision.reasonCodes,
    pathways: decision.pathways ?? null,
    rulesetId: decision.rulesetId,
    rulesetVersion: decision.rulesetVersion,
    profileSnapshotHash: decision.profileSnapshotHash,
    reviewFlagged: decision.reviewFlagged === 1,
    reviewNote: decision.reviewNote ?? null,
    createdAt: decision.createdAt,
  });
});

router.get("/eligibility/history", requireConsent, async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;

  const decisions = await db
    .select()
    .from(decisionRecordsTable)
    .where(eq(decisionRecordsTable.userId, userId))
    .orderBy(desc(decisionRecordsTable.createdAt));

  res.json({
    decisions: decisions.map((d) => ({
      id: d.id,
      userId: d.userId,
      outcome: d.outcome,
      explanationText: d.explanationText,
      reasonCodes: d.reasonCodes,
      pathways: d.pathways ?? null,
      rulesetId: d.rulesetId,
      rulesetVersion: d.rulesetVersion,
      profileSnapshotHash: d.profileSnapshotHash,
      reviewFlagged: d.reviewFlagged === 1,
      reviewNote: d.reviewNote ?? null,
      createdAt: d.createdAt,
    })),
  });
});

export default router;
