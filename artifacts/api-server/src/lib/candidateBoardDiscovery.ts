import { db, sponsorLicenceVacanciesTable, sponsorLicencesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { candidateEmployerMatchesSponsor, searchNhsJobsForCandidate } from "./nhsJobsClient";
import { regionsFromLocationText, regionsOverlap } from "./regionMatching";
import { canonicalVacancyUrl, classifyVacancySource } from "./vacancySource";

export const CANDIDATE_BOARD_CACHE_TTL_MS = 20 * 60 * 1000;
export const CANDIDATE_BOARD_FAILURE_CACHE_TTL_MS = 20 * 60 * 1000;
export const MAX_CANDIDATE_BOARD_RESULTS = 300;
const CANDIDATE_BOARD_SOURCE = "job_board";

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

type CacheEntry = {
  expiresAt: number;
  promise: Promise<CandidateBoardRefreshResult>;
};

const cache = new Map<string, CacheEntry>();

function professionKeywords(profile: CandidateBoardProfile): string {
  const specialty = profile.specialty?.trim();
  if (specialty) return specialty;
  switch (profile.profession.toLowerCase().trim()) {
    case "nurse":
      return "nurse";
    case "midwife":
      return "midwife";
    case "doctor":
    case "clinical_academic":
      return "doctor";
    case "allied_health_professional":
      return "physiotherapist";
    default:
      return profile.profession.replace(/_/g, " ");
  }
}

function preferredRegions(profile: CandidateBoardProfile): string[] {
  if (Array.isArray(profile.preferredRegion)) return profile.preferredRegion.filter(Boolean);
  return profile.preferredRegion ? [profile.preferredRegion] : [];
}

async function runRefresh(profile: CandidateBoardProfile): Promise<CandidateBoardRefreshResult> {
  const regions = preferredRegions(profile);
  const region = regions.length === 1 ? regions[0]! : null;
  const result = await searchNhsJobsForCandidate(
    professionKeywords(profile),
    region,
    MAX_CANDIDATE_BOARD_RESULTS,
  );
  if (!result.resultsRequestSucceeded) {
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
    if (source.sourceType !== "job_board" || source.boardName !== "NHS Jobs") return [];
    return [{ vacancy, organisationName, targetRegions, url, source }];
  }).slice(0, MAX_CANDIDATE_BOARD_RESULTS);

  const existingRows = await db
    .select()
    .from(sponsorLicenceVacanciesTable)
    .where(eq(sponsorLicenceVacanciesTable.sourceType, "job_board"));
  const existingByCanonical = new Map(
    existingRows.flatMap((row) => {
      const canonical = row.url ? canonicalVacancyUrl(row.url) : null;
      return canonical ? [[canonical, row] as const] : [];
    }),
  );

  const now = new Date();
  const checkDate = now.toISOString().slice(0, 10);
  let inserted = 0;
  let revived = 0;
  for (const item of matched) {
    const existing = existingByCanonical.get(item.url);
    if (existing) {
      await db
        .update(sponsorLicenceVacanciesTable)
        .set({
          organisationName: item.organisationName,
          title: item.vacancy.title,
          location: item.vacancy.location,
          salary: item.vacancy.salary,
          postedDate: item.vacancy.postedDate,
          targetRegions: item.targetRegions,
          sourceType: "job_board",
          boardName: item.source.boardName,
          externalListingId: item.source.externalListingId,
          liveness: "live",
          lastVerifiedAt: now,
          livenessReason: null,
        })
        .where(eq(sponsorLicenceVacanciesTable.id, existing.id));
      if (existing.liveness !== "live") revived += 1;
      continue;
    }
    await db.insert(sponsorLicenceVacanciesTable).values({
      organisationName: item.organisationName,
      checkDate,
      title: item.vacancy.title,
      location: item.vacancy.location,
      salary: item.vacancy.salary,
      url: item.url,
      description: null,
      postedDate: item.vacancy.postedDate,
      targetRegions: item.targetRegions,
      sourceType: "job_board",
      boardName: item.source.boardName,
      externalListingId: item.source.externalListingId,
      liveness: "live",
      lastVerifiedAt: now,
      livenessReason: null,
    });
    inserted += 1;
  }

  console.info(
    `[candidate-board] nhs searched=true discovered=${result.vacancies.length} sponsor_matched=${matched.length} inserted=${inserted} revived=${revived}`,
  );
  return {
    searched: true,
    failed: false,
    discovered: result.vacancies.length,
    sponsorMatched: matched.length,
    inserted,
    revived,
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
  const keywords = professionKeywords(profile).trim().toLowerCase().replace(/\s+/g, " ");
  const key = `${CANDIDATE_BOARD_SOURCE}|${keywords}|${regions.join(",")}`;
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.promise;

  const promise = runRefresh(profile).catch((error) => {
    console.warn("[candidate-board] NHS live refresh failed:", error instanceof Error ? error.message : error);
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