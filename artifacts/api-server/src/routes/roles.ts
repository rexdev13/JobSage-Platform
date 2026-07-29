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
  speculativeApplicationsTable,
  jobListingsTable,
  employerProfilesTable,
  candidateMatchScoresTable,
  matchDismissalsTable,
} from "@workspace/db";
import { eq, desc, and, inArray, gte, or, isNotNull, ne } from "drizzle-orm";
import { requireRole, requireAuthenticated } from "../middlewares/requireRole";
import { assessSponsorshipFeasibility } from "../lib/sponsorshipFeasibility";
import { batchScoreRoles } from "../lib/candidateAiMatch";
import { careerProfilesTable } from "@workspace/db";
import { runApplyUrlBackfill, getLastBackfillSummary } from "../lib/applyUrlBackfill";
import { queueLinkVerificationBatch } from "../lib/linkVerification";
import { runFullLivenessScan, getFullScanStatus } from "../lib/vacancyLivenessSweep";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const REQUIRED_COLUMNS = ["title", "employer", "location", "regulator", "sponsorshipOffered", "requiredRegistration"];

/**
 * Drizzle WHERE clause that restricts to roles that have at least one real
 * contact detail (apply URL, email, phone, or website).
 * Treats both NULL and empty-string values as "no contact info".
 * Applied to all candidate-facing queries — admin queries use unfiltered access.
 */
const HAS_CONTACT_INFO = or(
  and(isNotNull(rolesTable.applyUrl), ne(rolesTable.applyUrl, ""), ne(rolesTable.liveness, "dead")),
  and(isNotNull(rolesTable.contactEmail), ne(rolesTable.contactEmail, "")),
  and(isNotNull(rolesTable.contactPhone), ne(rolesTable.contactPhone, "")),
  and(isNotNull(rolesTable.contactWebsite), ne(rolesTable.contactWebsite, "")),
);

/**
 * In-memory predicate equivalent to HAS_CONTACT_INFO, used to filter
 * employer-posted job listings merged into the candidate-facing results.
 */
function employerJobHasContactInfo(row: {
  job: { applyUrl?: string | null; liveness?: string };
  emp: { contactEmail?: string | null; contactPhone?: string | null; contactWebsite?: string | null };
}): boolean {
  const effectiveApply = row.job.liveness === "dead" ? null : row.job.applyUrl;
  const vals = [effectiveApply, row.emp.contactEmail, row.emp.contactPhone, row.emp.contactWebsite];
  return vals.some((v) => v != null && v.trim() !== "");
}

/**
 * Candidate-facing apply-link presentation: dead links are never surfaced
 * (the record may still appear if it has other contact info), and each link
 * carries a verification status the UI badges consistently.
 */
function presentApplyLink(
  applyUrl: string | null | undefined,
  liveness: string | null | undefined,
  lastVerifiedAt: Date | null | undefined,
): { applyUrl: string | null; linkVerified: boolean; linkCheckedAt: string | null } {
  const url = applyUrl?.trim() || null;
  if (!url || liveness === "dead") {
    return { applyUrl: null, linkVerified: false, linkCheckedAt: null };
  }
  return {
    applyUrl: url,
    linkVerified: liveness === "live",
    linkCheckedAt: lastVerifiedAt ? new Date(lastVerifiedAt).toISOString() : null,
  };
}
const OPTIONAL_COLUMNS = ["applyUrl", "contactEmail", "contactPhone", "contactWebsite"];
const APPLY_URL_PATTERN = /^https?:\/\/.+/i;
const VALID_REGULATORS = ["GMC", "NMC", "HCPC"];

const REGISTERED_STATUSES = ["registered", "fully_registered", "full_registration"];

function regulatorForProfession(profession: string): "GMC" | "NMC" | "HCPC" | null {
  if (profession === "doctor" || profession === "clinical_academic") return "GMC";
  if (profession === "nurse" || profession === "midwife") return "NMC";
  if (profession === "allied_health_professional") return "HCPC";
  return null;
}

