import {
  db,
  sponsorLicenceVacanciesTable,
  sponsorLicencesTable,
  vacancySyncLogTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  createCandidateSponsorMatcher,
} from "./nhsJobsClient";
import {
  searchReedJobsForCandidate,
  type ReedCandidateSearchResult,
  type ReedVacancy,
} from "./reedJobsClient";
import {
  boardVacancyFingerprint,
  normaliseAndDedupeBoardAdverts,
  upsertSharedBoardVacancies,
  type BoardAdvert,
} from "./boardVacancyPipeline";
import {
  opportunityCategoriesMatch,
  type OpportunityCategory,
} from "./professionCategory";
import { classifyVacancyCategory } from "./sponsorVacancyRoles";
import { canonicalVacancyUrl, classifyVacancySource } from "./vacancySource";
import { isValidJobBoardVacancyDeepLink } from "./vacancyUrlPolicy";
import { getCandidateVacancyStatus } from "./vacancyLiveness";

export const REED_PROFESSION_BACKFILL_PER_CATEGORY_LIMIT = 40;
export const REED_PROFESSION_BACKFILL_TOTAL_PERSIST_LIMIT = 2_000;
export const REED_PROFESSION_BACKFILL_FAILURE_COOLDOWN_MS = 20 * 60 * 1000;

export type ReedProfessionBackfillTarget = {
  profession: string;
  category: OpportunityCategory;
  keywords: string;
};

