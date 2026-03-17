import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import { db, rulesetsTable, rulesetRulesTable, decisionRecordsTable } from "@workspace/db";
import { evaluate } from "../lib/rulesEngine";
import type { Profile, RuleCondition } from "@workspace/db";

const router: IRouter = Router();

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(401).json({ error: "Admin access required." });
    return;
  }
  next();
}

router.get("/rulesets", requireAdmin, async (req, res): Promise<void> => {
  const { regulator, status } = req.query as Record<string, string | undefined>;

  const conditions = [];
  if (regulator && ["GMC", "NMC", "HCPC"].includes(regulator)) {
    conditions.push(eq(rulesetsTable.regulator, regulator as "GMC" | "NMC" | "HCPC"));
  }
  if (status && ["draft", "published"].includes(status)) {
    conditions.push(eq(rulesetsTable.status, status as "draft" | "published"));
  }

  const rulesets = conditions.length > 1
    ? await db.select().from(rulesetsTable).where(and(...conditions))
    : conditions.length === 1
      ? await db.select().from(rulesetsTable).where(conditions[0])
      : await db.select().from(rulesetsTable);

  res.json({
    rulesets: rulesets.map((r) => ({
      id: r.id,
      regulator: r.regulator,
      version: r.version,
      status: r.status,
      effectiveDate: r.effectiveDate,
      changelog: r.changelog,
      createdBy: r.createdBy ?? null,
      createdAt: r.createdAt,
    })),
  });
});

router.get("/rulesets/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ruleset ID." });
    return;
  }

  const [ruleset] = await db.select().from(rulesetsTable).where(eq(rulesetsTable.id, id));
  if (!ruleset) {
    res.status(404).json({ error: "Ruleset not found." });
    return;
  }

  const rules = await db.select().from(rulesetRulesTable).where(eq(rulesetRulesTable.rulesetId, id));

  res.json({
    id: ruleset.id,
    regulator: ruleset.regulator,
    version: ruleset.version,
    status: ruleset.status,
    effectiveDate: ruleset.effectiveDate,
    changelog: ruleset.changelog,
    createdBy: ruleset.createdBy ?? null,
    createdAt: ruleset.createdAt,
    rules: rules.map((r) => ({
      id: r.id,
      rulesetId: r.rulesetId,
      ruleKey: r.ruleKey,
      conditions: r.conditions,
      outcome: r.outcome,
      reasonCode: r.reasonCode,
      explanationText: r.explanationText,
      pathways: r.pathways ?? null,
      sortOrder: r.sortOrder,
    })),
  });
});

router.post("/rulesets", requireAdmin, async (req, res): Promise<void> => {
  const { regulator, version, effectiveDate, changelog, rules } = req.body as {
    regulator?: string;
    version?: string;
    effectiveDate?: string;
    changelog?: string;
    rules?: Array<{
      ruleKey: string;
      conditions: Array<{ field: string; operator: string; value?: unknown }>;
      outcome: string;
      reasonCode: string;
      explanationText: string;
      pathways?: string[];
      sortOrder: number;
    }>;
  };

  if (!regulator || !["GMC", "NMC", "HCPC"].includes(regulator)) {
    res.status(400).json({ error: "regulator must be one of GMC, NMC, HCPC." });
    return;
  }
  if (!version || !effectiveDate || !changelog) {
    res.status(400).json({ error: "version, effectiveDate, and changelog are required." });
    return;
  }
  if (!Array.isArray(rules) || rules.length === 0) {
    res.status(400).json({ error: "At least one rule is required." });
    return;
  }

  const VALID_OUTCOMES = ["eligible", "not_eligible", "ineligible"] as const;
  const VALID_OPERATORS = ["eq", "neq", "in", "not_in", "gte", "lte", "exists"] as const;

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!rule.ruleKey?.trim()) {
      res.status(400).json({ error: `Rule ${i + 1}: ruleKey is required.` });
      return;
    }
    if (!VALID_OUTCOMES.includes(rule.outcome as typeof VALID_OUTCOMES[number])) {
      res.status(400).json({ error: `Rule ${i + 1}: outcome must be one of: ${VALID_OUTCOMES.join(", ")}.` });
      return;
    }
    if (!rule.reasonCode?.trim() || !rule.explanationText?.trim()) {
      res.status(400).json({ error: `Rule ${i + 1}: reasonCode and explanationText are required.` });
      return;
    }
    if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) {
      res.status(400).json({ error: `Rule ${i + 1}: at least one condition is required.` });
      return;
    }
    for (let j = 0; j < rule.conditions.length; j++) {
      const cond = rule.conditions[j];
      if (!cond.field?.trim()) {
        res.status(400).json({ error: `Rule ${i + 1}, condition ${j + 1}: field is required.` });
        return;
      }
      if (!VALID_OPERATORS.includes(cond.operator as typeof VALID_OPERATORS[number])) {
        res.status(400).json({ error: `Rule ${i + 1}, condition ${j + 1}: operator must be one of: ${VALID_OPERATORS.join(", ")}.` });
        return;
      }
      if (cond.operator !== "exists" && cond.value === undefined) {
        res.status(400).json({ error: `Rule ${i + 1}, condition ${j + 1}: value is required for operator "${cond.operator}".` });
        return;
      }
      if ((cond.operator === "in" || cond.operator === "not_in") && !Array.isArray(cond.value)) {
        res.status(400).json({ error: `Rule ${i + 1}, condition ${j + 1}: operator "${cond.operator}" requires an array value.` });
        return;
      }
      if ((cond.operator === "in" || cond.operator === "not_in") && Array.isArray(cond.value) && (cond.value as unknown[]).length === 0) {
        res.status(400).json({ error: `Rule ${i + 1}, condition ${j + 1}: operator "${cond.operator}" requires a non-empty array.` });
        return;
      }
      if ((cond.operator === "gte" || cond.operator === "lte") && typeof cond.value !== "number") {
        res.status(400).json({ error: `Rule ${i + 1}, condition ${j + 1}: operator "${cond.operator}" requires a numeric value.` });
        return;
      }
    }
  }

  const [ruleset] = await db
    .insert(rulesetsTable)
    .values({
      regulator: regulator as "GMC" | "NMC" | "HCPC",
      version,
      effectiveDate: new Date(effectiveDate),
      changelog,
      status: "draft",
      createdBy: req.user!.id,
    })
    .returning();

  await db.insert(rulesetRulesTable).values(
    rules.map((r) => ({
      rulesetId: ruleset.id,
      ruleKey: r.ruleKey,
      conditions: r.conditions as RuleCondition[],
      outcome: r.outcome as "eligible" | "not_eligible" | "ineligible",
      reasonCode: r.reasonCode,
      explanationText: r.explanationText,
      pathways: r.pathways ?? null,
      sortOrder: r.sortOrder,
    }))
  );

  res.status(201).json({
    id: ruleset.id,
    regulator: ruleset.regulator,
    version: ruleset.version,
    status: ruleset.status,
    effectiveDate: ruleset.effectiveDate,
    changelog: ruleset.changelog,
    createdBy: ruleset.createdBy ?? null,
    createdAt: ruleset.createdAt,
  });
});