function deriveMatchReason(
  r: { sponsorshipOffered: boolean; requiredRegistration: string },
  isEligible: boolean,
  requiresSponsorship: boolean,
  specialty: string | null,
): string {
  const specialtyHint = specialty ? ` ${specialty}` : "";
  if (isEligible && r.sponsorshipOffered && requiresSponsorship) {
    return `You're eligible now and this employer offers the visa sponsorship you need`;
  }
  if (isEligible && !requiresSponsorship) {
    return `Strong fit for your${specialtyHint} background — you can apply today`;
  }
  if (isEligible) {
    return `You meet the eligibility criteria and can apply now`;
  }
  if (r.sponsorshipOffered && requiresSponsorship) {
    return `Offers visa sponsorship aligned with your needs — worth pursuing`;
  }
  const reqReg = r.requiredRegistration.toLowerCase();
  if (!reqReg.includes("full") && !reqReg.includes("senior")) {
    return `Lower registration bar — accessible while you complete your UK journey`;
  }
  return `Matched to your${specialtyHint} profession and registration pathway`;
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

const SCORE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

router.get("/roles", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const userId = req.user!.id;

  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId));

  if (!profile) {
    res.json({ roles: [], appliedRoleIds: [], decisionRecordId: null, rulesetVersion: "—", eligibilityOutcome: null, message: null, noProfile: true });
    return;
  }

  const regulator = regulatorForProfession(profile.profession);
  if (!regulator) {
    res.json({ roles: [], appliedRoleIds: [], decisionRecordId: null, rulesetVersion: "—", eligibilityOutcome: null, message: null, noProfile: false });
    return;
  }

  const [decision] = await db
    .select()
    .from(decisionRecordsTable)
    .where(eq(decisionRecordsTable.userId, userId))
    .orderBy(desc(decisionRecordsTable.createdAt))
    .limit(1);

  const allRoles = await db.select().from(rolesTable).where(and(eq(rolesTable.active, true), HAS_CONTACT_INFO));

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
      if (tr.length > 0 && (!profile.preferredRegion || !(profile.preferredRegion as string[]).some((r) => tr.includes(r)))) return false;
      if (!employerJobHasContactInfo(row)) return false;
      return true;
    })
    .map((row) => {
      const link = presentApplyLink(row.job.applyUrl, row.job.liveness, row.job.lastVerifiedAt);
      return {
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
        liveness: row.job.liveness,
        lastVerifiedAt: row.job.lastVerifiedAt,
        livenessReason: row.job.livenessReason,
        contactEmail: row.emp.contactEmail ?? null,
        contactPhone: row.emp.contactPhone ?? null,
        contactWebsite: row.emp.contactWebsite ?? null,
        applyUrl: link.applyUrl,
        linkVerified: link.linkVerified,
        linkCheckedAt: link.linkCheckedAt,
      };
    });

  const regulatorRoles = [
    ...allRoles.filter((role) => role.regulator === regulator).map((r) => {
      const link = presentApplyLink(r.applyUrl, r.liveness, r.lastVerifiedAt);
      return {
        ...r,
        contactEmail: r.contactEmail ?? null,
        contactPhone: r.contactPhone ?? null,
        contactWebsite: r.contactWebsite ?? null,
        applyUrl: link.applyUrl,
        linkVerified: link.linkVerified,
        linkCheckedAt: link.linkCheckedAt,
      };
    }),
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

  const [appliedApps, cachedAiScores] = await Promise.all([
    db.select({ roleId: applicationsTable.roleId }).from(applicationsTable).where(eq(applicationsTable.userId, userId)),
    db
      .select()
      .from(candidateMatchScoresTable)
      .where(
        and(
          eq(candidateMatchScoresTable.userId, userId),
          gte(candidateMatchScoresTable.scoredAt, new Date(Date.now() - SCORE_CACHE_TTL_MS)),
        ),
      ),
  ]);
  const appliedRoleIds = appliedApps.map((a) => a.roleId);

  // Build a lookup from the persisted AI scores so the roles response can
  // sort and badge each card with the same value the /my-matches strip uses.
  const aiScoreMap = new Map(
    cachedAiScores.map((s) => [s.roleId, { score: s.score, explanation: s.aiExplanation }]),
  );

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

    const cached = aiScoreMap.get(role.id);

    return {
      role,
      explanation,
      rulesetVersion,
      decisionRecordId: decisionRecordId ?? 0,
      ruleId: eligibleRuleId,
      sponsorshipFeasibility,
      isEligible,
      matchScore: computeMatchScore(role, isEligible, profile.requiresSponsorship),
      aiScore: cached?.score ?? null,
      aiExplanation: cached?.explanation ?? null,
      eligibilityGaps,
      contactEmail: role.contactEmail ?? null,
      contactPhone: role.contactPhone ?? null,
      contactWebsite: role.contactWebsite ?? null,
      applyUrl: role.applyUrl ?? null,
      linkVerified: role.linkVerified ?? false,
      linkCheckedAt: role.linkCheckedAt ?? null,
    };
  });

  // Unified sort: roles with an AI score rank first (by that score); roles
  // still awaiting AI scoring rank below them by the heuristic matchScore.
  // This mirrors the sort the client previously applied after merging two queries.
  result.sort((a, b) => {
    const aHasAi = a.aiScore !== null;
    const bHasAi = b.aiScore !== null;
    if (aHasAi !== bHasAi) return aHasAi ? -1 : 1;
    if (aHasAi && bHasAi && b.aiScore !== a.aiScore) return (b.aiScore ?? 0) - (a.aiScore ?? 0);
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return a.role.id - b.role.id;
  });

  const rankedRoles = result.map((r, i) => ({ ...r, recommended: i < 5 }));

  res.json({
    roles: rankedRoles,
    decisionRecordId,
    rulesetVersion,
    eligibilityOutcome: decision?.outcome ?? null,
    message: null,
    appliedRoleIds,
    noProfile: false,
  });
});

