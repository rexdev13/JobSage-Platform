import cron from "node-cron";
import { db } from "@workspace/db";
import {
  profilesTable,
  rolesTable,
  decisionRecordsTable,
  usersTable,
  jobAlertVacancyDeliveriesTable,
  jobListingsTable,
  employerProfilesTable,
  candidateMatchScoresTable,
  sponsorLicenceVacancyScoresTable,
  vacancyFavoritesTable,
  sponsorLicenceBookmarksTable,
  sponsorLicencesTable,
  applicationsTable,
  careerProfilesTable,
} from "@workspace/db";
import { eq, desc, and, inArray, isNull, gte } from "drizzle-orm";
import { sendJobAlertEmail, type AlertRole } from "./email";
import {
  fetchSponsorVacanciesAsRoles,
  presentApplyLink,
  roleDedupKey,
  SPONSOR_VACANCY_ID_OFFSET,
  EMPLOYER_JOB_ID_OFFSET,
} from "./sponsorVacancyRoles";
import {
  categoryForStatutoryRegulator,
  opportunityCategoriesMatch,
  professionCategoryFor,
  type OpportunityCategory,
} from "./professionCategory";
import { isLikelyEditorialTitle, isManualLabourTitle } from "./vacancyTitlePolicy";
import { regionsOverlap } from "./regionMatching";
import { calculateBehaviouralRanking, normalizeBehaviouralEmployer } from "./behavioralRanking";
import { assessSafeguarding, safeguardingBlocksEligibility } from "./safeguarding";
import { compareOpportunityRanking } from "./opportunityRanking";
import { specialtyBoost } from "./sponsorVacancyRoles";

const REGISTERED_STATUSES = ["registered", "fully_registered", "full_registration"];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_AI_SCORE = 50;
const MAX_ALERT_ROLES = 5;

type AlertProcessResult = {
  sent: boolean;
  rolesIncluded: number;
  reason?: "no_category" | "no_top_matches" | "provider_rejected" | "claim_lost";
};

type AlertCandidateRole = {
  id: number;
  title: string;
  employer: string;
  location: string;
  regulator: string | null;
  targetRegions?: readonly string[] | null;
  sponsorshipOffered: boolean;
  requiredRegistration: string;
  requiredDbsClearanceLevel?: "unknown" | "none" | "basic" | "standard" | "enhanced" | null;
  requiredSafeguardingLevel?: "unknown" | "none" | "level_1" | "level_2" | null;
  applyUrl: string | null;
  linkVerified: boolean;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactWebsite?: string | null;
  sourceType: "company_site" | "job_board";
  sponsorVacancyId: number | null;
};

type ScoredAlertRole = AlertCandidateRole & {
  aiScore: number;
  matchScore: number;
  isEligible: boolean;
  deliveryKey: string;
};

function roleMatchesPreferredRegions(
  targetRegions: readonly (string | null | undefined)[] | null | undefined,
  preferredRegion: readonly (string | null | undefined)[] | string | null | undefined,
): boolean {
  const preferred = Array.isArray(preferredRegion)
    ? preferredRegion
    : preferredRegion
      ? [preferredRegion]
      : [];
  if (preferred.length === 0 || !targetRegions || targetRegions.length === 0) return true;
  return regionsOverlap(targetRegions, preferred);
}

function hasRoleContactInfo(role: {
  applyUrl?: string | null;
  liveness?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactWebsite?: string | null;
}): boolean {
  const applyUrl = role.liveness === "dead" ? null : role.applyUrl;
  return [applyUrl, role.contactEmail, role.contactPhone, role.contactWebsite]
    .some((value) => value != null && value.trim() !== "");
}

function hasEmployerJobContactInfo(row: {
  job: { applyUrl?: string | null; liveness?: string | null };
  emp: { contactEmail?: string | null; contactPhone?: string | null; contactWebsite?: string | null };
}): boolean {
  return hasRoleContactInfo({
    applyUrl: row.job.applyUrl,
    liveness: row.job.liveness,
    contactEmail: row.emp.contactEmail,
    contactPhone: row.emp.contactPhone,
    contactWebsite: row.emp.contactWebsite,
  });
}

