import { Router, type IRouter } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { db } from "@workspace/db";
import { rolesTable, decisionRecordsTable, profilesTable, rulesetRulesTable, auditEventsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";
import { assessSponsorshipFeasibility } from "../lib/sponsorshipFeasibility";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const REQUIRED_COLUMNS = ["title", "employer", "location", "regulator", "sponsorshipOffered", "requiredRegistration"];
const VALID_REGULATORS = ["GMC", "NMC", "HCPC"];

router.get("/roles", async (req, res): Promise<void> => {
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
    res.status(400).json({ error: "No eligibility assessment found. Please run your eligibility check first." });
    return;
  }

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  if (!profile) {
    res.status(400).json({ error: "Profile not found." });
    return;
  }

  if (decision.outcome !== "eligible") {
    res.json({
      roles: [],
      decisionRecordId: decision.id,
      rulesetVersion: decision.rulesetVersion,
      eligibilityOutcome: decision.outcome,
      message:
        decision.outcome === "not_eligible"
          ? "You are not yet eligible for UK registration. Please review your remediation plan to understand the steps needed to become eligible."
          : "You are ineligible for UK registration via your current pathway. Please review your eligibility assessment for more information.",
    });
    return;
  }

  const regulator = (() => {
    if (profile.profession === "doctor" || profile.profession === "clinical_academic") return "GMC";
    if (profile.profession === "nurse" || profile.profession === "midwife") return "NMC";
    if (profile.profession === "allied_health_professional") return "HCPC";
    return null;
  })();

  if (!regulator) {
    res.json({
      roles: [],
      decisionRecordId: decision.id,
      rulesetVersion: decision.rulesetVersion,
      eligibilityOutcome: decision.outcome,
      message: "No regulator mapping found for your profession.",
    });
    return;
  }

  const allRoles = await db
    .select()
    .from(rolesTable)
    .where(eq(rolesTable.active, true));

  const REGISTERED_STATUSES = ["registered", "fully_registered", "full_registration"];
  const isRegistered =
    profile.registrationStatus != null &&
    REGISTERED_STATUSES.includes(profile.registrationStatus.toLowerCase());
  const isLicenceReady = profile.licenceReady === true;

  const matchedRoles = allRoles.filter((role) => {
    if (role.regulator !== regulator) return false;

    const reqReg = role.requiredRegistration.toLowerCase();

    if (reqReg.includes("full") || reqReg.includes("registered")) {
      if (!isRegistered && !isLicenceReady) return false;
    }

    return true;
  });

  let eligibleRuleId: number | null = null;
  const eligibleReasonCode = decision.reasonCodes.find((rc) => rc !== "NO_RULE_MATCHED" && rc !== "REVIEW_FLAGGED");
  if (eligibleReasonCode) {
    const [eligibleRule] = await db
      .select({ id: rulesetRulesTable.id })
      .from(rulesetRulesTable)
      .where(
        and(
          eq(rulesetRulesTable.rulesetId, decision.rulesetId),
          eq(rulesetRulesTable.reasonCode, eligibleReasonCode)
        )
      )
      .limit(1);
    eligibleRuleId = eligibleRule?.id ?? null;
  }

  const result = matchedRoles.map((role) => {
    const feasibility = profile.requiresSponsorship
      ? assessSponsorshipFeasibility(role, profile.requiresSponsorship)
      : null;

    return {
      role,
      explanation: `Matched as eligible for ${regulator} registration (${profile.profession.replace(/_/g, " ")}). Ruleset v${decision.rulesetVersion}, decision #${decision.id}${eligibleRuleId ? `, rule #${eligibleRuleId}` : ""}.`,
      rulesetVersion: decision.rulesetVersion,
      decisionRecordId: decision.id,
      ruleId: eligibleRuleId,
      sponsorshipFeasibility: feasibility,
    };
  });

  res.json({
    roles: result,
    decisionRecordId: decision.id,
    rulesetVersion: decision.rulesetVersion,
    eligibilityOutcome: decision.outcome,
    message: null,
  });
});

router.get("/admin/roles", requireRole("admin"), async (_req, res): Promise<void> => {
  const roles = await db.select().from(rolesTable).orderBy(desc(rolesTable.importedAt));
  res.json({ roles });
});

router.post("/admin/roles/import", requireRole("admin"), upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "CSV file is required." });
    return;
  }

  let records: Record<string, string>[];
  try {
    records = parse(req.file.buffer.toString("utf-8"), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];
  } catch {
    res.status(400).json({ error: "Invalid CSV format. Ensure the file is valid UTF-8 CSV with header row." });
    return;
  }

  if (records.length === 0) {
    res.status(400).json({ error: "CSV file is empty." });
    return;
  }

  const firstRow = records[0];
  const missingCols = REQUIRED_COLUMNS.filter((c) => !(c in firstRow));
  if (missingCols.length > 0) {
    res.status(400).json({
      error: `CSV is missing required columns: ${missingCols.join(", ")}. Required columns: ${REQUIRED_COLUMNS.join(", ")}.`,
    });
    return;
  }

  const errors: Array<{ row: number; message: string }> = [];
  const validRows: Array<{
    title: string;
    employer: string;
    location: string;
    regulator: "GMC" | "NMC" | "HCPC";
    sponsorshipOffered: boolean;
    requiredRegistration: string;
    importedBy: string;
  }> = [];

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const rowNum = i + 2;

    if (!row.title?.trim()) {
      errors.push({ row: rowNum, message: "title is required" });
      continue;
    }
    if (!row.employer?.trim()) {
      errors.push({ row: rowNum, message: "employer is required" });
      continue;
    }
    if (!row.location?.trim()) {
      errors.push({ row: rowNum, message: "location is required" });
      continue;
    }
    const regulator = row.regulator?.trim().toUpperCase();
    if (!VALID_REGULATORS.includes(regulator)) {
      errors.push({ row: rowNum, message: `regulator must be one of: ${VALID_REGULATORS.join(", ")}` });
      continue;
    }
    const sponsorshipRaw = row.sponsorshipOffered?.trim().toLowerCase();
    if (!["true", "false", "yes", "no", "1", "0"].includes(sponsorshipRaw)) {
      errors.push({ row: rowNum, message: "sponsorshipOffered must be true/false or yes/no" });
      continue;
    }
    if (!row.requiredRegistration?.trim()) {
      errors.push({ row: rowNum, message: "requiredRegistration is required" });
      continue;
    }

    validRows.push({
      title: row.title.trim(),
      employer: row.employer.trim(),
      location: row.location.trim(),
      regulator: regulator as "GMC" | "NMC" | "HCPC",
      sponsorshipOffered: ["true", "yes", "1"].includes(sponsorshipRaw),
      requiredRegistration: row.requiredRegistration.trim(),
      importedBy: req.user!.id,
    });
  }

  if (validRows.length > 0) {
    await db.insert(rolesTable).values(validRows);
  }

  db.insert(auditEventsTable)
    .values({
      actor: req.user!.id,
      action: "roles_imported",
      target: undefined,
      details: { imported: validRows.length, skipped: errors.length },
    })
    .catch(() => {});

  res.json({
    imported: validRows.length,
    skipped: errors.length,
    errors,
  });
});

export default router;
