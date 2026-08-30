import { db, sponsorLicencesTable } from "@workspace/db";
import { candidateEmployerMatchesSponsor, searchNhsJobsForCandidate } from "./nhsJobsClient";
import { searchReedJobsForCandidate } from "./reedJobsClient";
import { regionsFromLocationText, regionsOverlap } from "./regionMatching";
import { canonicalVacancyUrl, classifyVacancySource } from "./vacancySource";
import { upsertSharedBoardVacancies } from "./boardVacancyPipeline";
import {
  normalizeProfession,
  professionCategoryFor,
  statutoryRegulatorForCategory,
} from "./professionCategory";

export const CANDIDATE_BOARD_CACHE_TTL_MS = 20 * 60 * 1000;
export const CANDIDATE_BOARD_FAILURE_CACHE_TTL_MS = 20 * 60 * 1000;
export const MAX_CANDIDATE_BOARD_RESULTS = 300;
export const MIN_FRESH_CANDIDATE_BOARD_ROWS = 30;
export const CANDIDATE_BOARD_SNAPSHOT_FRESH_MS = 6 * 60 * 60 * 1000;
const CANDIDATE_BOARD_SOURCE = "job_board";
export type CandidateBoardSource = "nhs" | "reed";

const NHS_BOARD_NAMES = new Set(["NHS Jobs", "Trac", "HealthJobsUK"]);
const REED_BOARD_NAMES = new Set(["Reed"]);

type CandidateBoardProfile = {
  profession: string;
  specialty?: string | null;
  preferredRegion?: string[] | string | null;
};

export type CandidateBoardRefreshResult = {
  searched: boolean;
  failed: boolean;
  discovered: number;
  sponsorMatched: number;
  inserted: number;
  revived: number;
};

export function hasFreshCandidateBoardSnapshot(
  roles: ReadonlyArray<{
    lastDiscoveredAt: Date;
    liveness: string;
    applyUrl: string | null;
    sourceType: string | null;
    boardName: string | null;
  }>,
  now = Date.now(),
  source?: CandidateBoardSource,
): boolean {
  const cutoff = now - CANDIDATE_BOARD_SNAPSHOT_FRESH_MS;
  const expectedBoards = source === "nhs"
    ? NHS_BOARD_NAMES
    : source === "reed"
      ? REED_BOARD_NAMES
      : new Set([...NHS_BOARD_NAMES, ...REED_BOARD_NAMES]);
  return roles.filter(
    (role) =>
      role.liveness === "live" &&
      role.applyUrl != null &&
      role.sourceType === "job_board" &&
      role.boardName != null &&
      expectedBoards.has(role.boardName) &&
      new Date(role.lastDiscoveredAt).getTime() >= cutoff,
  ).length >= MIN_FRESH_CANDIDATE_BOARD_ROWS;
}

type CacheEntry = {
  expiresAt: number;
  promise: Promise<CandidateBoardRefreshResult>;
};

const cache = new Map<string, CacheEntry>();

export function candidateBoardSourceForProfession(
  profession: string | null | undefined,
): CandidateBoardSource {
  const category = professionCategoryFor(profession);
  return statutoryRegulatorForCategory(category) ? "nhs" : "reed";
}

export function professionKeywords(profile: CandidateBoardProfile): string {
  const normalized = normalizeProfession(profile.profession);
  const base = (() => {
    switch (normalized) {
      case "nurse":
        return "nurse";
      case "midwife":
        return "midwife";
      case "doctor":
      case "clinical_academic":
        return "doctor";
      case "allied_health_professional":
        return "physiotherapist OR occupational therapist OR radiographer OR paramedic";
      case "teacher_lecturer":
        return "teacher OR lecturer";
      case "lawyer_solicitor":
        return "lawyer OR solicitor";
      case "it_professional":
        return "software OR IT";
      default:
        return normalized.replace(/_/g, " ") || profile.profession.trim();
    }
  })();
  const specialty = profile.specialty?.trim();
  return specialty ? `${base} ${specialty}` : base;
}

function preferredRegions(profile: CandidateBoardProfile): string[] {
  if (Array.isArray(profile.preferredRegion)) return profile.preferredRegion.filter(Boolean);
  return profile.preferredRegion ? [profile.preferredRegion] : [];
}

