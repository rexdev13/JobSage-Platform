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
  vacancyFavoritesTable,
  sponsorLicenceBookmarksTable,
  sponsorLicencesTable,
  smartApplyDraftsTable,
  sponsorLicenceVacancyScoresTable,
  roleGapAnalysesTable,
  sponsorLicenceGapAnalysesTable,
} from "@workspace/db";
import { eq, desc, and, inArray, gte, or, isNotNull, ne, sql } from "drizzle-orm";
import { requireRole, requireAuthenticated } from "../middlewares/requireRole";
import { assessSponsorshipFeasibility } from "../lib/sponsorshipFeasibility";
import { batchScoreRoles } from "../lib/candidateAiMatch";
import { careerProfilesTable } from "@workspace/db";
import { runApplyUrlBackfill, getLastBackfillSummary } from "../lib/applyUrlBackfill";
import { runSponsorVacancyApplyUrlBackfill, getLastSponsorVacancyBackfillSummary } from "../lib/sponsorVacancyApplyUrlBackfill";
import { queueLinkVerificationBatch } from "../lib/linkVerification";
import { runFullLivenessScan, getFullScanStatus } from "../lib/vacancyLivenessSweep";
import {
  fetchSponsorVacanciesAsRoles,
  presentApplyLink,
  roleDedupKey,
  specialtyBoost,
  SPONSOR_VACANCY_ID_OFFSET,
} from "../lib/sponsorVacancyRoles";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  assessSafeguarding,
  safeguardingBlocksEligibility,
  safeguardingGapText,
  type SafeguardingAssessment,
} from "../lib/safeguarding";
import { normalizeRegion, normalizeRegionList, regionsOverlap } from "../lib/regionMatching";
import {
  calculateBehaviouralRanking,
  normalizeBehaviouralEmployer,
  type BehaviouralEngagement,
} from "../lib/behavioralRanking";
import { isManualLabourTitle } from "../lib/vacancyTitlePolicy";
import {
  TOP_MATCH_MIN_SCORE,
  compareOpportunityRanking,
  qualifiesForApplyFirst,
} from "../lib/opportunityRanking";
import { refreshCandidateBoardVacancies } from "../lib/candidateBoardDiscovery";

const router: IRouter = Router();

interface RoleGapResult {
  matchedRequirements: string[];
  gaps: string[];
  optimizationSteps: string[];
  generatedAt: string;
  fromCache: boolean;
}

const READINESS_CHECK_LIMIT = 10;
const READINESS_CHECK_TTL_DAYS = 7;
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

const OPTIONAL_COLUMNS = ["applyUrl", "contactEmail", "contactPhone", "contactWebsite", "targetRegions"];
const VALID_DBS_LEVELS = ["none", "basic", "standard", "enhanced"] as const;
const VALID_SAFEGUARDING_LEVELS = ["none", "level_1", "level_2"] as const;
const APPLY_URL_PATTERN = /^https?:\/\/.+/i;
const VALID_REGULATORS = ["GMC", "NMC", "HCPC"];

function roleMatchesPreferredRegions(
  targetRegions: readonly (string | null | undefined)[] | null | undefined,
  preferredRegion: readonly (string | null | undefined)[] | string | null | undefined,
): boolean {
  const preferred = Array.isArray(preferredRegion) ? preferredRegion : preferredRegion ? [preferredRegion] : [];
  return regionsOverlap(targetRegions, preferred);
}

function parseImportedRegions(raw: string | undefined): string[] | null {
  if (!raw?.trim()) return null;
  const values = raw.split(/[|;,]/).map((value) => value.trim()).filter(Boolean);
  const normalized = values.map(normalizeRegion);
  if (normalized.some((region) => region === null)) return null;
  return normalizeRegionList(normalized);
}

const REGISTERED_STATUSES = ["registered", "fully_registered", "full_registration"];