router.get("/roles/my-matches", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const limit = Math.min(200, parseInt(String(req.query.limit ?? "10"), 10) || 10);
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);

  const [[profile], [activeCareerProfile]] = await Promise.all([
    db.select().from(profilesTable).where(eq(profilesTable.userId, userId)),
    db.select().from(careerProfilesTable).where(and(eq(careerProfilesTable.userId, userId), eq(careerProfilesTable.isActive, true))),
  ]);
  if (!profile) {
    res.status(200).json({ matches: [], dismissedRoleIds: [], totalCount: 0, cached: false });
    return;
  }

  const regulator = regulatorForProfession(profile.profession);
  if (!regulator) {
    res.status(200).json({ matches: [], dismissedRoleIds: [], totalCount: 0, cached: false });
    return;
  }

  const [decision] = await db
    .select()
    .from(decisionRecordsTable)
    .where(eq(decisionRecordsTable.userId, userId))
    .orderBy(desc(decisionRecordsTable.createdAt))
    .limit(1);

  const isRegistered =
    profile.registrationStatus != null &&
    REGISTERED_STATUSES.includes(profile.registrationStatus.toLowerCase());
  const isLicenceReady = profile.licenceReady === true;
  const userIsEligible = decision?.outcome === "eligible";

  const allRoles = await db.select().from(rolesTable).where(and(eq(rolesTable.active, true), HAS_CONTACT_INFO));
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
      if (!employerJobHasContactInfo(row)) return false;
      return true;
    })
    .map((row) => {
      const link = presentApplyLink(row.job.applyUrl, row.job.liveness, row.job.lastVerifiedAt);
      return {
        id: row.job.id + 1_000_000,
        title: row.job.title,
        employer: row.emp.companyName,
        location: row.job.location,
        regulator: row.job.regulator as "GMC" | "NMC" | "HCPC",
        sponsorshipOffered: row.job.sponsorshipOffered,
        requiredRegistration: row.job.requiredRegistration,
        applyUrl: link.applyUrl,
        linkVerified: link.linkVerified,
        linkCheckedAt: link.linkCheckedAt,
        contactEmail: row.emp.contactEmail ?? null,
        contactPhone: row.emp.contactPhone ?? null,
        contactWebsite: row.emp.contactWebsite ?? null,
      };
    });

  const regulatorRoles = [
    ...allRoles.filter((r) => r.regulator === regulator).map((r) => {
      const link = presentApplyLink(r.applyUrl, r.liveness, r.lastVerifiedAt);
      return {
        id: r.id, title: r.title, employer: r.employer, location: r.location,
        regulator: r.regulator, sponsorshipOffered: r.sponsorshipOffered,
        requiredRegistration: r.requiredRegistration, applyUrl: link.applyUrl,
        linkVerified: link.linkVerified,
        linkCheckedAt: link.linkCheckedAt,
        contactEmail: r.contactEmail ?? null,
        contactPhone: r.contactPhone ?? null,
        contactWebsite: r.contactWebsite ?? null,
      };
    }),
    ...employerJobsAsRoles,
  ];

  if (regulatorRoles.length === 0) {
    res.json({ matches: [], dismissedRoleIds: [], totalCount: 0, cached: false });
    return;
  }

  const cutoff = new Date(Date.now() - SCORE_CACHE_TTL_MS);
  const cachedScores = await db
    .select()
    .from(candidateMatchScoresTable)
    .where(
      and(
        eq(candidateMatchScoresTable.userId, userId),
        gte(candidateMatchScoresTable.scoredAt, cutoff),
      ),
    );

  let scoreMap: Map<number, { score: number; explanation: string }>;
  let cached = false;

  const cachedRoleIds = new Set(cachedScores.map((s) => s.roleId));
  const allCovered = regulatorRoles.every((r) => cachedRoleIds.has(r.id));

  if (allCovered && cachedScores.length > 0) {
    scoreMap = new Map(cachedScores.map((s) => [s.roleId, { score: s.score, explanation: s.aiExplanation }]));
    cached = true;
  } else {
    scoreMap = await batchScoreRoles(
      {
        profession: profile.profession,
        specialty: profile.specialty,
        experienceYears: profile.experienceYears,
        qualificationCountry: profile.qualificationCountry,
        registrationStatus: profile.registrationStatus,
        requiresSponsorship: profile.requiresSponsorship,
      },
      regulatorRoles,
    );

    await db.delete(candidateMatchScoresTable).where(eq(candidateMatchScoresTable.userId, userId));
    if (regulatorRoles.length > 0) {
      await db.insert(candidateMatchScoresTable).values(
        regulatorRoles.map((r) => ({
          userId,
          roleId: r.id,
          score: scoreMap.get(r.id)?.score ?? 50,
          aiExplanation: scoreMap.get(r.id)?.explanation ?? "Profile matched to role requirements.",
        })),
      );
    }
  }

  const dismissals = await db
    .select({ roleId: matchDismissalsTable.roleId })
    .from(matchDismissalsTable)
    .where(eq(matchDismissalsTable.userId, userId));
  const dismissedRoleIds = dismissals.map((d) => d.roleId);
  const dismissedSet = new Set(dismissedRoleIds);

  // Career profile focus-area boost (same logic as /opportunities/recommended)
  const focusAreaWords = activeCareerProfile?.focusArea
    ? activeCareerProfile.focusArea.toLowerCase().split(/\s+/).filter(Boolean)
    : [];
  const effectiveSpecialty = activeCareerProfile?.focusArea ?? profile.specialty ?? "";

  const allSortedMatches = regulatorRoles
    .filter((r) => !dismissedSet.has(r.id))
    .map((r) => {
      const reqReg = r.requiredRegistration.toLowerCase();
      const roleRequiresFull = reqReg.includes("full") || reqReg.includes("registered");
      const meetsRegistration = roleRequiresFull ? isRegistered || isLicenceReady : true;
      const isEligible = userIsEligible && meetsRegistration;

      const eligibilityGaps: string[] = [];
      if (!isEligible && decision) {
        if (!meetsRegistration) {
          eligibilityGaps.push(
            `Full registration required. Your current status: ${profile.registrationStatus?.replace(/_/g, " ") ?? "not set"}.`,
          );
        }
        if (!userIsEligible && decision.explanationText) {
          eligibilityGaps.push(decision.explanationText);
        }
      }

      const baseScore = scoreMap.get(r.id)?.score ?? 50;
      const baseExplanation = scoreMap.get(r.id)?.explanation ?? "Profile matched to role requirements.";

      // Boost score if the role title matches career profile focus-area keywords
      const titleLower = r.title.toLowerCase();
      const boost = focusAreaWords.filter((w) => titleLower.includes(w)).length * 8;
      const aiScore = Math.min(100, baseScore + boost);
      const aiExplanation =
        boost > 0 && effectiveSpecialty
          ? `${baseExplanation} Aligned with your career focus: ${effectiveSpecialty}.`
          : baseExplanation;

      return {
        roleId: r.id,
        title: r.title,
        employer: r.employer,
        location: r.location,
        regulator: r.regulator,
        sponsorshipOffered: r.sponsorshipOffered,
        requiredRegistration: r.requiredRegistration,
        applyUrl: r.applyUrl ?? null,
        linkVerified: r.linkVerified ?? false,
        linkCheckedAt: r.linkCheckedAt ?? null,
        contactEmail: r.contactEmail ?? null,
        contactPhone: r.contactPhone ?? null,
        contactWebsite: r.contactWebsite ?? null,
        aiScore,
        aiExplanation,
        isEligible,
        eligibilityGaps,
        careerProfileId: activeCareerProfile?.id ?? null,
      };
    })
    .sort((a, b) => {
      if (a.isEligible !== b.isEligible) return a.isEligible ? -1 : 1;
      return b.aiScore - a.aiScore;
    });

  const totalCount = allSortedMatches.length;
  const matches = allSortedMatches.slice(offset, offset + limit);

  res.json({ matches, dismissedRoleIds, totalCount, cached });
});

