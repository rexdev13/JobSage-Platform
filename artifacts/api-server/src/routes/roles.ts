import { Router, type IRouter } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { db } from "@workspace/db";
import {
  rolesTable,
  decisionRecordsTable,
  profilesTable,
  rulesetRulesTable,
  auditEventsTable,
  applicationsTable,
  jobListingsTable,
  employerProfilesTable,
} from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";
import { assessSponsorshipFeasibility } from "../lib/sponsorshipFeasibility";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const REQUIRED_COLUMNS = ["title", "employer", "location", "regulator", "sponsorshipOffered", "requiredRegistration"];
const VALID_REGULATORS = ["GMC", "NMC", "HCPC"];

const REGISTERED_STATUSES = ["registered", "fully_registered", "full_registration"];

function regulatorForProfession(profession: string): "GMC" | "NMC" | "HCPC" | null {
  if (profession === "doctor" || profession === "clinical_academic") return "GMC";
  if (profession === "nurse" || profession === "midwife") return "NMC";
  if (profession === "allied_health_professional") return "HCPC";
  return null;
}

function computeMatchScore(
  role: typeof rolesTable.$inferSelect,
  isEligible: boolean,
  requiresSponsorship: boolean,
): number {
  let score = isEligible ? 60 : 20;

  if (role.sponsorshipOffered && requiresSponsorship) {
    score += 25;
  } else if (!requiresSponsorship) {
    score += 15;
  }

  if (isEligible) {
    const reqReg = role.requiredRegistration.toLowerCase();
    if (!reqReg.includes("full") && !reqReg.includes("senior")) {
      score += 10;
    }
  }

  return Math.min(score, 100);
}

function getRoleEligibilityGaps(
  role: typeof rolesTable.$inferSelect,
  profile: { registrationStatus: string | null; licenceReady: boolean | null; requiresSponsorship: boolean },
  decisionExplanation: string | null,
): string[] {
  const gaps: string[] = [];

  const reqReg = role.requiredRegistration.toLowerCase();
  const isRegistered =
    profile.registrationStatus != null &&
    REGISTERED_STATUSES.includes(profile.registrationStatus.toLowerCase());
  const isLicenceReady = profile.licenceReady === true;

  if ((reqReg.includes("full") || reqReg.includes("registered")) && !isRegistered && !isLicenceReady) {
    gaps.push(
      `This role requires full registration. Your current status: ${
        profile.registrationStatus?.replace(/_/g, " ") ?? "not set"
      }.`,
    );
  }

  if (decisionExplanation) {
    gaps.push(decisionExplanation);
  }

  return gaps;
}