function employerJobTargetsCategory(
  job: { regulator: string; targetProfessions?: readonly string[] | null },
  category: OpportunityCategory,
): boolean {
  if ((job.targetProfessions ?? []).length > 0) {
    return (job.targetProfessions ?? []).some((profession) =>
      opportunityCategoriesMatch(category, professionCategoryFor(profession)),
    );
  }
  return opportunityCategoriesMatch(category, categoryForStatutoryRegulator(job.regulator));
}

function buildAlertCandidates(
  profile: typeof profilesTable.$inferSelect,
  category: OpportunityCategory,
  storedRoles: Array<typeof rolesTable.$inferSelect>,
  publishedJobs: Array<{
    job: typeof jobListingsTable.$inferSelect;
    emp: typeof employerProfilesTable.$inferSelect;
  }>,
  sponsorRoles: Awaited<ReturnType<typeof fetchSponsorVacanciesAsRoles>>,
): AlertCandidateRole[] {
  const curatedRoles: AlertCandidateRole[] = storedRoles
    .filter((role) =>
      opportunityCategoriesMatch(category, categoryForStatutoryRegulator(role.regulator)) &&
      !isLikelyEditorialTitle(role.title) &&
      roleMatchesPreferredRegions(role.targetRegions, profile.preferredRegion) &&
      hasRoleContactInfo(role),
    )
    .map((role) => {
      const link = presentApplyLink(
        role.applyUrl,
        role.liveness,
        role.lastVerifiedAt,
        role.livenessReason,
        "company_site",
      );
      return {
        id: role.id,
        title: role.title,
        employer: role.employer,
        location: role.location,
        regulator: role.regulator,
        targetRegions: role.targetRegions ?? [],
        sponsorshipOffered: role.sponsorshipOffered,
        requiredRegistration: role.requiredRegistration,
        requiredDbsClearanceLevel: role.requiredDbsClearanceLevel,
        requiredSafeguardingLevel: role.requiredSafeguardingLevel,
        applyUrl: link.applyUrl,
        linkVerified: link.linkVerified,
        contactEmail: role.contactEmail,
        contactPhone: role.contactPhone,
        contactWebsite: role.contactWebsite,
        sourceType: "company_site",
        sponsorVacancyId: null,
      };
    });

  const employerJobs: AlertCandidateRole[] = publishedJobs
    .filter(({ job, emp }) =>
      employerJobTargetsCategory(job, category) &&
      roleMatchesPreferredRegions(job.targetRegions, profile.preferredRegion) &&
      hasEmployerJobContactInfo({ job, emp }),
    )
    .map(({ job, emp }) => {
      const link = presentApplyLink(
        job.applyUrl,
        job.liveness,
        job.lastVerifiedAt,
        job.livenessReason,
        "company_site",
      );
      return {
        id: job.id + EMPLOYER_JOB_ID_OFFSET,
        title: job.title,
        employer: emp.companyName,
        location: job.location,
        regulator: job.regulator,
        targetRegions: job.targetRegions ?? [],
        sponsorshipOffered: job.sponsorshipOffered,
        requiredRegistration: job.requiredRegistration,
        requiredDbsClearanceLevel: job.requiredDbsClearanceLevel,
        requiredSafeguardingLevel: job.requiredSafeguardingLevel,
        applyUrl: link.applyUrl,
        linkVerified: link.linkVerified,
        contactEmail: emp.contactEmail,
        contactPhone: emp.contactPhone,
        contactWebsite: emp.contactWebsite,
        sourceType: "company_site",
        sponsorVacancyId: null,
      };
    });

  const curatedKeys = new Set(
    [...curatedRoles, ...employerJobs].map((role) => roleDedupKey(role.employer, role.title)),
  );
  const discoveredRoles: AlertCandidateRole[] = sponsorRoles
    .filter((role) =>
      role.sourceType != null &&
      role.classifiedRelevant !== false &&
      !isManualLabourTitle(role.title) &&
      !(role.sourceType === "company_site" && isLikelyEditorialTitle(role.title)) &&
      roleMatchesPreferredRegions(role.targetRegions, profile.preferredRegion) &&
      (role.sourceType !== "company_site" || !curatedKeys.has(roleDedupKey(role.employer, role.title))),
    )
    .map((role) => ({
      id: role.id,
      title: role.title,
      employer: role.employer,
      location: role.location,
      regulator: role.regulator,
      targetRegions: role.targetRegions ?? [],
      sponsorshipOffered: role.sponsorshipOffered,
      requiredRegistration: role.requiredRegistration,
      requiredDbsClearanceLevel: role.requiredDbsClearanceLevel,
      requiredSafeguardingLevel: role.requiredSafeguardingLevel,
      applyUrl: role.applyUrl ?? null,
      linkVerified: role.linkVerified ?? false,
      contactEmail: role.contactEmail,
      contactPhone: role.contactPhone,
      contactWebsite: role.contactWebsite,
      sourceType: role.sourceType as "company_site" | "job_board",
      sponsorVacancyId: role.id - SPONSOR_VACANCY_ID_OFFSET,
    }));

  return [...curatedRoles, ...employerJobs, ...discoveredRoles];
}