// ── GET /opportunities/recommended — top-N matched roles for the dashboard ────

router.get("/opportunities/recommended", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const limit = Math.min(10, Math.max(1, parseInt(String(req.query.limit ?? "3"), 10) || 3));

  const [[profile], [activeCareerProfile]] = await Promise.all([
    db.select().from(profilesTable).where(eq(profilesTable.userId, userId)),
    db.select().from(careerProfilesTable).where(and(eq(careerProfilesTable.userId, userId), eq(careerProfilesTable.isActive, true))),
  ]);
  if (!profile?.profession) {
    res.json({ roles: [] });
    return;
  }

  const regulator = regulatorForProfession(profile.profession);
  if (!regulator) {
    res.json({ roles: [] });
    return;
  }

  const [decision] = await db
    .select()
    .from(decisionRecordsTable)
    .where(eq(decisionRecordsTable.userId, userId))
    .orderBy(desc(decisionRecordsTable.createdAt))
    .limit(1);

  const isRegistered =
    profile.registrationStatus != null &&
    REGISTERED_STATUSES.includes(profile.registrationStatus.toLowerCase());
  const isLicenceReady = profile.licenceReady === true;
  const userIsEligible = decision?.outcome === "eligible";

  const allRoles = await db.select().from(rolesTable).where(and(eq(rolesTable.active, true), HAS_CONTACT_INFO));
  const publishedJobListings = await db
    .select({ job: jobListingsTable, emp: employerProfilesTable })
    .from(jobListingsTable)
    .innerJoin(employerProfilesTable, eq(jobListingsTable.employerProfileId, employerProfilesTable.id))
    .where(eq(jobListingsTable.status, "published"));

  const employerJobsAsRoles = publishedJobListings
    .filter((row) => {
      if (row.job.regulator !== regulator) return false;
      const tp = (row.job.targetProfessions ?? []) as string[];
      if (tp.length > 0 && !tp.includes(profile.profession)) return false;
      if (!employerJobHasContactInfo(row)) return false;
      return true;
    })
    .map((row) => {
      const link = presentApplyLink(row.job.applyUrl, row.job.liveness, row.job.lastVerifiedAt);
      return {
        id: row.job.id + 1_000_000,
        title: row.job.title,
        employer: row.emp.companyName,
        location: row.job.location,
        regulator: row.job.regulator as "GMC" | "NMC" | "HCPC",
        sponsorshipOffered: row.job.sponsorshipOffered,
        requiredRegistration: row.job.requiredRegistration,
        applyUrl: link.applyUrl,
        linkVerified: link.linkVerified,
        linkCheckedAt: link.linkCheckedAt,
        contactEmail: row.emp.contactEmail ?? null,
        contactPhone: row.emp.contactPhone ?? null,
        contactWebsite: row.emp.contactWebsite ?? null,
      };
    });

  // Fetch roles already applied to via both standard and speculative paths
  const [appliedRows, speculativeRows] = await Promise.all([
    db.select({ roleId: applicationsTable.roleId })
      .from(applicationsTable)
      .where(eq(applicationsTable.userId, userId)),
    db.select({ companyName: speculativeApplicationsTable.companyName })
      .from(speculativeApplicationsTable)
      .where(eq(speculativeApplicationsTable.userId, userId)),
  ]);
  const appliedIds = new Set(appliedRows.map((a) => a.roleId).filter(Boolean) as number[]);
  const speculativeCompanies = new Set(speculativeRows.map((s) => s.companyName.toLowerCase()));

  const regulatorRoles = [
    ...allRoles
      .filter((r) => r.regulator === regulator && !appliedIds.has(r.id) && !speculativeCompanies.has(r.employer.toLowerCase()))
      .map((r) => {
        const link = presentApplyLink(r.applyUrl, r.liveness, r.lastVerifiedAt);
        return {
          id: r.id, title: r.title, employer: r.employer, location: r.location,
          regulator: r.regulator, sponsorshipOffered: r.sponsorshipOffered,
          requiredRegistration: r.requiredRegistration, applyUrl: link.applyUrl,
          linkVerified: link.linkVerified,
          linkCheckedAt: link.linkCheckedAt,
          contactEmail: r.contactEmail ?? null,
          contactPhone: r.contactPhone ?? null,
          contactWebsite: r.contactWebsite ?? null,
        };
      }),
    ...employerJobsAsRoles.filter((r) => !appliedIds.has(r.id) && !speculativeCompanies.has(r.employer.toLowerCase())),
  ];

  if (regulatorRoles.length === 0) {
    res.json({ roles: [] });
    return;
  }

  // Use cached match scores if available — avoid expensive AI re-scoring
  const cutoff = new Date(Date.now() - SCORE_CACHE_TTL_MS);
  const cachedScores = await db
    .select()
    .from(candidateMatchScoresTable)
    .where(and(eq(candidateMatchScoresTable.userId, userId), gte(candidateMatchScoresTable.scoredAt, cutoff)));
  const scoreMap = new Map(cachedScores.map((s) => [s.roleId, s.score]));

  const focusAreaLower = activeCareerProfile?.focusArea?.toLowerCase() ?? null;

  const scored = regulatorRoles.map((r) => {
    const reqReg = r.requiredRegistration.toLowerCase();
    const roleRequiresFull = reqReg.includes("full") || reqReg.includes("registered");
    const meetsRegistration = roleRequiresFull ? isRegistered || isLicenceReady : true;
    const isEligible = userIsEligible && meetsRegistration;
    // AI score if cached, else heuristic
    let matchScore = scoreMap.get(r.id) ?? computeMatchScore(
      { ...r, id: r.id, regulator: r.regulator, active: true, importedAt: new Date(), importedBy: "", liveness: "unverified" as const, lastVerifiedAt: null, livenessReason: null },
      isEligible,
      profile.requiresSponsorship,
    );
    // Boost score when the active career profile's focus area matches the role title/location
    if (focusAreaLower) {
      const titleLower = r.title.toLowerCase();
      const words = focusAreaLower.split(/\s+/);
      const matchCount = words.filter((w: string) => w.length > 3 && titleLower.includes(w)).length;
      if (matchCount > 0) matchScore = Math.min(100, matchScore + matchCount * 8);
    }
    const effectiveSpecialty = activeCareerProfile?.focusArea ?? profile.specialty;
    const matchReason = deriveMatchReason(r, isEligible, profile.requiresSponsorship, effectiveSpecialty);
    return { ...r, matchScore, isEligible, matchReason, careerProfileId: activeCareerProfile?.id ?? null };
  });

  scored.sort((a, b) => {
    if (a.isEligible !== b.isEligible) return a.isEligible ? -1 : 1;
    return b.matchScore - a.matchScore;
  });

  res.json({ roles: scored.slice(0, limit) });
});