router.patch("/rulesets/:id/publish", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ruleset ID." });
    return;
  }

  const [ruleset] = await db.select().from(rulesetsTable).where(eq(rulesetsTable.id, id));
  if (!ruleset) {
    res.status(404).json({ error: "Ruleset not found." });
    return;
  }

  if (ruleset.status !== "draft") {
    res.status(400).json({ error: "Only draft rulesets can be published." });
    return;
  }

  const rules = await db.select().from(rulesetRulesTable).where(eq(rulesetRulesTable.rulesetId, id));
  if (rules.length === 0) {
    res.status(400).json({ error: "Cannot publish a ruleset with no rules." });
    return;
  }

  const [updated] = await db
    .update(rulesetsTable)
    .set({ status: "published" })
    .where(eq(rulesetsTable.id, id))
    .returning();

  res.json({
    id: updated.id,
    regulator: updated.regulator,
    version: updated.version,
    status: updated.status,
    effectiveDate: updated.effectiveDate,
    changelog: updated.changelog,
    createdBy: updated.createdBy ?? null,
    createdAt: updated.createdAt,
  });
});

router.post("/rulesets/:id/regression-test", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ruleset ID." });
    return;
  }

  const [ruleset] = await db.select().from(rulesetsTable).where(eq(rulesetsTable.id, id));
  if (!ruleset) {
    res.status(404).json({ error: "Ruleset not found." });
    return;
  }

  const rules = await db.select().from(rulesetRulesTable).where(eq(rulesetRulesTable.rulesetId, id));

  const { cases } = req.body as {
    cases?: Array<{
      label: string;
      profile: Partial<Profile>;
      expectedOutcome: string;
    }>;
  };

  if (!Array.isArray(cases) || cases.length === 0) {
    res.status(400).json({ error: "At least one test case is required." });
    return;
  }

  const results = cases.map((tc) => {
    const profile = {
      id: 0,
      userId: "test",
      createdAt: new Date(),
      updatedAt: new Date(),
      licenceReady: null,
      specialty: "",
      qualificationCountry: "",
      qualificationType: "",
      qualificationYear: 2000,
      experienceYears: 0,
      registrationStatus: "not_registered" as const,
      residencyStatus: "",
      requiresSponsorship: false,
      ...tc.profile,
    } as Profile;

    const result = evaluate(profile, rules);
    const passed = result.outcome === tc.expectedOutcome;

    return {
      label: tc.label,
      expectedOutcome: tc.expectedOutcome,
      actualOutcome: result.outcome,
      passed,
      reasonCodes: result.reasonCodes,
      explanationText: result.explanationText,
    };
  });

  const passed = results.filter((r) => r.passed).length;

  res.json({
    rulesetId: ruleset.id,
    totalCases: cases.length,
    passed,
    failed: cases.length - passed,
    results,
  });
});

router.get("/decisions", requireAdmin, async (req, res): Promise<void> => {
  const { userId, outcome, reviewFlagged } = req.query as Record<string, string | undefined>;

  const conditions = [];
  if (userId) {
    conditions.push(eq(decisionRecordsTable.userId, userId));
  }
  if (outcome && ["eligible", "not_eligible", "ineligible"].includes(outcome)) {
    conditions.push(eq(decisionRecordsTable.outcome, outcome as "eligible" | "not_eligible" | "ineligible"));
  }
  if (reviewFlagged !== undefined) {
    conditions.push(eq(decisionRecordsTable.reviewFlagged, reviewFlagged === "true" ? 1 : 0));
  }

  const decisions = conditions.length > 1
    ? await db.select().from(decisionRecordsTable).where(and(...conditions))
    : conditions.length === 1
      ? await db.select().from(decisionRecordsTable).where(conditions[0])
      : await db.select().from(decisionRecordsTable);

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