router.get("/roles", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const userId = req.user!.id;

  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId));

  if (!profile) {
    res.status(400).json({ error: "Profile not found. Please complete your profile first." });
    return;
  }

  const regulator = regulatorForProfession(profile.profession);
  if (!regulator) {
    res.status(400).json({ error: "Could not determine regulatory body from your profession." });
    return;
  }

  const [decision] = await db
    .select()
    .from(decisionRecordsTable)
    .where(eq(decisionRecordsTable.userId, userId))
    .orderBy(desc(decisionRecordsTable.createdAt))
    .limit(1);

  const allRoles = await db.select().from(rolesTable).where(eq(rolesTable.active, true));

  const publishedJobListings = await db
    .select({ job: jobListingsTable, emp: employerProfilesTable })
    .from(jobListingsTable)
    .innerJoin(employerProfilesTable, eq(jobListingsTable.employerProfileId, employerProfilesTable.id))
    .where(eq(jobListingsTable.status, "published"));

  const employerJobsAsRoles = publishedJobListings
    .filter((row) => {
      const job = row.job;
      if (job.regulator !== regulator) return false;
      const tp = (job.targetProfessions ?? []) as string[];
      if (tp.length > 0 && !tp.includes(profile.profession)) return false;
      const tr = (job.targetRegions ?? []) as string[];
      if (tr.length > 0 && profile.preferredRegion && !tr.includes(profile.preferredRegion)) return false;
      return true;
    })
    .map((row) => ({
      id: row.job.id + 1_000_000,
      title: row.job.title,
      employer: row.emp.companyName,
      location: row.job.location,
      regulator: row.job.regulator,
      sponsorshipOffered: row.job.sponsorshipOffered,
      requiredRegistration: row.job.requiredRegistration,
      active: true,
      importedAt: row.job.createdAt,
      importedBy: `employer:${row.emp.id}`,
    }));

  const regulatorRoles = [
    ...allRoles.filter((role) => role.regulator === regulator),
    ...employerJobsAsRoles,
  ];

  const isRegistered =
    profile.registrationStatus != null &&
    REGISTERED_STATUSES.includes(profile.registrationStatus.toLowerCase());
  const isLicenceReady = profile.licenceReady === true;

  const userIsEligible = decision?.outcome === "eligible";

  let eligibleRuleId: number | null = null;
  if (decision && userIsEligible) {
    const eligibleReasonCode = decision.reasonCodes.find(
      (rc) => rc !== "NO_RULE_MATCHED" && rc !== "REVIEW_FLAGGED",
    );
    if (eligibleReasonCode) {
      const [eligibleRule] = await db
        .select({ id: rulesetRulesTable.id })
        .from(rulesetRulesTable)
        .where(
          and(
            eq(rulesetRulesTable.rulesetId, decision.rulesetId),
            eq(rulesetRulesTable.reasonCode, eligibleReasonCode),
          ),
        )
        .limit(1);
      eligibleRuleId = eligibleRule?.id ?? null;
    }
  }

  const appliedApps = await db
    .select({ roleId: applicationsTable.roleId })
    .from(applicationsTable)
    .where(eq(applicationsTable.userId, userId));
  const appliedRoleIds = appliedApps.map((a) => a.roleId);

  const rulesetVersion = decision?.rulesetVersion ?? "—";
  const decisionRecordId = decision?.id ?? null;

  const result = regulatorRoles.map((role) => {
    const reqReg = role.requiredRegistration.toLowerCase();
    const roleRequiresFull = reqReg.includes("full") || reqReg.includes("registered");
    const meetsRegistration = roleRequiresFull ? isRegistered || isLicenceReady : true;

    let isEligible: boolean;
    let eligibilityGaps: string[] = [];

    if (!decision) {
      isEligible = false;
      eligibilityGaps = ["Run your eligibility check to see which roles you qualify for."];
    } else if (!userIsEligible) {
      isEligible = false;
      eligibilityGaps = getRoleEligibilityGaps(role, profile, decision.explanationText);
    } else {
      isEligible = meetsRegistration;
      if (!isEligible) {
        eligibilityGaps = getRoleEligibilityGaps(role, profile, null);
      }
    }

    const sponsorshipFeasibility =
      profile.requiresSponsorship ? assessSponsorshipFeasibility(role, profile.requiresSponsorship) : null;

    const professionLabel = profile.profession.replace(/_/g, " ");
    const explanation = isEligible
      ? `Matched as eligible for ${regulator} registration (${professionLabel}). Ruleset v${rulesetVersion}, decision #${decisionRecordId}${eligibleRuleId ? `, rule #${eligibleRuleId}` : ""}.`
      : decision
        ? `Not yet eligible for this role. Complete your remediation steps to qualify.`
        : `Run your eligibility assessment to see your match status for this role.`;

    return {
      role,
      explanation,
      rulesetVersion,
      decisionRecordId: decisionRecordId ?? 0,
      ruleId: eligibleRuleId,
      sponsorshipFeasibility,
      isEligible,
      matchScore: computeMatchScore(role, isEligible, profile.requiresSponsorship),
      eligibilityGaps,
    };
  });

  result.sort((a, b) => {
    if (a.isEligible !== b.isEligible) return a.isEligible ? -1 : 1;
    return b.matchScore - a.matchScore;
  });

  res.json({
    roles: result,
    decisionRecordId,
    rulesetVersion,
    eligibilityOutcome: decision?.outcome ?? null,
    message: null,
    appliedRoleIds,
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