export const REED_PROFESSION_BACKFILL_TARGETS: readonly ReedProfessionBackfillTarget[] = [
  { profession: "Teacher / Lecturer", category: "EDUCATION", keywords: "teacher OR lecturer" },
  { profession: "Engineer", category: "ENGINEERING", keywords: "engineer" },
  { profession: "IT Professional", category: "IT", keywords: "software OR IT" },
  { profession: "Software Engineering", category: "IT", keywords: "software engineer OR software developer" },
  { profession: "Accountant", category: "ACCOUNTING", keywords: "accountant" },
  { profession: "Lawyer / Solicitor", category: "LEGAL", keywords: "lawyer OR solicitor" },
  { profession: "Architect", category: "ARCHITECTURE", keywords: "architect" },
  { profession: "Social Worker", category: "SOCIAL_WORK", keywords: "social worker" },
  { profession: "Dentist", category: "DENTAL", keywords: "dentist" },
  { profession: "Pharmacist", category: "PHARMACY", keywords: "pharmacist" },
  { profession: "Business Development Manager", category: "BUSINESS_DEVELOPMENT", keywords: "business development manager OR business development" },
  { profession: "Nurse", category: "NMC", keywords: "nurse OR midwife" },
  { profession: "Doctor", category: "GMC", keywords: "doctor OR physician" },
  { profession: "Physiotherapist", category: "HCPC", keywords: "physiotherapist OR paramedic OR radiographer" },
  { profession: "Primary Teacher", category: "EDUCATION", keywords: "primary teacher" },
  { profession: "Secondary Teacher", category: "EDUCATION", keywords: "secondary teacher" },
  { profession: "SEN Teacher", category: "EDUCATION", keywords: "SEN teacher OR special educational needs teacher" },
  { profession: "University Lecturer", category: "EDUCATION", keywords: "university lecturer OR academic lecturer" },
  { profession: "Civil Engineer", category: "ENGINEERING", keywords: "civil engineer" },
  { profession: "Mechanical Engineer", category: "ENGINEERING", keywords: "mechanical engineer" },
  { profession: "Electrical Engineer", category: "ENGINEERING", keywords: "electrical engineer" },
  { profession: "Structural Engineer", category: "ENGINEERING", keywords: "structural engineer" },
  { profession: "Maintenance Engineer", category: "ENGINEERING", keywords: "maintenance engineer" },
  { profession: "Software Developer", category: "IT", keywords: "software developer" },
  { profession: "Data Professional", category: "IT", keywords: "data analyst OR data engineer OR data scientist" },
  { profession: "Cyber Security", category: "IT", keywords: "cyber security OR cybersecurity" },
  { profession: "Cloud / DevOps", category: "IT", keywords: "cloud engineer OR devops engineer" },
  { profession: "IT Support", category: "IT", keywords: "IT support OR service desk" },
  { profession: "Finance Analyst", category: "ACCOUNTING", keywords: "finance analyst OR financial analyst" },
  { profession: "Auditor", category: "ACCOUNTING", keywords: "auditor OR audit manager" },
  { profession: "Payroll", category: "ACCOUNTING", keywords: "payroll manager OR payroll officer" },
  { profession: "Risk Professional", category: "FINANCE", keywords: "risk analyst OR risk manager" },
  { profession: "Compliance Professional", category: "FINANCE", keywords: "compliance analyst OR compliance manager" },
  { profession: "Investment Professional", category: "FINANCE", keywords: "investment analyst OR investment manager" },
  { profession: "Actuary", category: "FINANCE", keywords: "actuary OR actuarial" },
  { profession: "Paralegal", category: "LEGAL", keywords: "paralegal" },
  { profession: "Legal Counsel", category: "LEGAL", keywords: "legal counsel" },
  { profession: "Architectural Technologist", category: "ARCHITECTURE", keywords: "architectural technologist" },
  { profession: "Care Manager", category: "SOCIAL_WORK", keywords: "social care manager OR care manager" },
  { profession: "Registered Nurse", category: "NMC", keywords: "registered nurse" },
  { profession: "Medical Practitioner", category: "GMC", keywords: "medical practitioner OR specialty doctor" },
  { profession: "Occupational Therapist", category: "HCPC", keywords: "occupational therapist" },
  { profession: "Radiographer", category: "HCPC", keywords: "radiographer OR sonographer" },
  { profession: "Business Development Executive", category: "BUSINESS_DEVELOPMENT", keywords: "business development executive" },
  { profession: "Chef", category: "HOSPITALITY", keywords: "chef" },
  { profession: "Hotel Manager", category: "HOSPITALITY", keywords: "hotel manager" },
  { profession: "Restaurant Manager", category: "HOSPITALITY", keywords: "restaurant manager" },
  { profession: "Quantity Surveyor", category: "CONSTRUCTION", keywords: "quantity surveyor" },
  { profession: "Construction Site Manager", category: "CONSTRUCTION", keywords: "construction site manager OR site manager" },
  { profession: "Construction Project Manager", category: "CONSTRUCTION", keywords: "construction project manager" },
  { profession: "Production Manager", category: "MANUFACTURING", keywords: "manufacturing production manager" },
  { profession: "Manufacturing Engineer", category: "MANUFACTURING", keywords: "manufacturing engineer" },
  { profession: "Quality Engineer", category: "MANUFACTURING", keywords: "manufacturing quality engineer" },
  { profession: "Retail Store Manager", category: "RETAIL", keywords: "retail store manager" },
  { profession: "Retail Buyer", category: "RETAIL", keywords: "retail buyer" },
  { profession: "Merchandiser", category: "RETAIL", keywords: "retail merchandiser" },
];

export type ReedProfessionBackfillCategoryMetrics = {
  profession: string;
  category: OpportunityCategory;
  keywords: string;
  attempted: boolean;
  discovered: number;
  sponsorMatched: number;
  classified: number;
  live: number;
  candidateVisible: number;
  inserted: number;
  revived: number;
  updated: number;
  upserted: number;
  skippedByTotalCap: number;
  emptySuccess: boolean;
  failed: boolean;
  error: string | null;
};

export type ReedProfessionBackfillResult = {
  started: boolean;
  skipped: boolean;
  skipReason: "failure_cooldown" | null;
  failed: boolean;
  discovered: number;
  sponsorMatched: number;
  classified: number;
  live: number;
  candidateVisible: number;
  inserted: number;
  revived: number;
  categories: ReedProfessionBackfillCategoryMetrics[];
};

