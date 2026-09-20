import {
  db,
  sponsorLicenceVacanciesTable,
  sponsorLicencesTable,
  vacancySyncLogTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { candidateEmployerMatchesSponsor } from "./nhsJobsClient";
import { searchJobsAcUk, type JobsAcUkSearchResult } from "./jobsAcUkClient";
import {
  searchTeachingVacancies,
  type TeachingVacanciesSearchResult,
} from "./teachingVacanciesClient";
import {
  normaliseAndDedupeBoardAdverts,
  upsertSharedBoardVacancies,
  type BoardAdvert,
} from "./boardVacancyPipeline";
import {
  REED_PROFESSION_BACKFILL_TARGETS,
  type ReedProfessionBackfillTarget,
} from "./reedProfessionBackfill";
import { opportunityCategoriesMatch, type OpportunityCategory } from "./professionCategory";
import { classifyVacancyCategory } from "./sponsorVacancyRoles";
import { canonicalVacancyUrl, classifyVacancySource } from "./vacancySource";
import { isValidJobBoardVacancyDeepLink } from "./vacancyUrlPolicy";
import { getCandidateVacancyStatus } from "./vacancyLiveness";

export const ADDITIONAL_BOARD_PER_PROFESSION_LIMIT = 40;
export const ADDITIONAL_BOARD_FAILURE_COOLDOWN_MS = 20 * 60 * 1000;

type SearchVacancy = {
  title: string;
  employer: string;
  location: string | null;
  salary: string | null;
  url: string;
  description: string | null;
  postedDate: string | null;
  targetRegions: string[] | null;
  externalListingId: string;
  contactEmail: string | null;
  contactEvidenceUrl: string | null;
  closesAt?: Date | null;
};

type SearchResult = {
  vacancies: SearchVacancy[];
  requestSucceeded: boolean;
  transientFailure: boolean;
  status: number | null;
};

export type AdditionalBoardSourceId = "jobs_ac_uk" | "teaching_vacancies";

type SourceDefinition = {
  id: AdditionalBoardSourceId;
  boardName: "jobs.ac.uk" | "Teaching Vacancies";
  totalLimit: number;
  targets: readonly ReedProfessionBackfillTarget[];
  search: (keywords: string, limit: number) => Promise<SearchResult>;
};

const educationTarget = REED_PROFESSION_BACKFILL_TARGETS.filter(
  (target) => target.category === "EDUCATION",
);

const SOURCES: readonly SourceDefinition[] = [
  {
    id: "jobs_ac_uk",
    boardName: "jobs.ac.uk",
    totalLimit: 300,
    targets: REED_PROFESSION_BACKFILL_TARGETS,
    search: (keywords, limit) => searchJobsAcUk(keywords, limit) as Promise<JobsAcUkSearchResult>,
  },
  {
    id: "teaching_vacancies",
    boardName: "Teaching Vacancies",
    totalLimit: 40,
    targets: educationTarget,
    search: (keywords, limit) =>
      searchTeachingVacancies(keywords.replace(/\s+OR\s+/gi, " "), limit) as Promise<TeachingVacanciesSearchResult>,
  },
];

export type AdditionalBoardCategoryMetrics = {
  source: AdditionalBoardSourceId;
  profession: string;
  category: OpportunityCategory;
  discovered: number;
  sponsorMatched: number;
  classified: number;
  live: number;
  candidateVisible: number;
  inserted: number;
  updated: number;
  revived: number;
  skippedBySourceCap: number;
  skippedByCooldown: boolean;
  failed: boolean;
  status: number | null;
  error: string | null;
};

export type AdditionalBoardSourceMetrics = {
  source: AdditionalBoardSourceId;
  boardName: string;
  failed: boolean;
  categories: AdditionalBoardCategoryMetrics[];
};

export type AdditionalBoardProfessionBackfillResult = {
  started: boolean;
  failed: boolean;
  discovered: number;
  sponsorMatched: number;
  classified: number;
  live: number;
  candidateVisible: number;
  inserted: number;
  updated: number;
  revived: number;
  sources: AdditionalBoardSourceMetrics[];
};

type Dependencies = {
  sources?: readonly SourceDefinition[];
  loadSponsors?: () => Promise<string[]>;
  persist?: (adverts: readonly BoardAdvert[]) => Promise<{
    inserted: number;
    updated: number;
    revived: number;
  }>;
  readVisibility?: (
    urls: readonly string[],
    category: OpportunityCategory,
    boardName: string,
  ) => Promise<{ live: number; candidateVisible: number }>;
  recordSourceMetrics?: (
    source: AdditionalBoardSourceMetrics,
    durationMs: number,
  ) => Promise<void>;
  now?: () => number;
};

const cooldownUntil = new Map<AdditionalBoardSourceId, number>();
let inFlight: Promise<AdditionalBoardProfessionBackfillResult> | null = null;

function uniqueSponsorNames(names: readonly string[]): string[] {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

async function loadSponsors(): Promise<string[]> {
  const rows = await db
    .select({ organisationName: sponsorLicencesTable.organisationName })
    .from(sponsorLicencesTable);
  return uniqueSponsorNames(rows.map((row) => row.organisationName));
}

export function matchAdditionalBoardAdverts(
  vacancies: readonly SearchVacancy[],
  sponsors: readonly string[],
  category: OpportunityCategory,
  boardName: string,
): { adverts: BoardAdvert[]; sponsorMatched: number } {
  const sponsorNames = uniqueSponsorNames(sponsors);
  const matched: BoardAdvert[] = [];
  let sponsorMatched = 0;

  for (const vacancy of vacancies) {
    const organisationName = sponsorNames.find((name) =>
      candidateEmployerMatchesSponsor(name, vacancy.employer),
    );
    if (!organisationName) continue;
    sponsorMatched++;
    const url = canonicalVacancyUrl(vacancy.url);
    if (!url || !isValidJobBoardVacancyDeepLink(url)) continue;
    const source = classifyVacancySource(url);
    if (source.sourceType !== "job_board" || source.boardName !== boardName) continue;
    const classified = classifyVacancyCategory(vacancy.title, vacancy.description);
    if (!classified || !opportunityCategoriesMatch(category, classified)) continue;
    matched.push({
      organisationName,
      employer: vacancy.employer,
      title: vacancy.title,
      location: vacancy.location,
      salary: vacancy.salary,
      url,
      description: vacancy.description,
      postedDate: vacancy.postedDate,
      targetRegions: vacancy.targetRegions,
      boardName,
      externalId: source.externalListingId ?? vacancy.externalListingId,
      sourceType: "job_board",
      contactEmail: vacancy.contactEmail,
      contactEvidenceUrl: vacancy.contactEvidenceUrl,
      closesAt: vacancy.closesAt ?? null,
    });
  }
  return {
    adverts: normaliseAndDedupeBoardAdverts(matched),
    sponsorMatched,
  };
}

async function readVisibility(
  urls: readonly string[],
  category: OpportunityCategory,
  boardName: string,
): Promise<{ live: number; candidateVisible: number }> {
  if (urls.length === 0) return { live: 0, candidateVisible: 0 };
  const rows = await db
    .select({ vacancy: sponsorLicenceVacanciesTable })
    .from(sponsorLicenceVacanciesTable)
    .where(and(
      eq(sponsorLicenceVacanciesTable.sourceType, "job_board"),
      eq(sponsorLicenceVacanciesTable.boardName, boardName),
      inArray(sponsorLicenceVacanciesTable.url, [...urls]),
    ));
  let live = 0;
  let candidateVisible = 0;
  for (const { vacancy } of rows) {
    const classified = classifyVacancyCategory(vacancy.title, vacancy.description);
    if (!classified || !opportunityCategoriesMatch(category, classified)) continue;
    if (vacancy.liveness === "live") live++;
    if (
      getCandidateVacancyStatus({
        sourceType: vacancy.sourceType,
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
      }) === "visible"
    ) candidateVisible++;
  }
  return { live, candidateVisible };
}

async function recordSourceMetrics(
  source: AdditionalBoardSourceMetrics,
  durationMs: number,
): Promise<void> {
  const discovered = source.categories.reduce((sum, row) => sum + row.discovered, 0);
  const errors = source.categories.filter((row) => row.failed);
  await db.insert(vacancySyncLogTable).values({
    status: source.failed ? "error" : "success",
    batchSize: source.categories.length,
    checkedCount: discovered,
    cacheHitCount: 0,
    errorCount: errors.length,
    errorMessage: errors.map((row) => `${row.category}: ${row.error}`).join("; ").slice(0, 2000) || null,
    triggeredBy: "manual",
    durationMs,
    jobKind: `profession_board_backfill:${source.source}`,
    metrics: source,
  });
}

function emptyCategory(
  source: SourceDefinition,
  target: ReedProfessionBackfillTarget,
): AdditionalBoardCategoryMetrics {
  return {
    source: source.id,
    profession: target.profession,
    category: target.category,
    discovered: 0,
    sponsorMatched: 0,
    classified: 0,
    live: 0,
    candidateVisible: 0,
    inserted: 0,
    updated: 0,
    revived: 0,
    skippedBySourceCap: 0,
    skippedByCooldown: false,
    failed: false,
    status: null,
    error: null,
  };
}

async function execute(options: Dependencies): Promise<AdditionalBoardProfessionBackfillResult> {
  const now = options.now ?? Date.now;
  const sponsors = await (options.loadSponsors ?? loadSponsors)();
  const persist = options.persist ?? ((adverts: readonly BoardAdvert[]) =>
    upsertSharedBoardVacancies(adverts, { verifiedLive: true }));
  const visibilityReader = options.readVisibility ?? readVisibility;
  const metricsWriter = options.recordSourceMetrics ?? recordSourceMetrics;
  const sourceResults: AdditionalBoardSourceMetrics[] = [];

  for (const source of options.sources ?? SOURCES) {
    const sourceStartedAt = now();
    const categories: AdditionalBoardCategoryMetrics[] = [];
    let remaining = source.totalLimit;
    for (const target of source.targets) {
      const metrics = emptyCategory(source, target);
      if ((cooldownUntil.get(source.id) ?? 0) > now()) {
        metrics.skippedByCooldown = true;
        categories.push(metrics);
        continue;
      }
      try {
        const result = await source.search(
          target.keywords,
          Math.min(ADDITIONAL_BOARD_PER_PROFESSION_LIMIT, remaining),
        );
        metrics.discovered = result.vacancies.length;
        metrics.status = result.status;
        if (!result.requestSucceeded) {
          metrics.failed = true;
          metrics.error = `request failed${result.status ? ` (${result.status})` : ""}`;
          if (result.transientFailure) {
            cooldownUntil.set(source.id, now() + ADDITIONAL_BOARD_FAILURE_COOLDOWN_MS);
          }
          categories.push(metrics);
          continue;
        }
        const matched = matchAdditionalBoardAdverts(
          result.vacancies,
          sponsors,
          target.category,
          source.boardName,
        );
        metrics.sponsorMatched = matched.sponsorMatched;
        metrics.classified = matched.adverts.length;
        const adverts = matched.adverts.slice(0, remaining);
        metrics.skippedBySourceCap = matched.adverts.length - adverts.length;
        if (adverts.length > 0) {
          const persisted = await persist(adverts);
          metrics.inserted = persisted.inserted;
          metrics.updated = persisted.updated;
          metrics.revived = persisted.revived;
          remaining -= adverts.length;
          const visibility = await visibilityReader(
            adverts.map((advert) => advert.url),
            target.category,
            source.boardName,
          );
          metrics.live = visibility.live;
          metrics.candidateVisible = visibility.candidateVisible;
        }
      } catch (error) {
        metrics.failed = true;
        metrics.error = error instanceof Error ? error.message : String(error);
      }
      categories.push(metrics);
    }
    const sourceResult: AdditionalBoardSourceMetrics = {
      source: source.id,
      boardName: source.boardName,
      failed: categories.some((row) => row.failed),
      categories,
    };
    sourceResults.push(sourceResult);
    await metricsWriter(sourceResult, now() - sourceStartedAt);
  }

  const categories = sourceResults.flatMap((source) => source.categories);
  return {
    started: true,
    failed: sourceResults.some((source) => source.failed),
    discovered: categories.reduce((sum, row) => sum + row.discovered, 0),
    sponsorMatched: categories.reduce((sum, row) => sum + row.sponsorMatched, 0),
    classified: categories.reduce((sum, row) => sum + row.classified, 0),
    live: categories.reduce((sum, row) => sum + row.live, 0),
    candidateVisible: categories.reduce((sum, row) => sum + row.candidateVisible, 0),
    inserted: categories.reduce((sum, row) => sum + row.inserted, 0),
    updated: categories.reduce((sum, row) => sum + row.updated, 0),
    revived: categories.reduce((sum, row) => sum + row.revived, 0),
    sources: sourceResults,
  };
}

export async function runAdditionalBoardProfessionBackfill(
  options: Dependencies = {},
): Promise<AdditionalBoardProfessionBackfillResult> {
  if (inFlight) return inFlight;
  inFlight = execute(options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function clearAdditionalBoardBackfillState(): void {
  cooldownUntil.clear();
  inFlight = null;
}