function regulatorForProfession(profession: string | null | undefined): "GMC" | "NMC" | "HCPC" | null {
  const p = profession?.toLowerCase().trim() ?? "";
  if (p === "doctor" || p === "clinical_academic") return "GMC";
  if (p === "nurse" || p === "midwife") return "NMC";
  if (p === "allied_health_professional") return "HCPC";
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

type BehaviouralRoleSource = {
  id: number;
  title: string;
  employer: string;
  regulator: string;
};

function buildBehaviouralSignals(
  favourites: Array<{ vacancyId: number }>,
  sponsorBookmarks: Array<{ organisationName: string }>,
  applications: Array<{
    roleId: number;
    status: string;
    jobTitle: string | null;
    companyName: string | null;
    appliedAt: Date | null;
  }>,
  roleCatalog: readonly BehaviouralRoleSource[],
) {
  const rolesById = new Map(roleCatalog.map((role) => [role.id, role]));
  const favouriteRoleIds = new Set(favourites.map((favourite) => favourite.vacancyId));
  const applicationReferences: BehaviouralEngagement[] = applications.map((application) => {
    const savedRole = rolesById.get(application.roleId);
    return {
      roleId: application.roleId,
      title: application.jobTitle ?? savedRole?.title ?? null,
      employer: application.companyName ?? savedRole?.employer ?? null,
      regulator: savedRole?.regulator ?? null,
      kind: application.status === "link_clicked" ? "link_clicked" : "applied",
      occurredAt: application.appliedAt,
    };
  });

  return {
    favouriteRoleIds,
    bookmarkedEmployers: new Set(
      sponsorBookmarks.map((bookmark) => normalizeBehaviouralEmployer(bookmark.organisationName)),
    ),
    engagements: applicationReferences,
  };
}

function computeMatchScore(
  role: typeof rolesTable.$inferSelect,
  isEligible: boolean,
  requiresSponsorship: boolean,
): number {
  // Base: eligibility is a meaningful signal but not a guarantee of quality fit.
  // Starting at 45 (not 60+) leaves room for real differentiators to separate roles.
  let score = isEligible ? 45 : 15;

  if (role.sponsorshipOffered && requiresSponsorship) {
    score += 20; // sponsorship match is the strongest positive signal
  } else if (!requiresSponsorship) {
    score += 10; // no visa barrier — modest boost
  }

  if (isEligible) {
    const reqReg = role.requiredRegistration.toLowerCase();
    if (!reqReg.includes("full") && !reqReg.includes("senior")) {
      score += 8; // less strict registration requirement — easier to qualify
    }
  }

  return Math.min(score, 100);
}

type ComplianceRole = {
  requiredDbsClearanceLevel?: "unknown" | "none" | "basic" | "standard" | "enhanced" | null;
  requiredSafeguardingLevel?: "unknown" | "none" | "level_1" | "level_2" | null;
};

function getRoleSafeguarding(
  role: ComplianceRole,
  profile: Pick<typeof profilesTable.$inferSelect, "dbsClearanceLevel" | "safeguardingTrainingLevel">,
): SafeguardingAssessment {
  return assessSafeguarding(profile, {
    requiredDbsClearanceLevel: role.requiredDbsClearanceLevel ?? null,
    requiredSafeguardingLevel: role.requiredSafeguardingLevel ?? null,
  });
}

function getRoleEligibilityGaps(
  role: { requiredRegistration: string } & ComplianceRole,
  profile: Pick<
    typeof profilesTable.$inferSelect,
    "registrationStatus" | "licenceReady" | "requiresSponsorship" | "dbsClearanceLevel" | "safeguardingTrainingLevel"
  >,
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
  gaps.push(...safeguardingGapText(getRoleSafeguarding(role, profile), profile));

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
  const sourceFilter =
    req.query.source === "job_board" || req.query.source === "company_site"
      ? req.query.source
      : null;
  if (req.query.source != null && sourceFilter == null) {
    res.status(400).json({ error: "source must be job_board or company_site." });
    return;
  }

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
  if (sourceFilter === "job_board") {
    await refreshCandidateBoardVacancies(profile);
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
      if (!roleMatchesPreferredRegions(tr, profile.preferredRegion)) return false;
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
        requiredDbsClearanceLevel: row.job.requiredDbsClearanceLevel,
        requiredSafeguardingLevel: row.job.requiredSafeguardingLevel,
         targetRegions: row.job.targetRegions ?? [],
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
        sourceType: "company_site" as const,
        boardName: null,
        externalListingId: null,
      };
    });

  // AI-discovered sponsor-licence vacancies (daily pipeline) — merged in so the
  // page self-populates without any admin CSV upload. Deduped below against
  // CSV roles and employer jobs by employer+title.
  const sponsorVacancyRoles = (await fetchSponsorVacanciesAsRoles(regulator, {
    requireSpecificVacancyUrl: sourceFilter === "job_board",
    onlyVerifiedLive: sourceFilter === "job_board",
  }))
    .filter((role) => roleMatchesPreferredRegions(role.targetRegions, profile.preferredRegion));

  const curatedRoles = [
     ...allRoles
       .filter((role) => role.regulator === regulator && roleMatchesPreferredRegions(role.targetRegions, profile.preferredRegion))
       .map((r) => {
      const link = presentApplyLink(r.applyUrl, r.liveness, r.lastVerifiedAt);
      return {
        ...r,
        contactEmail: r.contactEmail ?? null,
        contactPhone: r.contactPhone ?? null,
        contactWebsite: r.contactWebsite ?? null,
        applyUrl: link.applyUrl,
        linkVerified: link.linkVerified,
        linkCheckedAt: link.linkCheckedAt,
        sourceType: "company_site" as const,
        boardName: null,
        externalListingId: null,
      };
    }),
    ...employerJobsAsRoles,
  ];
  const curatedKeys = new Set(curatedRoles.map((r) => roleDedupKey(r.employer, r.title)));
  const sponsorRelevance = new Map<number, boolean>();
  const dedupedSponsorRoles = sponsorVacancyRoles
    .filter((v) => sourceFilter === "job_board" || !curatedKeys.has(roleDedupKey(v.employer, v.title)))
    .map((v) => {
      sponsorRelevance.set(v.id, v.classifiedRelevant);
      const { classifiedRelevant: _cr, description: _d, ...roleShape } = v;
      return roleShape;
    });
  const regulatorRoles = [...curatedRoles, ...dedupedSponsorRoles]
    .filter((role) => sourceFilter == null || role.sourceType === sourceFilter);

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

  const [appliedApps, vacancySpecificSpeculative, cachedAiScores, sponsorVacancyScores] = await Promise.all([
    db.select({ roleId: applicationsTable.roleId, status: applicationsTable.status }).from(applicationsTable).where(
      and(eq(applicationsTable.userId, userId), ne(applicationsTable.status, "link_clicked")),
    ),
    // Speculative CVs sent against a specific vacancy count as applied for the
    // matching role (badge, disabled buttons, Best Matches exclusion) without
    // creating an applications row — the tracker already lists them under
    // Speculative CVs, so no double-counting occurs.
    db
      .select({
        companyName: speculativeApplicationsTable.companyName,
        vacancyTitle: speculativeApplicationsTable.vacancyTitle,
      })
      .from(speculativeApplicationsTable)
      .where(and(eq(speculativeApplicationsTable.userId, userId), isNotNull(speculativeApplicationsTable.vacancyTitle))),
    db
      .select()
      .from(candidateMatchScoresTable)
      .where(
        and(
          eq(candidateMatchScoresTable.userId, userId),
          gte(candidateMatchScoresTable.scoredAt, new Date(Date.now() - SCORE_CACHE_TTL_MS)),
        ),
      ),
    // Pre-computed per-candidate sponsor-vacancy fit scores (nightly pipeline).
    // No TTL cutoff: the pipeline owns freshness, and a stale score beats none.
    db
      .select({
        vacancyId: sponsorLicenceVacancyScoresTable.vacancyId,
        score: sponsorLicenceVacancyScoresTable.score,
        explanation: sponsorLicenceVacancyScoresTable.explanation,
      })
      .from(sponsorLicenceVacancyScoresTable)
      .where(eq(sponsorLicenceVacancyScoresTable.userId, userId)),
  ]);
  const speculativeVacancyKeys = new Set(
    vacancySpecificSpeculative
      .filter((s) => (s.vacancyTitle ?? "").trim() !== "")
      .map((s) => `${s.companyName.trim().toLowerCase()}|${s.vacancyTitle!.trim().toLowerCase()}`),
  );
  const speculativeAppliedRoleIds =
    speculativeVacancyKeys.size > 0
      ? regulatorRoles
          .filter((r) => speculativeVacancyKeys.has(`${r.employer.trim().toLowerCase()}|${r.title.trim().toLowerCase()}`))
          .map((r) => r.id)
      : [];
  const appliedRoleIds = [...new Set([
    ...appliedApps
      .filter((application) => application.status !== "link_clicked")
      .map((application) => application.roleId),
    ...speculativeAppliedRoleIds,
  ])];

  // Build a lookup from the persisted AI scores so the roles response can
  // sort and badge each card with the same value the /my-matches strip uses.
  const aiScoreMap = new Map<number, { score: number; explanation: string | null }>(
    cachedAiScores.map((s) => [s.roleId, { score: s.score, explanation: s.aiExplanation }]),
  );
  // Sponsor vacancies use their pre-computed pipeline scores as the AI score.
  for (const s of sponsorVacancyScores) {
    aiScoreMap.set(s.vacancyId + SPONSOR_VACANCY_ID_OFFSET, {
      score: s.score,
      explanation: s.explanation ?? "Match based on your profile and vacancy details.",
    });
  }

  const rulesetVersion = decision?.rulesetVersion ?? "—";
  const decisionRecordId = decision?.id ?? null;

  const specialtyWords = (profile.specialty ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const result = regulatorRoles.map((role) => {
    const professionallyRelevant =
      sponsorRelevance.get(role.id) !== false && !isManualLabourTitle(role.title);
    const reqReg = role.requiredRegistration.toLowerCase();
    const roleRequiresFull = reqReg.includes("full") || reqReg.includes("registered");
    const meetsRegistration = roleRequiresFull ? isRegistered || isLicenceReady : true;
    const safeguarding = getRoleSafeguarding(role, profile);
    const meetsSafeguarding = !safeguardingBlocksEligibility(safeguarding);

    let isEligible: boolean;
    let eligibilityGaps: string[] = [];

    if (!decision) {
      isEligible = false;
      eligibilityGaps = ["Run your eligibility check to see which roles you qualify for."];
    } else if (!userIsEligible) {
      isEligible = false;
      eligibilityGaps = getRoleEligibilityGaps(role, profile, decision.explanationText);
    } else {
      isEligible = meetsRegistration && meetsSafeguarding;
      if (!isEligible) {
        eligibilityGaps = getRoleEligibilityGaps(role, profile, null);
      }
    }
    if (!professionallyRelevant) {
      isEligible = false;
      eligibilityGaps = ["This vacancy is outside your professional scope."];
    }

    const sponsorshipFeasibility =
      profile.requiresSponsorship ? assessSponsorshipFeasibility(role, profile.requiresSponsorship) : null;

    const professionLabel = profile.profession.replace(/_/g, " ");
    const explanation = !professionallyRelevant
      ? "This vacancy is outside your professional scope."
      : isEligible
      ? `Matched as eligible for ${regulator} registration (${professionLabel}). Ruleset v${rulesetVersion}, decision #${decisionRecordId}${eligibleRuleId ? `, rule #${eligibleRuleId}` : ""}.`
      : decision
        ? `Not yet eligible for this role. Complete your remediation steps to qualify.`
        : `Run your eligibility assessment to see your match status for this role.`;

    const cached = aiScoreMap.get(role.id);

    // Relevance: specialty/focus keywords boost the heuristic score, and
    // sponsor vacancies whose title never mapped to the candidate's regulator
    // are bottom-ranked instead of competing with clearly relevant roles.
    let matchScore = computeMatchScore(role as typeof rolesTable.$inferSelect, isEligible, profile.requiresSponsorship);
    matchScore = Math.min(100, matchScore + specialtyBoost(role.title, specialtyWords));
    if (!professionallyRelevant) {
      matchScore = 0;
    }

    return {
      role: professionallyRelevant
        ? role
        : { ...role, requiredRegistration: "Not applicable — outside your professional scope" },
      explanation,
      rulesetVersion,
      decisionRecordId: decisionRecordId ?? 0,
      ruleId: eligibleRuleId,
      sponsorshipFeasibility,
      isEligible,
      matchScore,
      aiScore: professionallyRelevant ? cached?.score ?? null : 0,
      aiExplanation: professionallyRelevant ? cached?.explanation ?? null : "Out of professional scope",
      eligibilityGaps,
      safeguarding,
      contactEmail: role.contactEmail ?? null,
      contactPhone: role.contactPhone ?? null,
      contactWebsite: role.contactWebsite ?? null,
      applyUrl: role.applyUrl ?? null,
      linkVerified: role.linkVerified ?? false,
      linkCheckedAt: role.linkCheckedAt ?? null,
    };
  });

  result.sort(compareOpportunityRanking);

  let recommendationCount = 0;
  const rankedRoles = result.map((role) => {
    const recommended = recommendationCount < 5 && qualifiesForApplyFirst(role);
    if (recommended) recommendationCount += 1;
    return { ...role, recommended };
  });

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
  const sourceFilter =
    req.query.source === "job_board" || req.query.source === "company_site"
      ? req.query.source
      : null;
  if (req.query.source != null && sourceFilter == null) {
    res.status(400).json({ error: "source must be job_board or company_site." });
    return;
  }

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
  if (sourceFilter === "job_board") {
    await refreshCandidateBoardVacancies(profile);
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
        if (!roleMatchesPreferredRegions(job.targetRegions, profile.preferredRegion)) return false;
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
        requiredDbsClearanceLevel: row.job.requiredDbsClearanceLevel,
        requiredSafeguardingLevel: row.job.requiredSafeguardingLevel,
        targetRegions: row.job.targetRegions ?? [],
        applyUrl: link.applyUrl,
        linkVerified: link.linkVerified,
        linkCheckedAt: link.linkCheckedAt,
        contactEmail: row.emp.contactEmail ?? null,
        contactPhone: row.emp.contactPhone ?? null,
        contactWebsite: row.emp.contactWebsite ?? null,
        sourceType: "company_site" as const,
        boardName: null,
        externalListingId: null,
      };
    });

  // AI-discovered sponsor-licence vacancies. Only vacancies clearly classified
  // to the candidate's regulator qualify for the Best Matches strip; ambiguous
  // ones stay on the main board (bottom-ranked) instead.
  const sponsorVacancyRoles = (await fetchSponsorVacanciesAsRoles(regulator, {
    requireSpecificVacancyUrl: sourceFilter === "job_board",
    onlyVerifiedLive: sourceFilter === "job_board",
  }))
    .filter((role) => roleMatchesPreferredRegions(role.targetRegions, profile.preferredRegion));

  const curatedRoles = [
     ...allRoles
       .filter((r) => r.regulator === regulator && roleMatchesPreferredRegions(r.targetRegions, profile.preferredRegion))
       .map((r) => {
      const link = presentApplyLink(r.applyUrl, r.liveness, r.lastVerifiedAt);
      return {
        id: r.id, title: r.title, employer: r.employer, location: r.location,
        regulator: r.regulator, sponsorshipOffered: r.sponsorshipOffered,
        requiredRegistration: r.requiredRegistration,
        requiredDbsClearanceLevel: r.requiredDbsClearanceLevel,
        requiredSafeguardingLevel: r.requiredSafeguardingLevel,
         targetRegions: r.targetRegions ?? [],
        applyUrl: link.applyUrl,
        linkVerified: link.linkVerified,
        linkCheckedAt: link.linkCheckedAt,
        contactEmail: r.contactEmail ?? null,
        contactPhone: r.contactPhone ?? null,
        contactWebsite: r.contactWebsite ?? null,
        sourceType: "company_site" as const,
        boardName: null,
        externalListingId: null,
      };
    }),
    ...employerJobsAsRoles,
  ];
  const curatedKeys = new Set(curatedRoles.map((r) => roleDedupKey(r.employer, r.title)));
  const sponsorRoles = sponsorVacancyRoles
    .filter((v) => v.classifiedRelevant && (sourceFilter === "job_board" || !curatedKeys.has(roleDedupKey(v.employer, v.title))))
    .map((v) => ({
      id: v.id, title: v.title, employer: v.employer, location: v.location,
      regulator: v.regulator, sponsorshipOffered: v.sponsorshipOffered,
      requiredRegistration: v.requiredRegistration,
      requiredDbsClearanceLevel: v.requiredDbsClearanceLevel,
      requiredSafeguardingLevel: v.requiredSafeguardingLevel,
       targetRegions: v.targetRegions ?? [],
      applyUrl: v.applyUrl,
      linkVerified: v.linkVerified,
      linkCheckedAt: v.linkCheckedAt,
      contactEmail: v.contactEmail,
      contactPhone: v.contactPhone,
      contactWebsite: v.contactWebsite,
      sourceType: v.sourceType,
      boardName: v.boardName,
      externalListingId: v.externalListingId,
    }));
  const regulatorRoles = [...curatedRoles, ...sponsorRoles]
    .filter((role) => !isManualLabourTitle(role.title))
    .filter((role) => sourceFilter == null || role.sourceType === sourceFilter);

  if (regulatorRoles.length === 0) {
    res.json({ matches: [], dismissedRoleIds: [], totalCount: 0, cached: false });
    return;
  }

  const cutoff = new Date(Date.now() - SCORE_CACHE_TTL_MS);
  const [applications, cachedScores, sponsorVacancyScores, favourites, sponsorBookmarks] = await Promise.all([
    db
      .select({
        roleId: applicationsTable.roleId,
        status: applicationsTable.status,
        jobTitle: applicationsTable.jobTitle,
        companyName: applicationsTable.companyName,
        appliedAt: applicationsTable.appliedAt,
      })
      .from(applicationsTable)
      .where(eq(applicationsTable.userId, userId)),
    db
      .select()
      .from(candidateMatchScoresTable)
      .where(
        and(
          eq(candidateMatchScoresTable.userId, userId),
          gte(candidateMatchScoresTable.scoredAt, cutoff),
        ),
      ),
    // Pre-computed pipeline scores for sponsor vacancies — never re-scored here.
    db
      .select({
        vacancyId: sponsorLicenceVacancyScoresTable.vacancyId,
        score: sponsorLicenceVacancyScoresTable.score,
        explanation: sponsorLicenceVacancyScoresTable.explanation,
      })
      .from(sponsorLicenceVacancyScoresTable)
      .where(eq(sponsorLicenceVacancyScoresTable.userId, userId)),
    db
      .select({ vacancyId: vacancyFavoritesTable.vacancyId })
      .from(vacancyFavoritesTable)
      .where(eq(vacancyFavoritesTable.userId, userId)),
    db
      .select({ organisationName: sponsorLicencesTable.organisationName })
      .from(sponsorLicenceBookmarksTable)
      .innerJoin(sponsorLicencesTable, eq(sponsorLicenceBookmarksTable.sponsorLicenceId, sponsorLicencesTable.id))
      .where(eq(sponsorLicenceBookmarksTable.userId, userId)),
  ]);
  const completedApplicationRoleIds = new Set(
    applications
      .filter((application) => application.status !== "link_clicked")
      .map((application) => application.roleId),
  );

  let scoreMap: Map<number, { score: number; explanation: string }>;
  let cached = false;

  const cachedRoleIds = new Set(cachedScores.map((s) => s.roleId));
  // Coverage is judged over curated roles only: sponsor vacancies are scored
  // by the nightly pipeline, so a new sponsor vacancy must never trigger a
  // full AI re-score of the whole catalogue here.
  const allCovered = curatedRoles.every((r) => cachedRoleIds.has(r.id));

  if (curatedRoles.length === 0 || (allCovered && cachedScores.length > 0)) {
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
      curatedRoles,
    );

    await db.delete(candidateMatchScoresTable).where(eq(candidateMatchScoresTable.userId, userId));
    // Only persist rows the AI actually scored — never store the placeholder
    // fallback (50) as if it were a real match score, which inflates the strip.
    const actuallyScored = curatedRoles.filter((r) => scoreMap.has(r.id));
    if (actuallyScored.length > 0) {
      await db.insert(candidateMatchScoresTable).values(
        actuallyScored.map((r) => ({
          userId,
          roleId: r.id,
          score: scoreMap.get(r.id)!.score,
          aiExplanation: scoreMap.get(r.id)!.explanation,
        })),
      );
    }
  }

  // Merge sponsor-vacancy pipeline scores into the same lookup. Unscored
  // sponsor vacancies (discovered since the last pipeline pass) fall back to
  // the neutral default below rather than triggering any request-time scoring.
  for (const s of sponsorVacancyScores) {
    scoreMap.set(s.vacancyId + SPONSOR_VACANCY_ID_OFFSET, {
      score: s.score,
      explanation: s.explanation ?? "Match based on your profile and vacancy details.",
    });
  }
  for (const sponsorRole of sponsorRoles) {
    if (!scoreMap.has(sponsorRole.id)) {
      scoreMap.set(sponsorRole.id, {
        score: 50,
        explanation: "Match score pending the next sponsor-vacancy scoring run.",
      });
    }
  }

  const dismissals = await db
    .select({ roleId: matchDismissalsTable.roleId })
    .from(matchDismissalsTable)
    .where(eq(matchDismissalsTable.userId, userId));
  const dismissedRoleIds = dismissals.map((d) => d.roleId);
  const dismissedSet = new Set(dismissedRoleIds);
  const behaviouralSignals = buildBehaviouralSignals(favourites, sponsorBookmarks, applications, regulatorRoles);

  // Career profile focus-area boost (same logic as /opportunities/recommended)
  const focusAreaWords = activeCareerProfile?.focusArea
    ? activeCareerProfile.focusArea.toLowerCase().split(/\s+/).filter(Boolean)
    : [];
  const effectiveSpecialty = activeCareerProfile?.focusArea ?? profile.specialty ?? "";

  const allSortedMatches = regulatorRoles
    // Sponsor vacancies without a pipeline score use the transient neutral
    // fallback above; no placeholder score is persisted or triggers AI work.
    .filter((r) => !dismissedSet.has(r.id) && !completedApplicationRoleIds.has(r.id) && scoreMap.has(r.id))
    .map((r) => {
      const reqReg = r.requiredRegistration.toLowerCase();
      const roleRequiresFull = reqReg.includes("full") || reqReg.includes("registered");
      const meetsRegistration = roleRequiresFull ? isRegistered || isLicenceReady : true;
      const safeguarding = getRoleSafeguarding(r, profile);
      const isEligible = userIsEligible && meetsRegistration && !safeguardingBlocksEligibility(safeguarding);

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
        eligibilityGaps.push(...safeguardingGapText(safeguarding, profile));
      }

      const baseScore = scoreMap.get(r.id)!.score;
      const baseExplanation = scoreMap.get(r.id)!.explanation;

      // Boost score if the role title matches career profile focus-area keywords
      const titleLower = r.title.toLowerCase();
      const boost = focusAreaWords.filter((w) => titleLower.includes(w)).length * 8;
      const aiScore = Math.min(100, baseScore + boost);
      const aiExplanation =
        boost > 0 && effectiveSpecialty
          ? `${baseExplanation} Aligned with your career focus: ${effectiveSpecialty}.`
          : baseExplanation;
      const behaviouralRanking = calculateBehaviouralRanking(r, behaviouralSignals);

      return {
        roleId: r.id,
        title: r.title,
        employer: r.employer,
        location: r.location,
        regulator: r.regulator,
        sponsorshipOffered: r.sponsorshipOffered,
        requiredRegistration: r.requiredRegistration,
        requiredDbsClearanceLevel: r.requiredDbsClearanceLevel ?? null,
        requiredSafeguardingLevel: r.requiredSafeguardingLevel ?? null,
        applyUrl: r.applyUrl ?? null,
        linkVerified: r.linkVerified ?? false,
        linkCheckedAt: r.linkCheckedAt ?? null,
        contactEmail: r.contactEmail ?? null,
        contactPhone: r.contactPhone ?? null,
        contactWebsite: r.contactWebsite ?? null,
        aiScore: Math.min(100, aiScore + behaviouralRanking.boost),
        aiExplanation,
        matchReason: behaviouralRanking.reason,
        isEligible,
        safeguarding,
        eligibilityGaps,
        careerProfileId: activeCareerProfile?.id ?? null,
      };
    })
    .filter((match) => match.aiScore >= TOP_MATCH_MIN_SCORE)
    .sort((a, b) => {
      if (b.aiScore !== a.aiScore) return b.aiScore - a.aiScore;
      if (a.linkVerified !== b.linkVerified) return a.linkVerified ? -1 : 1;
      if (a.isEligible !== b.isEligible) return a.isEligible ? -1 : 1;
      return a.roleId - b.roleId;
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
        requiredDbsClearanceLevel: row.job.requiredDbsClearanceLevel,
        requiredSafeguardingLevel: row.job.requiredSafeguardingLevel,
        targetRegions: row.job.targetRegions ?? [],
        applyUrl: link.applyUrl,
        linkVerified: link.linkVerified,
        linkCheckedAt: link.linkCheckedAt,
        contactEmail: row.emp.contactEmail ?? null,
        contactPhone: row.emp.contactPhone ?? null,
        contactWebsite: row.emp.contactWebsite ?? null,
      };
    });

  // Fetch roles already applied to via both standard and speculative paths
  const [appliedRows, speculativeRows, favourites, sponsorBookmarks, dismissals] = await Promise.all([
    db.select({
      roleId: applicationsTable.roleId,
      status: applicationsTable.status,
      jobTitle: applicationsTable.jobTitle,
      companyName: applicationsTable.companyName,
      appliedAt: applicationsTable.appliedAt,
    })
      .from(applicationsTable)
      .where(eq(applicationsTable.userId, userId)),
    db.select({ companyName: speculativeApplicationsTable.companyName })
      .from(speculativeApplicationsTable)
      .where(eq(speculativeApplicationsTable.userId, userId)),
    db
      .select({ vacancyId: vacancyFavoritesTable.vacancyId })
      .from(vacancyFavoritesTable)
      .where(eq(vacancyFavoritesTable.userId, userId)),
    db
      .select({ organisationName: sponsorLicencesTable.organisationName })
      .from(sponsorLicenceBookmarksTable)
      .innerJoin(sponsorLicencesTable, eq(sponsorLicenceBookmarksTable.sponsorLicenceId, sponsorLicencesTable.id))
      .where(eq(sponsorLicenceBookmarksTable.userId, userId)),
    db
      .select({ roleId: matchDismissalsTable.roleId })
      .from(matchDismissalsTable)
      .where(eq(matchDismissalsTable.userId, userId)),
  ]);
  const appliedIds = new Set(
    appliedRows
      .filter((application) => application.status !== "link_clicked")
      .map((application) => application.roleId)
      .filter(Boolean) as number[],
  );
  const speculativeCompanies = new Set(speculativeRows.map((s) => s.companyName.toLowerCase()));
  const dismissedRoleIds = new Set(dismissals.map((dismissal) => dismissal.roleId));
  // Preserve role identity before completed applications are excluded so their
  // title, employer, and regulator can still guide similar future roles.
  const behaviouralRoleCatalog = [...allRoles, ...employerJobsAsRoles];

  const regulatorRoles = [
    ...allRoles
      .filter((r) =>
        r.regulator === regulator
        && !isManualLabourTitle(r.title)
        && !appliedIds.has(r.id)
        && !dismissedRoleIds.has(r.id)
        && !speculativeCompanies.has(r.employer.toLowerCase())
      )
      .map((r) => {
        const link = presentApplyLink(r.applyUrl, r.liveness, r.lastVerifiedAt);
        return {
          id: r.id, title: r.title, employer: r.employer, location: r.location,
          regulator: r.regulator, sponsorshipOffered: r.sponsorshipOffered,
          requiredRegistration: r.requiredRegistration,
          requiredDbsClearanceLevel: r.requiredDbsClearanceLevel,
          requiredSafeguardingLevel: r.requiredSafeguardingLevel,
        targetRegions: r.targetRegions ?? [],
          applyUrl: link.applyUrl,
          linkVerified: link.linkVerified,
          linkCheckedAt: link.linkCheckedAt,
          contactEmail: r.contactEmail ?? null,
          contactPhone: r.contactPhone ?? null,
          contactWebsite: r.contactWebsite ?? null,
        };
      }),
    ...employerJobsAsRoles.filter((r) =>
      !isManualLabourTitle(r.title)
      && !appliedIds.has(r.id)
      && !dismissedRoleIds.has(r.id)
      && !speculativeCompanies.has(r.employer.toLowerCase())
    ),
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
  const behaviouralSignals = buildBehaviouralSignals(favourites, sponsorBookmarks, appliedRows, behaviouralRoleCatalog);

  const focusAreaLower = activeCareerProfile?.focusArea?.toLowerCase() ?? null;

  const scored = regulatorRoles.map((r) => {
    const reqReg = r.requiredRegistration.toLowerCase();
    const roleRequiresFull = reqReg.includes("full") || reqReg.includes("registered");
    const meetsRegistration = roleRequiresFull ? isRegistered || isLicenceReady : true;
    const safeguarding = getRoleSafeguarding(r, profile);
    const isEligible = userIsEligible && meetsRegistration && !safeguardingBlocksEligibility(safeguarding);
    // AI score if cached, else heuristic
    let matchScore = scoreMap.get(r.id) ?? computeMatchScore(
      { ...r, id: r.id, regulator: r.regulator, active: true, importedAt: new Date(), importedBy: "", liveness: "unverified" as const, lastVerifiedAt: null, livenessReason: null, targetRegions: r.targetRegions ?? [] },
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
    const behaviouralRanking = calculateBehaviouralRanking(r, behaviouralSignals);
    const effectiveSpecialty = activeCareerProfile?.focusArea ?? profile.specialty;
    const matchReason = behaviouralRanking.reason ?? deriveMatchReason(r, isEligible, profile.requiresSponsorship, effectiveSpecialty);
    return {
      ...r,
      matchScore: Math.min(100, matchScore + behaviouralRanking.boost),
      isEligible,
      safeguarding,
      matchReason,
      careerProfileId: activeCareerProfile?.id ?? null,
    };
  });

  scored.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    if (a.linkVerified !== b.linkVerified) return a.linkVerified ? -1 : 1;
    if (a.isEligible !== b.isEligible) return a.isEligible ? -1 : 1;
    return a.id - b.id;
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

// ── DELETE /admin/roles/all — bulk-delete every role and dependent rows ─────
// Registered before /admin/roles/:id so "all" isn't parsed as an id.
router.delete("/admin/roles/all", requireRole("admin"), async (req, res): Promise<void> => {
  const adminId = req.user!.id;
  const allRoles = await db.select({ id: rolesTable.id }).from(rolesTable);
  const ids = allRoles.map((r) => r.id);

  if (ids.length === 0) {
    res.json({ deleted: 0 });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(applicationsTable).where(inArray(applicationsTable.roleId, ids));
    await tx.delete(candidateMatchScoresTable).where(inArray(candidateMatchScoresTable.roleId, ids));
    await tx.delete(matchDismissalsTable).where(inArray(matchDismissalsTable.roleId, ids));
    await tx.delete(smartApplyDraftsTable).where(inArray(smartApplyDraftsTable.roleId, ids));
    await tx.delete(rolesTable);
  });

  db.insert(auditEventsTable)
    .values({ actor: adminId, action: "roles_bulk_deleted", target: undefined, details: { deleted: ids.length } })
    .catch(() => {});

  res.json({ deleted: ids.length });
});

// ── DELETE /admin/roles/:id — delete a single role and dependent rows ───────
router.delete("/admin/roles/:id", requireRole("admin"), async (req, res): Promise<void> => {
  const adminId = req.user!.id;
  const roleId = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(roleId) || roleId <= 0) {
    res.status(400).json({ error: "Invalid role id." });
    return;
  }

  const [existing] = await db.select({ id: rolesTable.id }).from(rolesTable).where(eq(rolesTable.id, roleId));
  if (!existing) {
    res.status(404).json({ error: "Role not found." });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(applicationsTable).where(eq(applicationsTable.roleId, roleId));
    await tx.delete(candidateMatchScoresTable).where(eq(candidateMatchScoresTable.roleId, roleId));
    await tx.delete(matchDismissalsTable).where(eq(matchDismissalsTable.roleId, roleId));
    await tx.delete(smartApplyDraftsTable).where(eq(smartApplyDraftsTable.roleId, roleId));
    await tx.delete(rolesTable).where(eq(rolesTable.id, roleId));
  });

  db.insert(auditEventsTable)
    .values({ actor: adminId, action: "role_deleted", target: String(roleId), details: {} })
    .catch(() => {});

  res.json({ deleted: 1 });
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

// ── GET /admin/sponsor-vacancies/backfill-apply-urls/status ───────────────────
router.get(
  "/admin/sponsor-vacancies/backfill-apply-urls/status",
  requireRole("admin"),
  (_req, res): void => {
    res.json({ lastRun: getLastSponsorVacancyBackfillSummary() });
  },
);

// ── POST /admin/sponsor-vacancies/backfill-apply-urls ─────────────────────────
router.post(
  "/admin/sponsor-vacancies/backfill-apply-urls",
  requireRole("admin"),
  (req, res): void => {
    const adminId = req.user!.id;
    // Fire-and-forget — returns 202 immediately
    runSponsorVacancyApplyUrlBackfill({ triggeredBy: "manual", batchSize: 50 }).catch((err) => {
      console.error("[sponsor-vacancy-backfill] Manual trigger error:", err);
    });

    db.insert(auditEventsTable)
      .values({
        actor: adminId,
        action: "sponsor_vacancy_apply_url_backfill_triggered",
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
    targetRegions: string[] | null;
    requiredDbsClearanceLevel: (typeof VALID_DBS_LEVELS)[number] | null;
    requiredSafeguardingLevel: (typeof VALID_SAFEGUARDING_LEVELS)[number] | null;
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
    const dbsRequirement = row.requiredDbsClearanceLevel?.trim().toLowerCase() || null;
    if (dbsRequirement && !VALID_DBS_LEVELS.includes(dbsRequirement as (typeof VALID_DBS_LEVELS)[number])) {
      errors.push({ row: rowNum, message: `requiredDbsClearanceLevel must be one of: ${VALID_DBS_LEVELS.join(", ")}` });
      continue;
    }
    const safeguardingRequirement = row.requiredSafeguardingLevel?.trim().toLowerCase() || null;
    if (
      safeguardingRequirement &&
      !VALID_SAFEGUARDING_LEVELS.includes(safeguardingRequirement as (typeof VALID_SAFEGUARDING_LEVELS)[number])
    ) {
      errors.push({ row: rowNum, message: `requiredSafeguardingLevel must be one of: ${VALID_SAFEGUARDING_LEVELS.join(", ")}` });
      continue;
    }
    const targetRegions = parseImportedRegions(row.targetRegions);
    if (row.targetRegions?.trim() && targetRegions === null) {
      errors.push({
        row: rowNum,
        message: "targetRegions must contain only known UK regions, separated by commas or |",
      });
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
      targetRegions,
      requiredDbsClearanceLevel: dbsRequirement as (typeof VALID_DBS_LEVELS)[number] | null,
      requiredSafeguardingLevel: safeguardingRequirement as (typeof VALID_SAFEGUARDING_LEVELS)[number] | null,
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

// ── GET /opportunities/roles/:roleId/gap-analysis ─────────────────────────────
router.get("/opportunities/roles/:roleId/gap-analysis", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const roleId = parseInt(typeof req.params["roleId"] === "string" ? req.params["roleId"] : "", 10);
  if (isNaN(roleId)) { res.status(400).json({ error: "Invalid role ID." }); return; }

  try {
    // 1. Check DB cache (7-day TTL, same as sponsor vacancy checks)
    const ttlCutoff = new Date(Date.now() - READINESS_CHECK_TTL_DAYS * 24 * 60 * 60 * 1000);
    const [existing] = await db
      .select()
      .from(roleGapAnalysesTable)
      .where(and(
        eq(roleGapAnalysesTable.userId, userId),
        eq(roleGapAnalysesTable.roleId, roleId),
        sql`${roleGapAnalysesTable.generatedAt} > ${ttlCutoff}`,
      ))
      .limit(1);

    if (existing) {
      res.json({
        matchedRequirements: existing.matchedRequirements,
        gaps: existing.gaps,
        optimizationSteps: existing.optimizationSteps,
        generatedAt: existing.generatedAt.toISOString(),
        fromCache: true,
      });
      return;
    }

    // 2. Combined lifetime limit: count across both tables
    const [[sponsorCount], [roleCount]] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(sponsorLicenceGapAnalysesTable)
        .where(eq(sponsorLicenceGapAnalysesTable.userId, userId)),
      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(roleGapAnalysesTable)
        .where(eq(roleGapAnalysesTable.userId, userId)),
    ]);
    const totalUsed = (sponsorCount?.count ?? 0) + (roleCount?.count ?? 0);
    if (totalUsed >= READINESS_CHECK_LIMIT) {
      res.status(429).json({ error: "Readiness Check limit reached. You have used all 10 checks." });
      return;
    }

    // 3. Fetch role + profile in parallel
    const [[role], [profile]] = await Promise.all([
      db.select().from(rolesTable).where(eq(rolesTable.id, roleId)).limit(1),
      db.select().from(profilesTable).where(eq(profilesTable.userId, userId)).limit(1),
    ]);
    if (!role) { res.status(404).json({ error: "Role not found." }); return; }
    if (!profile) { res.status(400).json({ error: "No profile found. Complete your profile first." }); return; }

    const roleDescription = [
      `Job Title: ${role.title}`,
      `Employer: ${role.employer}`,
      `Location: ${role.location}`,
      `Regulator: ${role.regulator}`,
      `Required Registration / Qualification: ${role.requiredRegistration}`,
      role.sponsorshipOffered ? "UK visa sponsorship is offered for this role." : "Visa sponsorship status unknown.",
    ].join("\n");

    const profileText = [
      profile.profession ? `Profession: ${profile.profession}` : null,
      profile.specialty ? `Specialty: ${profile.specialty}` : null,
      profile.experienceYears != null ? `Years of experience: ${profile.experienceYears}` : null,
      profile.qualificationType ? `Qualification type: ${profile.qualificationType}` : null,
      profile.qualificationCountry ? `Qualification country: ${profile.qualificationCountry}` : null,
      profile.registrationStatus ? `Registration status: ${profile.registrationStatus}` : null,
      profile.residencyStatus ? `Residency/visa status: ${profile.residencyStatus}` : null,
    ].filter(Boolean).join("\n");

    // 4. Call gpt-4o-mini
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a UK recruitment expert helping healthcare and skilled-worker candidates understand how well their profile fits a specific job role. Respond only with valid JSON in this exact shape:
{
  "matchedRequirements": ["string", ...],
  "gaps": ["string", ...],
  "optimizationSteps": ["string", ...]
}
matchedRequirements: 2–5 specific strengths from the candidate's profile that match this role.
gaps: 1–4 honest gaps or missing information that may weaken the application.
optimizationSteps: 2–4 concrete, actionable steps to improve their chances for this specific role.
Be specific to this role and profile. Do not be generic. Do not repeat the same point across sections.`,
        },
        {
          role: "user",
          content: `ROLE:\n${roleDescription}\n\nCANDIDATE PROFILE:\n${profileText}`,
        },
      ],
      max_tokens: 800,
      temperature: 0.4,
    });

    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
      matchedRequirements?: unknown;
      gaps?: unknown;
      optimizationSteps?: unknown;
    };
    const toStringArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 6) : [];

    const matchedRequirements = toStringArray(raw.matchedRequirements);
    const gaps = toStringArray(raw.gaps);
    const optimizationSteps = toStringArray(raw.optimizationSteps);

    // 5. Upsert to DB
    await db.insert(roleGapAnalysesTable).values({
      userId,
      roleId,
      matchedRequirements: matchedRequirements as unknown as string[],
      gaps: gaps as unknown as string[],
      optimizationSteps: optimizationSteps as unknown as string[],
    }).onConflictDoUpdate({
      target: [roleGapAnalysesTable.userId, roleGapAnalysesTable.roleId],
      set: {
        matchedRequirements: matchedRequirements as unknown as string[],
        gaps: gaps as unknown as string[],
        optimizationSteps: optimizationSteps as unknown as string[],
        generatedAt: new Date(),
      },
    });

    res.json({ matchedRequirements, gaps, optimizationSteps, generatedAt: new Date().toISOString(), fromCache: false });
  } catch (err) {
    console.error("[opportunities] role gap analysis error:", err);
    res.status(500).json({ error: "Failed to generate gap analysis." });
  }
});

export default router;