type PersistResult = {
  inserted: number;
  updated: number;
  revived: number;
};

type PersistedVisibility = {
  live: number;
  candidateVisible: number;
};

type ReedProfessionBackfillDependencies = {
  perCategoryLimit?: number;
  totalPersistLimit?: number;
  targets?: readonly ReedProfessionBackfillTarget[];
  loadSponsors?: () => Promise<string[]>;
  search?: (
    keywords: string,
    region: string | null,
    limit: number,
    deadlineMs?: number,
  ) => Promise<ReedCandidateSearchResult>;
  persist?: (adverts: readonly BoardAdvert[]) => Promise<PersistResult>;
  readVisibility?: (
    urls: readonly string[],
    category: OpportunityCategory,
  ) => Promise<PersistedVisibility>;
  recordMetrics?: (result: ReedProfessionBackfillResult, durationMs: number) => Promise<void>;
  now?: () => number;
  deadlineMs?: number;
};

let inFlight: Promise<ReedProfessionBackfillResult> | null = null;
let failureCooldownUntil = 0;

function emptyResult(
  skipReason: ReedProfessionBackfillResult["skipReason"] = null,
): ReedProfessionBackfillResult {
  return {
    started: false,
    skipped: skipReason != null,
    skipReason,
    failed: false,
    discovered: 0,
    sponsorMatched: 0,
    classified: 0,
    live: 0,
    candidateVisible: 0,
    inserted: 0,
    revived: 0,
    categories: [],
  };
}