async function runRefresh(profile: CandidateBoardProfile): Promise<CandidateBoardRefreshResult> {
  const regions = preferredRegions(profile);
  const region = regions.length === 1 ? regions[0]! : null;
  const sourceFamily = candidateBoardSourceForProfession(profile.profession);
  const keywords = professionKeywords(profile);
  const result = sourceFamily === "nhs"
    ? await searchNhsJobsForCandidate(keywords, region, MAX_CANDIDATE_BOARD_RESULTS)
    : await searchReedJobsForCandidate(keywords, region, MAX_CANDIDATE_BOARD_RESULTS);
  const requestSucceeded = "resultsRequestSucceeded" in result
    ? result.resultsRequestSucceeded
    : result.requestSucceeded;
  if (!requestSucceeded) {
    return {
      searched: true,
      failed: true,
      discovered: result.vacancies.length,
      sponsorMatched: 0,
      inserted: 0,
      revived: 0,
    };
  }

  const sponsors = await db
    .select({ organisationName: sponsorLicencesTable.organisationName })
    .from(sponsorLicencesTable);
  const uniqueSponsors = [...new Set(sponsors.map((row) => row.organisationName.trim()).filter(Boolean))];

  const matched = result.vacancies.flatMap((vacancy) => {
    const organisationName = uniqueSponsors.find((name) => candidateEmployerMatchesSponsor(name, vacancy.employer));
    if (!organisationName) return [];
    const targetRegions = regionsFromLocationText(vacancy.location);
    if (!regionsOverlap(targetRegions, regions)) return [];
    const url = canonicalVacancyUrl(vacancy.url);
    if (!url) return [];
    const source = classifyVacancySource(url);
    const expectedBoard = sourceFamily === "nhs" ? "NHS Jobs" : "Reed";
    if (source.sourceType !== "job_board" || source.boardName !== expectedBoard) return [];
    return [{ vacancy, organisationName, targetRegions, url, source }];
  }).slice(0, MAX_CANDIDATE_BOARD_RESULTS);

  const persisted = await upsertSharedBoardVacancies(
    matched.map((item) => ({
      organisationName: item.organisationName,
      employer: item.vacancy.employer,
      title: item.vacancy.title,
      location: item.vacancy.location,
      salary: item.vacancy.salary,
      url: item.url,
      description: null,
      postedDate: item.vacancy.postedDate,
      targetRegions: item.targetRegions,
      boardName: item.source.boardName ?? (sourceFamily === "nhs" ? "NHS Jobs" : "Reed"),
      externalId: item.source.externalListingId,
    })),
    { verifiedLive: true },
  );

  console.info(
    `[candidate-board] ${sourceFamily} searched=true discovered=${result.vacancies.length} sponsor_matched=${matched.length} inserted=${persisted.inserted} revived=${persisted.revived}`,
  );
  return {
    searched: true,
    failed: false,
    discovered: result.vacancies.length,
    sponsorMatched: matched.length,
    inserted: persisted.inserted,
    revived: persisted.revived,
  };
}

export async function refreshCandidateBoardVacancies(
  profile: CandidateBoardProfile,
): Promise<CandidateBoardRefreshResult> {
  const regions = [...new Set(
    preferredRegions(profile)
      .map((region) => region.trim().toLowerCase())
      .filter(Boolean),
  )].sort();
  const sourceFamily = candidateBoardSourceForProfession(profile.profession);
  const keywords = professionKeywords(profile).trim().toLowerCase().replace(/\s+/g, " ");
  const key = `${CANDIDATE_BOARD_SOURCE}|${sourceFamily}|${keywords}|${regions.join(",")}`;
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.promise;

  const promise = runRefresh(profile).catch((error) => {
    console.warn(`[candidate-board] ${sourceFamily} live refresh failed:`, error instanceof Error ? error.message : error);
    return { searched: true, failed: true, discovered: 0, sponsorMatched: 0, inserted: 0, revived: 0 };
  });
  const entry = { expiresAt: Date.now() + CANDIDATE_BOARD_CACHE_TTL_MS, promise };
  cache.set(key, entry);
  void promise.then((result) => {
    if (result.failed) {
      entry.expiresAt = Math.min(
        entry.expiresAt,
        Date.now() + CANDIDATE_BOARD_FAILURE_CACHE_TTL_MS,
      );
    }
  });
  return promise;
}

export function clearCandidateBoardDiscoveryCache(): void {
  cache.clear();
}