router.post("/roles/dismiss-match", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { roleId } = req.body as { roleId: number };

  if (!roleId || typeof roleId !== "number") {
    res.status(400).json({ error: "roleId is required." });
    return;
  }

  await db
    .insert(matchDismissalsTable)
    .values({ userId, roleId })
    .onConflictDoNothing();

  res.json({ ok: true });
});

router.get("/admin/roles", requireRole("admin"), async (_req, res): Promise<void> => {
  const roles = await db.select().from(rolesTable).orderBy(desc(rolesTable.importedAt));
  res.json({ roles });
});

// ── POST /admin/link-scan — full fresh scan of ALL stored apply links ────────
router.post("/admin/link-scan", requireRole("admin", "super_admin"), (req, res): void => {
  const adminId = req.user!.id;
  if (getFullScanStatus().isRunning) {
    res.json({ started: false, status: getFullScanStatus() });
    return;
  }
  runFullLivenessScan().catch((err) => {
    console.error("[link-scan] Full scan error:", err);
  });
  db.insert(auditEventsTable)
    .values({ actor: adminId, action: "full_link_scan_triggered", target: undefined, details: {} })
    .catch(() => {});
  res.status(202).json({ started: true, status: getFullScanStatus() });
});

router.get("/admin/link-scan/status", requireRole("admin", "super_admin"), (_req, res): void => {
  res.json(getFullScanStatus());
});