function computeMatchScore(
  role: Pick<AlertCandidateRole, "sponsorshipOffered" | "requiredRegistration">,
  isEligible: boolean,
  requiresSponsorship: boolean,
): number {
  let score = isEligible ? 45 : 15;
  if (role.sponsorshipOffered && requiresSponsorship) score += 20;
  else if (!requiresSponsorship) score += 10;
  if (isEligible) {
    const requirement = role.requiredRegistration.toLowerCase();
    if (!requirement.includes("full") && !requirement.includes("senior")) score += 8;
  }
  return Math.min(score, 100);
}

function careerFocusBoost(title: string, focusArea: string | null | undefined): number {
  if (!focusArea) return 0;
  const titleLower = title.toLowerCase();
  return focusArea
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => titleLower.includes(word)).length * 8;
}

function deliveryKey(role: AlertCandidateRole): string {
  if (role.applyUrl?.trim()) return role.applyUrl.trim();
  return `vacancy:${role.sourceType}:${role.id}`;
}

async function getTopAlertRoles(
  userId: string,
  profile: typeof profilesTable.$inferSelect,
  category: OpportunityCategory,
  storedRoles: Array<typeof rolesTable.$inferSelect>,
  publishedJobs: Array<{
    job: typeof jobListingsTable.$inferSelect;
    emp: typeof employerProfilesTable.$inferSelect;
  }>,
  sponsorRoles: Awaited<ReturnType<typeof fetchSponsorVacanciesAsRoles>>,
  latestDecision: typeof decisionRecordsTable.$inferSelect | undefined,
): Promise<ScoredAlertRole[]> {
  const [cachedScores, sponsorScores, favourites, sponsorBookmarks, applications, activeCareerProfiles] =
    await Promise.all([
      db
        .select()
        .from(candidateMatchScoresTable)
        .where(and(
          eq(candidateMatchScoresTable.userId, userId),
          gte(candidateMatchScoresTable.scoredAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
        )),
      db
        .select({
          vacancyId: sponsorLicenceVacancyScoresTable.vacancyId,
          score: sponsorLicenceVacancyScoresTable.score,
        })
        .from(sponsorLicenceVacancyScoresTable)
        .where(eq(sponsorLicenceVacancyScoresTable.userId, userId)),
      db
        .select({ vacancyId: vacancyFavoritesTable.vacancyId, createdAt: vacancyFavoritesTable.createdAt })
        .from(vacancyFavoritesTable)
        .where(eq(vacancyFavoritesTable.userId, userId)),
      db
        .select({ organisationName: sponsorLicencesTable.organisationName })
        .from(sponsorLicenceBookmarksTable)
        .innerJoin(sponsorLicencesTable, eq(sponsorLicenceBookmarksTable.sponsorLicenceId, sponsorLicencesTable.id))
        .where(eq(sponsorLicenceBookmarksTable.userId, userId)),
      db.select().from(applicationsTable).where(eq(applicationsTable.userId, userId)),
      db
        .select()
        .from(careerProfilesTable)
        .where(and(eq(careerProfilesTable.userId, userId), eq(careerProfilesTable.isActive, true))),
    ]);

  const candidates = buildAlertCandidates(profile, category, storedRoles, publishedJobs, sponsorRoles);
  const roleCatalog = candidates.map((role) => ({
    id: role.id,
    title: role.title,
    employer: role.employer,
    regulator: role.regulator,
    targetRegions: role.targetRegions,
  }));
  const favouriteRoleIds = new Set(favourites.map((favourite) => favourite.vacancyId));
  const bookmarkedEmployers = new Set(
    sponsorBookmarks.map((bookmark) => normalizeBehaviouralEmployer(bookmark.organisationName)),
  );
  const behaviouralSignals = {
    favouriteRoleIds,
    bookmarkedEmployers,
    engagements: applications.map((application) => ({
      roleId: application.roleId,
      title: application.jobTitle ?? roleCatalog.find((role) => role.id === application.roleId)?.title ?? null,
      employer: application.companyName ?? roleCatalog.find((role) => role.id === application.roleId)?.employer ?? null,
      regulator: roleCatalog.find((role) => role.id === application.roleId)?.regulator ?? null,
      targetRegions: roleCatalog.find((role) => role.id === application.roleId)?.targetRegions ?? null,
      kind: application.status === "link_clicked" ? "link_clicked" as const : "applied" as const,
      occurredAt: application.appliedAt,
    })),
  };

  const cachedScoreMap = new Map(cachedScores.map((score) => [score.roleId, score.score]));
  const sponsorScoreMap = new Map(sponsorScores.map((score) => [score.vacancyId + SPONSOR_VACANCY_ID_OFFSET, score.score]));
  const activeCareerProfile = activeCareerProfiles[0];
  const specialtyWords = (profile.specialty ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const isRegistered =
    profile.registrationStatus != null &&
    REGISTERED_STATUSES.includes(profile.registrationStatus.toLowerCase());
  const isLicenceReady = profile.licenceReady === true;
  const userIsEligible = latestDecision?.outcome === "eligible";

  return candidates
    .map((role): ScoredAlertRole => {
      const requirement = role.requiredRegistration.toLowerCase();
      const roleRequiresFull = requirement.includes("full") || requirement.includes("registered");
      const meetsRegistration = roleRequiresFull ? isRegistered || isLicenceReady : true;
      const safeguarding = assessSafeguarding(profile, {
        requiredDbsClearanceLevel: role.requiredDbsClearanceLevel ?? null,
        requiredSafeguardingLevel: role.requiredSafeguardingLevel ?? null,
      });
      const isEligible = userIsEligible && meetsRegistration && !safeguardingBlocksEligibility(safeguarding);
      const behavioural = calculateBehaviouralRanking(role, behaviouralSignals);
      const matchScore = Math.min(
        100,
        computeMatchScore(role, isEligible, profile.requiresSponsorship) +
          specialtyBoost(role.title, specialtyWords) +
          behavioural.boost,
      );
      const baseAiScore =
        (role.sponsorVacancyId != null ? sponsorScoreMap.get(role.id) : cachedScoreMap.get(role.id)) ??
        PENDING_AI_SCORE;
      const aiScore = Math.min(
        100,
        baseAiScore +
          careerFocusBoost(role.title, activeCareerProfile?.focusArea) +
          behavioural.boost,
      );
      return {
        ...role,
        aiScore,
        matchScore,
        isEligible,
        deliveryKey: deliveryKey(role),
      };
    })
    .sort((a, b) => compareOpportunityRanking({
      role: { id: a.id },
      aiScore: a.aiScore,
      matchScore: a.matchScore,
      isEligible: a.isEligible,
      linkVerified: a.linkVerified,
    }, {
      role: { id: b.id },
      aiScore: b.aiScore,
      matchScore: b.matchScore,
      isEligible: b.isEligible,
      linkVerified: b.linkVerified,
    }))
    .slice(0, MAX_ALERT_ROLES);
}

export async function processUserAlert(
  userId: string,
  email: string,
  firstName: string,
  profile: typeof profilesTable.$inferSelect,
  lastAlertAt: Date | null,
): Promise<AlertProcessResult> {
  const opportunityCategory = professionCategoryFor(profile.profession);
  if (!opportunityCategory) return { sent: false, rolesIncluded: 0, reason: "no_category" };

  const claimedAt = new Date();
  const claimCondition = lastAlertAt
    ? and(eq(profilesTable.userId, userId), eq(profilesTable.lastAlertSentAt, lastAlertAt))
    : and(eq(profilesTable.userId, userId), isNull(profilesTable.lastAlertSentAt));
  const [claim] = await db
    .update(profilesTable)
    .set({ lastAlertSentAt: claimedAt })
    .where(claimCondition)
    .returning({ userId: profilesTable.userId });
  if (!claim) return { sent: false, rolesIncluded: 0, reason: "claim_lost" };

  const restoreCheckpoint = async (): Promise<void> => {
    await db
      .update(profilesTable)
      .set({ lastAlertSentAt: lastAlertAt })
      .where(and(eq(profilesTable.userId, userId), eq(profilesTable.lastAlertSentAt, claimedAt)));
  };

  const releaseClaims = async (keys: string[]): Promise<void> => {
    if (keys.length === 0) return;
    await db
      .delete(jobAlertVacancyDeliveriesTable)
      .where(and(eq(jobAlertVacancyDeliveriesTable.userId, userId), inArray(jobAlertVacancyDeliveriesTable.vacancyUrl, keys)));
  };

  let activeClaimedKeys: string[] = [];
  try {
    const [[latestDecision], storedRoles, publishedJobs, sponsorRoles] = await Promise.all([
      db
        .select()
        .from(decisionRecordsTable)
        .where(eq(decisionRecordsTable.userId, userId))
        .orderBy(desc(decisionRecordsTable.createdAt))
        .limit(1),
      db.select().from(rolesTable).where(eq(rolesTable.active, true)),
      db
        .select({ job: jobListingsTable, emp: employerProfilesTable })
        .from(jobListingsTable)
        .innerJoin(employerProfilesTable, eq(jobListingsTable.employerProfileId, employerProfilesTable.id))
        .where(eq(jobListingsTable.status, "published")),
      // This intentionally uses the same all-source, candidate-visible query as
      // the default Opportunities page. The email then takes only its first five.
      fetchSponsorVacanciesAsRoles(opportunityCategory),
    ]);

    const topRoles = await getTopAlertRoles(
      userId,
      profile,
      opportunityCategory,
      storedRoles,
      publishedJobs,
      sponsorRoles,
      latestDecision,
    );
    if (topRoles.length === 0) {
      await restoreCheckpoint();
      return { sent: false, rolesIncluded: 0, reason: "no_top_matches" };
    }

    const deliveredRows = await db
      .select({ vacancyUrl: jobAlertVacancyDeliveriesTable.vacancyUrl })
      .from(jobAlertVacancyDeliveriesTable)
      .where(
        and(
          eq(jobAlertVacancyDeliveriesTable.userId, userId),
          inArray(jobAlertVacancyDeliveriesTable.vacancyUrl, topRoles.map((role) => role.deliveryKey)),
        ),
      );
    const delivered = new Set(deliveredRows.map((row) => row.vacancyUrl));
    const newTopRoles = topRoles.filter((role) => !delivered.has(role.deliveryKey));
    if (newTopRoles.length === 0) {
      await restoreCheckpoint();
      return { sent: false, rolesIncluded: 0, reason: "no_top_matches" };
    }

    const claimed = await db
      .insert(jobAlertVacancyDeliveriesTable)
      .values(
        newTopRoles.map((role) => ({
          userId,
          vacancyId: role.sponsorVacancyId,
          vacancyUrl: role.deliveryKey,
        })),
      )
      .onConflictDoNothing()
      .returning({ vacancyUrl: jobAlertVacancyDeliveriesTable.vacancyUrl });
    const claimedKeys = new Set(claimed.map((row) => row.vacancyUrl));
    activeClaimedKeys = [...claimedKeys];
    const rolesToSend = newTopRoles.filter((role) => claimedKeys.has(role.deliveryKey));
    if (rolesToSend.length === 0) {
      await restoreCheckpoint();
      return { sent: false, rolesIncluded: 0, reason: "claim_lost" };
    }

    const alertRoles: AlertRole[] = rolesToSend.map((role) => ({
      title: role.title,
      employer: role.employer,
      location: role.location,
      sponsorshipOffered: role.sponsorshipOffered,
      isEligible: role.isEligible,
      applyUrl: role.applyUrl,
      aiScore: role.aiScore,
      matchScore: role.matchScore,
    }));
    const result = await sendJobAlertEmail(email, firstName || "Candidate", alertRoles, "weekly");
    if (!result.success) {
      await releaseClaims([...claimedKeys]);
      await restoreCheckpoint();
      console.warn(`[alert-scheduler] Job alert provider rejected a ${rolesToSend.length}-role send.`);
      return { sent: false, rolesIncluded: 0, reason: "provider_rejected" };
    }

    return { sent: true, rolesIncluded: rolesToSend.length };
  } catch (error) {
    await releaseClaims(activeClaimedKeys);
    await restoreCheckpoint();
    throw error;
  }
}

export async function runAlerts(): Promise<void> {
  console.log("[alert-scheduler] Running weekly job alert sweep...");
  const profiles = await db.select().from(profilesTable);
  let candidatesConsidered = 0;
  let skippedPreference = 0;
  let skippedInterval = 0;
  let emailed = 0;
  let rolesIncluded = 0;

  for (const profile of profiles) {
    if (profile.alertFrequency === "off") {
      skippedPreference += 1;
      continue;
    }
    candidatesConsidered += 1;

    const lastSent = profile.lastAlertSentAt;
    if (lastSent && Date.now() - lastSent.getTime() < WEEK_MS) {
      skippedInterval += 1;
      continue;
    }

    const [userRow] = await db
      .select({ email: usersTable.email, firstName: usersTable.firstName })
      .from(usersTable)
      .where(eq(usersTable.id, profile.userId));
    if (!userRow?.email) continue;

    try {
      const result = await processUserAlert(
        profile.userId,
        userRow.email,
        userRow.firstName ?? "Candidate",
        profile,
        lastSent ?? null,
      );
      if (result.sent) {
        emailed += 1;
        rolesIncluded += result.rolesIncluded;
      }
    } catch (error) {
      console.error("[alert-scheduler] Weekly job alert failed:", error instanceof Error ? error.message : error);
    }
  }

  console.log(
    `[alert-scheduler] Sweep complete: candidates=${candidatesConsidered}, skipped_pref_off=${skippedPreference}, ` +
      `skipped_interval=${skippedInterval}, emailed=${emailed}, roles_included=${rolesIncluded}.`,
  );
}

export function startAlertScheduler(): void {
  cron.schedule("0 7 * * *", () => {
    runAlerts().catch((err) => {
      console.error("[alert-scheduler] Unhandled error in weekly runAlerts:", err);
    });
  }, {
    timezone: "Europe/London",
  });

  console.log("[alert-scheduler] Scheduler registered: daily sweep, weekly candidate interval, 07:00 Europe/London");
}