function uniqueSponsorNames(names: readonly string[]): string[] {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

/**
 * Applies the same sponsor identity, direct Reed-link, and source checks as
 * candidate board discovery. Category classification is intentionally applied
 * before persistence so this development backfill cannot broaden a profession
 * feed with unrelated Reed search results.
 */
export function matchReedProfessionAdverts(
  vacancies: readonly ReedVacancy[],
  sponsors: readonly string[],
  category: OpportunityCategory,
): { adverts: BoardAdvert[]; sponsorMatched: number } {
  const sponsorNames = uniqueSponsorNames(sponsors);
  const resolveSponsor = createCandidateSponsorMatcher(sponsorNames);
  const sponsorMatched: BoardAdvert[] = [];

  for (const vacancy of vacancies) {
    const organisationName = resolveSponsor(vacancy.employer);
    if (!organisationName) continue;

    const url = canonicalVacancyUrl(vacancy.url);
    if (!url || !isValidJobBoardVacancyDeepLink(url)) continue;
    const source = classifyVacancySource(url);
    if (source.sourceType !== "job_board" || source.boardName !== "Reed") continue;

    const classified = classifyVacancyCategory(vacancy.title, vacancy.description);
    if (!classified || !opportunityCategoriesMatch(category, classified)) continue;

    sponsorMatched.push({
      organisationName,
      employer: vacancy.employer,
      title: vacancy.title,
      location: vacancy.location,
      salary: vacancy.salary,
      url,
      description: vacancy.description,
      postedDate: vacancy.postedDate,
      targetRegions: vacancy.targetRegions,
      boardName: "Reed",
      externalId: source.externalListingId ?? vacancy.externalListingId,
      sourceType: "job_board",
      contactEmail: vacancy.contactEmail,
      contactEvidenceUrl: vacancy.contactEvidenceUrl,
      closesAt: vacancy.closesAt ?? null,
    });
  }

  const deduped = normaliseAndDedupeBoardAdverts(sponsorMatched);
  return {
    adverts: deduped,
    sponsorMatched: sponsorMatched.length,
  };
}

async function loadSponsors(): Promise<string[]> {
  const rows = await db
    .select({ organisationName: sponsorLicencesTable.organisationName })
    .from(sponsorLicencesTable);
  return uniqueSponsorNames(rows.map((row) => row.organisationName));
}

async function readPersistedVisibility(
  urls: readonly string[],
  category: OpportunityCategory,
): Promise<PersistedVisibility> {
  if (urls.length === 0) return { live: 0, candidateVisible: 0 };

  const rows = await db
    .select({ vacancy: sponsorLicenceVacanciesTable })
    .from(sponsorLicenceVacanciesTable)
    .where(
      and(
        eq(sponsorLicenceVacanciesTable.sourceType, "job_board"),
        eq(sponsorLicenceVacanciesTable.boardName, "Reed"),
        inArray(sponsorLicenceVacanciesTable.url, [...urls]),
      ),
    );

  let live = 0;
  let candidateVisible = 0;
  for (const { vacancy } of rows) {
    const classified = classifyVacancyCategory(vacancy.title, vacancy.description);
    if (!classified || !opportunityCategoriesMatch(category, classified)) continue;
    if (vacancy.liveness === "live") live += 1;

    const status = getCandidateVacancyStatus({
      sourceType: vacancy.sourceType,
      title: vacancy.title,
      liveness: vacancy.liveness,
      lastVerifiedAt: vacancy.lastVerifiedAt,
      lastDiscoveredAt: vacancy.lastDiscoveredAt,
      sourceMissingSince: vacancy.sourceMissingSince,
      sourceMissingObservations: vacancy.sourceMissingObservations,
      closesAt: vacancy.closesAt,
      expiresAt: vacancy.expiresAt,
      closedReason: vacancy.closedReason,
      companyVacancyEvidence: vacancy.companyVacancyEvidence,
      companyEvidenceLegacyUntil: vacancy.companyEvidenceLegacyUntil,
    });
    if (status === "visible" && vacancy.url && isValidJobBoardVacancyDeepLink(vacancy.url)) {
      candidateVisible += 1;
    }
  }

  return { live, candidateVisible };
}

async function recordMetrics(
  result: ReedProfessionBackfillResult,
  durationMs: number,
): Promise<void> {
  await db.insert(vacancySyncLogTable).values({
    status: result.failed ? "error" : "success",
    batchSize: result.categories.length,
    checkedCount: result.discovered,
    cacheHitCount: 0,
    errorCount: result.categories.filter((category) => category.failed).length,
    errorMessage: result.categories
      .filter((category) => category.error)
      .map((category) => `${category.category}: ${category.error}`)
      .join("; ")
      .slice(0, 2000) || null,
    triggeredBy: "manual",
    durationMs,
    jobKind: "reed_profession_backfill",
    metrics: result,
  });
}

async function executeBackfill(
  options: ReedProfessionBackfillDependencies,
): Promise<ReedProfessionBackfillResult> {
  const startedAt = options.now?.() ?? Date.now();
  const perCategoryLimit = Math.max(
    1,
    Math.min(
      REED_PROFESSION_BACKFILL_PER_CATEGORY_LIMIT,
      Math.floor(options.perCategoryLimit ?? REED_PROFESSION_BACKFILL_PER_CATEGORY_LIMIT),
    ),
  );
  const totalPersistLimit = Math.max(
    1,
    Math.min(
      REED_PROFESSION_BACKFILL_TOTAL_PERSIST_LIMIT,
      Math.floor(options.totalPersistLimit ?? REED_PROFESSION_BACKFILL_TOTAL_PERSIST_LIMIT),
    ),
  );
  const search = options.search ?? searchReedJobsForCandidate;
  const persist = options.persist ?? ((adverts: readonly BoardAdvert[]) =>
    upsertSharedBoardVacancies(adverts, { verifiedLive: true }));
  const visibilityReader = options.readVisibility ?? readPersistedVisibility;
  const metricsRecorder = options.recordMetrics ?? recordMetrics;
  const sponsors = await (options.loadSponsors ?? loadSponsors)();
  const categories: ReedProfessionBackfillCategoryMetrics[] = [];
  let remainingPersistBudget = totalPersistLimit;

  for (const target of options.targets ?? REED_PROFESSION_BACKFILL_TARGETS) {
    if (options.deadlineMs != null && Date.now() >= options.deadlineMs) break;
    const categoryMetrics: ReedProfessionBackfillCategoryMetrics = {
      profession: target.profession,
      category: target.category,
      keywords: target.keywords,
      attempted: true,
      discovered: 0,
      sponsorMatched: 0,
      classified: 0,
      live: 0,
      candidateVisible: 0,
      inserted: 0,
      revived: 0,
      updated: 0,
      upserted: 0,
      skippedByTotalCap: 0,
      emptySuccess: false,
      failed: false,
      error: null,
    };

    try {
      const searchResult = await search(
        target.keywords,
        null,
        perCategoryLimit,
        options.deadlineMs,
      );
      categoryMetrics.discovered = searchResult.vacancies.length;
      if (!searchResult.requestSucceeded) {
        categoryMetrics.failed = true;
        categoryMetrics.error = searchResult.transientFailure
          ? "transient Reed request failure"
          : "Reed request failed";
        categories.push(categoryMetrics);
        continue;
      }

      const matched = matchReedProfessionAdverts(
        searchResult.vacancies,
        sponsors,
        target.category,
      );
      categoryMetrics.sponsorMatched = matched.sponsorMatched;
      categoryMetrics.classified = matched.adverts.length;
      categoryMetrics.emptySuccess = matched.adverts.length === 0;

      const adverts = matched.adverts.slice(0, remainingPersistBudget);
      categoryMetrics.skippedByTotalCap = matched.adverts.length - adverts.length;
      if (adverts.length > 0) {
        const persisted = await persist(adverts);
        categoryMetrics.inserted = persisted.inserted;
        categoryMetrics.revived = persisted.revived;
        categoryMetrics.updated = persisted.updated;
        categoryMetrics.upserted = persisted.inserted + persisted.updated + persisted.revived;
        remainingPersistBudget -= adverts.length;

        const visibility = await visibilityReader(
          adverts.map((advert) => advert.url),
          target.category,
        );
        categoryMetrics.live = visibility.live;
        categoryMetrics.candidateVisible = visibility.candidateVisible;
      }
    } catch (error) {
      categoryMetrics.failed = true;
      categoryMetrics.error = error instanceof Error ? error.message : String(error);
    }

    categories.push(categoryMetrics);
  }

  const result: ReedProfessionBackfillResult = {
    started: true,
    skipped: false,
    skipReason: null,
    failed: categories.some((category) => category.failed),
    discovered: categories.reduce((sum, category) => sum + category.discovered, 0),
    sponsorMatched: categories.reduce((sum, category) => sum + category.sponsorMatched, 0),
    classified: categories.reduce((sum, category) => sum + category.classified, 0),
    live: categories.reduce((sum, category) => sum + category.live, 0),
    candidateVisible: categories.reduce((sum, category) => sum + category.candidateVisible, 0),
    inserted: categories.reduce((sum, category) => sum + category.inserted, 0),
    revived: categories.reduce((sum, category) => sum + category.revived, 0),
    categories,
  };

  await metricsRecorder(result, (options.now?.() ?? Date.now()) - startedAt);
  return result;
}

export async function runReedProfessionBackfill(
  options: ReedProfessionBackfillDependencies = {},
): Promise<ReedProfessionBackfillResult> {
  const now = options.now?.() ?? Date.now();
  if (failureCooldownUntil > now) return emptyResult("failure_cooldown");
  if (inFlight) return inFlight;

  const run = executeBackfill(options)
    .then((result) => {
      if (result.failed) {
        failureCooldownUntil = (options.now?.() ?? Date.now()) + REED_PROFESSION_BACKFILL_FAILURE_COOLDOWN_MS;
      }
      return result;
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = run;
  return run;
}

export function clearReedProfessionBackfillCooldown(): void {
  failureCooldownUntil = 0;
  inFlight = null;
}

export function reedProfessionBackfillFingerprint(advert: BoardAdvert): string {
  return boardVacancyFingerprint(advert);
}