// ── GET /admin/roles/backfill-apply-urls/status ───────────────────────────────
router.get(
  "/admin/roles/backfill-apply-urls/status",
  requireRole("admin"),
  (_req, res): void => {
    res.json({ lastRun: getLastBackfillSummary() });
  },
);

// ── POST /admin/roles/backfill-apply-urls ─────────────────────────────────────
router.post(
  "/admin/roles/backfill-apply-urls",
  requireRole("admin"),
  (req, res): void => {
    const adminId = req.user!.id;
    // Fire-and-forget in background — returns 202 immediately
    runApplyUrlBackfill({ triggeredBy: "manual", batchSize: 50 }).catch((err) => {
      console.error("[apply-url-backfill] Manual trigger error:", err);
    });

    db.insert(auditEventsTable)
      .values({
        actor: adminId,
        action: "apply_url_backfill_triggered",
        target: undefined,
        details: { triggeredBy: "manual" },
      })
      .catch(() => {});

    res.status(202).json({ queued: true });
  },
);

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
    applyUrl: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    contactWebsite: string | null;
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

    const applyUrlRaw = row.applyUrl?.trim() ?? null;
    if (applyUrlRaw && !APPLY_URL_PATTERN.test(applyUrlRaw)) {
      errors.push({ row: rowNum, message: "applyUrl must be a valid http or https URL" });
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
      applyUrl: applyUrlRaw || null,
      contactEmail: row.contactEmail?.trim() || null,
      contactPhone: row.contactPhone?.trim() || null,
      contactWebsite: row.contactWebsite?.trim() || null,
    });
  }

  void OPTIONAL_COLUMNS; // referenced for documentation purposes

  const MANUAL_LABOUR_BLOCKLIST =
    /\b(housekeep|housework|cleaning|cleaner|domestic|catering|cook|kitchen|laundry|porter|portering|construction|groundskeep|groundskeeper|janitor|caretaker|security\s*guard|warehouse|driver|delivery|bin\s*collect|refuse|sewage|plumb|electri|carpent|bricklayer|scaffold|painter\s*decorator)\b/i;

  const blockedRows: Array<{ row: number; title: string }> = [];
  for (let i = 0; i < validRows.length; i++) {
    if (MANUAL_LABOUR_BLOCKLIST.test(validRows[i].title)) {
      blockedRows.push({ row: i + 2, title: validRows[i].title });
    }
  }

  if (blockedRows.length > 0) {
    res.status(400).json({
      error: `Import blocked: ${blockedRows.length} row(s) contain manual-labour or non-professional titles that cannot be imported under GMC/NMC/HCPC regulators. Remove or correct the following rows before re-importing.`,
      blockedRows: blockedRows.map((b) => ({ row: b.row, title: b.title })),
    });
    return;
  }

  if (validRows.length > 0) {
    const inserted = await db
      .insert(rolesTable)
      .values(validRows)
      .returning({ id: rolesTable.id, applyUrl: rolesTable.applyUrl });
    // Verify imported apply links right away (fire-and-forget) so freshly
    // imported roles don't sit unverified until the next background sweep.
    queueLinkVerificationBatch(
      inserted.filter((r) => r.applyUrl).map((r) => ({ source: "role" as const, id: r.id, url: r.applyUrl })),
    );
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
