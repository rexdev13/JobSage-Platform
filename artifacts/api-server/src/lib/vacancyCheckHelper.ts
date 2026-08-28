import { db } from "@workspace/db";
import {
  sponsorLicenceVacancyChecksTable,
  sponsorLicenceVacanciesTable,
  sponsorLicencesTable,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { eq, and, gt, desc, sql } from "drizzle-orm";

import {
  BLOCKED_VACANCY_DOMAINS,
  isBlockedVacancyUrl,
  isValidVacancyDeepLink,
} from "./vacancyUrlPolicy";
import { searchNhsJobs } from "./nhsJobsClient";
import { searchReedJobs } from "./reedJobsClient";
import {
  completeReedVacancyProbe,
  failReedVacancyProbe,
  reserveReedVacancyProbe,
} from "./reedOutageBackoff";
import { normalizeRegionList } from "./regionMatching";
import {
  classifyVacancySource,
  vacancyStorageKey,
  type VacancySourceType,
} from "./vacancySource";
import { reserveVacancyAiWebSearch } from "./vacancyAiBudget";
import {
  completeNhsVacancyProbe,
  failNhsVacancyProbe,
  reserveNhsVacancyProbe,
} from "./nhsOutageBackoff";

export const VACANCY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Re-export shared URL policy so existing imports keep working.
export { BLOCKED_VACANCY_DOMAINS, isBlockedVacancyUrl, isValidVacancyDeepLink };
import { queueLinkVerificationBatch } from "./linkVerification";

export type VacancyListItem = {
  title: string;
  location: string | null;
  salary: string | null;
  url: string | null;
  description: string | null;
  postedDate: string | null;
  /** Explicitly stated, normalized regions; null/empty means unknown or unrestricted. */
  targetRegions: string[] | null;
  sourceType: VacancySourceType | null;
  boardName: string | null;
  externalListingId: string | null;
};

export type VacancyCheckResult = {
  vacanciesFound: boolean;
  vacancyCount: number | null;
  sourceUrl: string | null;
  summary: string;
  checkedAt: Date;
  fromCache: boolean;
  vacancyList: VacancyListItem[] | null;
  discoveredContactEmail: string | null;
  discoveredContactPhone: string | null;
  discoveredWebsite: string | null;
};

function extractOutermostJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export interface VacancyCheckOptions {
  /**
   * When true, skip the 24h cache and always run a fresh AI check.
   * Use only for contact-backfill passes where existing checks predate contact extraction.
   */
  bypassCache?: boolean;
}

function unavailableResult(
  sourceUrl: string | null,
  retryAt?: Date,
): VacancyCheckResult {
  return {
    vacanciesFound: false,
    vacancyCount: null,
    sourceUrl,
    summary: retryAt
      ? `NHS Jobs HTTP search is temporarily unavailable; retry after ${retryAt.toISOString()}.`
      : "NHS Jobs HTTP search was unavailable; no vacancies found.",
    checkedAt: new Date(),
    fromCache: false,
    vacancyList: null,
    discoveredContactEmail: null,
    discoveredContactPhone: null,
    discoveredWebsite: null,
  };
}

/**
 * Run a vacancy check for a named sponsor licence company.
 * Returns a cached result (within 24h TTL) if one exists, otherwise
 * uses NHS Jobs HTTP discovery, then the capped OpenAI fallback if allowed,
 * persists the result, and returns it.
 * Safe to call from both HTTP handlers and background schedulers.
 *
 * Pass { bypassCache: true } only for the existing, separately gated contact
 * backfill path. It forces a fresh HTTP-first discovery regardless of cache age.
 */
export async function runVacancyCheck(
  organisationName: string,
  opts: VacancyCheckOptions = {},
): Promise<VacancyCheckResult> {
  if (!opts.bypassCache) {
    const cutoff = new Date(Date.now() - VACANCY_CACHE_TTL_MS);
    const [cached] = await db
      .select()
      .from(sponsorLicenceVacancyChecksTable)
      .where(
        and(
          eq(sponsorLicenceVacancyChecksTable.organisationName, organisationName),
          gt(sponsorLicenceVacancyChecksTable.checkedAt, cutoff),
        ),
      )
      .orderBy(desc(sponsorLicenceVacancyChecksTable.checkedAt))
      .limit(1);

    if (cached) {
      return {
        vacanciesFound: cached.vacanciesFound,
        vacancyCount: cached.vacancyCount,
        sourceUrl: cached.sourceUrl,
        summary: cached.summary ?? "No active vacancies found.",
        checkedAt: cached.checkedAt,
        fromCache: true,
        vacancyList: (cached.vacancyList as VacancyListItem[] | null) ?? null,
        // Contact details are not stored on the check record; callers can read
        // them from the sponsor licence row if needed.
        discoveredContactEmail: null,
        discoveredContactPhone: null,
        discoveredWebsite: null,
      };
    }
  }

  let vacanciesFound = false;
  let vacancyCount: number | null = null;
  let sourceUrl: string | null = null;
  let summary = "No active vacancies found.";
  let vacancyList: VacancyListItem[] | null = null;
  let discoveredContactEmail: string | null = null;
  let discoveredContactPhone: string | null = null;
  let discoveredWebsite: string | null = null;
  let nhsResultsRequestSucceeded = false;
  let nhsTransientFailure = false;
  let reedResultsRequestSucceeded = false;
  let reedTransientFailure = false;

  const discovered: VacancyListItem[] = [];
  const nhsProbe = await reserveNhsVacancyProbe(organisationName);
  let nhsRetryAt: Date | undefined;
  if (nhsProbe.allowed) {
    try {
      const nhs = await searchNhsJobs(organisationName);
      sourceUrl = nhs.sourceUrl;
      nhsResultsRequestSucceeded = nhs.resultsRequestSucceeded;
      nhsTransientFailure = nhs.transientFailure ?? !nhs.resultsRequestSucceeded;
      discovered.push(
        ...nhs.vacancies.map((vacancy) => ({
          ...vacancy,
          ...classifyVacancySource(vacancy.url),
        })),
      );
      console.info(
        `[vacancy-check] used_nhs_http organisation="${organisationName}" vacancies=${nhs.vacancies.length} structured_feed=${nhs.structuredFeedWorked} results_success=${nhs.resultsRequestSucceeded}`,
      );
    } catch {
      nhsTransientFailure = true;
    }
    if (nhsTransientFailure) {
      nhsRetryAt = (await failNhsVacancyProbe(nhsProbe)) ?? undefined;
      if (nhsRetryAt) {
        console.warn(
          `[vacancy-check] NHS Jobs unavailable organisation="${organisationName}" retry_after=${nhsRetryAt.toISOString()}`,
        );
      }
    } else {
      await completeNhsVacancyProbe(nhsProbe);
    }
  } else {
    nhsTransientFailure = true;
    nhsRetryAt = nhsProbe.retryAt;
  }

  const reedProbe = await reserveReedVacancyProbe(organisationName);
  if (reedProbe.allowed) {
    try {
      const reed = await searchReedJobs(organisationName);
      reedResultsRequestSucceeded = reed.requestSucceeded;
      reedTransientFailure = reed.transientFailure;
      discovered.push(...reed.vacancies);
      console.info(
        `[vacancy-check] used_reed_http organisation="${organisationName}" vacancies=${reed.vacancies.length} results_success=${reed.requestSucceeded}`,
      );
    } catch {
      reedTransientFailure = true;
    }
    if (reedTransientFailure) {
      const retryAt = await failReedVacancyProbe(reedProbe);
      if (retryAt) {
        console.warn(
          `[vacancy-check] Reed unavailable organisation="${organisationName}" retry_after=${retryAt.toISOString()}`,
        );
      }
    } else {
      await completeReedVacancyProbe(reedProbe);
    }
  } else {
    reedTransientFailure = true;
  }

  const seenVacancies = new Set<string>();
  vacancyList = discovered.filter((vacancy) => {
    if (!vacancy.url) return false;
    const key = vacancyStorageKey(organisationName, vacancy.url);
    if (!key || seenVacancies.has(key)) return false;
    seenVacancies.add(key);
    return true;
  });
  vacanciesFound = vacancyList.length > 0;
  vacancyCount = vacancyList.length || null;
  summary = vacanciesFound
    ? `${vacancyList.length} matching ${vacancyList.length === 1 ? "vacancy" : "vacancies"} found across supported job boards.`
    : "No closely matched current vacancies found on supported job boards.";

  // Never cache a cross-board empty snapshot when a board was unavailable.
  if (!vacanciesFound && (nhsTransientFailure || reedTransientFailure)) {
    return unavailableResult(sourceUrl, nhsRetryAt ?? new Date(Date.now() + 45 * 60 * 1000));
  }

  // Only spend an AI call after NHS HTTP found no suitable result and a slot was
  // reserved for the current London day. The default cap is zero.
  if (!vacanciesFound) {
    const reservation = await reserveVacancyAiWebSearch();
    if (!reservation.allowed) {
      console.info(
        `[vacancy-check] skipped_ai_cap organisation="${organisationName}" cap=${reservation.cap} used=${reservation.used} day=${reservation.day}`,
      );
    } else {
      console.info(
        `[vacancy-check] used_ai organisation="${organisationName}" cap=${reservation.cap} used=${reservation.used} day=${reservation.day}`,
      );
      try {
        const response = await openai.responses.create({
          model: "gpt-4o",
          tools: [{ type: "web_search_preview" as const }],
          input: `Search for current job openings at "${organisationName}" in the United Kingdom.
Prioritise the company's own careers page and NHS Jobs (jobs.nhs.uk) first. Only use third-party aggregators such as Indeed, Reed, LinkedIn, or CV-Library as a last resort, and prefer URLs that point directly to the employer's own domain.
While visiting the company's own site, also look for their public contact details (email address, phone number, and website URL). Only capture details from the company's own website — do not use aggregator or directory sites for contact information.
After searching, reply with a JSON object ONLY — no markdown, no extra text, just raw JSON:
{
  "vacanciesFound": true or false,
  "vacancyCount": number or null,
  "sourceUrl": "URL to search results or careers page",
  "summary": "1-2 sentence summary of what you found",
  "contactEmail": "contact or HR email from the company's own site, or null",
  "contactPhone": "UK phone number from the company's own site (include country code if shown), or null",
  "website": "company's main website URL (must start with https:// or http://), or null",
  "vacancyList": [
    {
      "title": "Job title",
      "location": "City, County or null",
      "salary": "£XX,XXX - £XX,XXX or null",
      "url": "EXACT deep-link URL to this specific job advert's own page, or null. STRICT: the URL must open the individual job posting itself (e.g. https://employer.com/careers/vacancy/12345-staff-nurse). NEVER use a generic careers page, homepage, jobs listing page, or search results page. NEVER use aggregator sites (Indeed, Reed, LinkedIn, CV-Library, TotalJobs, Glassdoor, Adzuna, Jobijoba, SimplyHired, Bebee, etc.). If you do not have an exact deep-link to the specific advert, you MUST use null.",
      "description": "2-3 sentence description of the role or null",
       "postedDate": "YYYY-MM-DD or relative like '3 days ago' or null",
       "targetRegions": ["Only UK regions explicitly stated by the advert, using the app's canonical region names, or an empty array"]
    }
  ]
}
Include up to 8 specific vacancies in vacancyList if found. Do not guess targetRegions from a vague location; use an empty array when the region is not explicit. Use null for missing fields. vacancyList must be an empty array if no vacancies found.`,
        });

        const text = response.output_text ?? "";
        const jsonStr = extractOutermostJson(text);
        if (jsonStr) {
          const parsed = JSON.parse(jsonStr) as {
            vacanciesFound?: boolean;
            vacancyCount?: number | null;
            sourceUrl?: string | null;
            summary?: string;
            contactEmail?: string | null;
            contactPhone?: string | null;
            website?: string | null;
            vacancyList?: Array<{
              title?: string;
              location?: string | null;
              salary?: string | null;
              url?: string | null;
              description?: string | null;
              postedDate?: string | null;
               targetRegions?: unknown;
            }>;
          };
          vacanciesFound = parsed.vacanciesFound === true;
          vacancyCount = typeof parsed.vacancyCount === "number" ? parsed.vacancyCount : null;
          if (typeof parsed.sourceUrl === "string" && parsed.sourceUrl.startsWith("http")) {
            sourceUrl = parsed.sourceUrl;
          }
          summary = typeof parsed.summary === "string"
            ? parsed.summary
            : (vacanciesFound
              ? `Vacancies found for ${organisationName}.`
              : `No active vacancies found for ${organisationName}.`);
          if (typeof parsed.contactEmail === "string" && parsed.contactEmail.trim()) {
            discoveredContactEmail = parsed.contactEmail.trim();
          }
          if (typeof parsed.contactPhone === "string" && parsed.contactPhone.trim()) {
            discoveredContactPhone = parsed.contactPhone.trim();
          }
          if (typeof parsed.website === "string" && parsed.website.trim().startsWith("http")) {
            discoveredWebsite = parsed.website.trim();
          }
          if (Array.isArray(parsed.vacancyList) && parsed.vacancyList.length > 0) {
            vacancyList = parsed.vacancyList
              .filter((v) => typeof v.title === "string" && v.title.trim())
              .map((v) => ({
                title: (v.title ?? "").trim(),
                location: typeof v.location === "string" ? v.location.trim() || null : null,
                salary: typeof v.salary === "string" ? v.salary.trim() || null : null,
                url:
                  typeof v.url === "string" && isValidVacancyDeepLink(v.url.trim())
                    ? v.url.trim()
                    : null,
                description: typeof v.description === "string" ? v.description.trim() || null : null,
                postedDate: typeof v.postedDate === "string" ? v.postedDate.trim() || null : null,
                targetRegions: Array.isArray(v.targetRegions)
                  ? normalizeRegionList(v.targetRegions.filter((value): value is string => typeof value === "string"))
                  : null,
                ...classifyVacancySource(
                  typeof v.url === "string" && isValidVacancyDeepLink(v.url.trim())
                    ? v.url.trim()
                    : null,
                ),
              }))
              .slice(0, 8);
            if (vacancyList.length > 0 && !vacancyCount) {
              vacancyCount = vacancyList.length;
            }
          }
        }
      } catch (aiErr) {
        console.warn(
          `[vacancy-check] AI check failed for "${organisationName}":`,
          aiErr instanceof Error ? aiErr.message : aiErr,
        );
        // The AI call was allowed but failed. Keep the organisation stale so it
        // can be retried on a later batch when a fresh cap slot is available.
        return {
          vacanciesFound: false,
          vacancyCount: null,
          sourceUrl,
          summary: "AI check failed — will retry on next batch.",
          checkedAt: new Date(),
          fromCache: false,
          vacancyList: null,
          discoveredContactEmail: null,
          discoveredContactPhone: null,
          discoveredWebsite: null,
        };
      }
    }
  }

  const [saved] = await db
    .insert(sponsorLicenceVacancyChecksTable)
    .values({ organisationName, vacanciesFound, vacancyCount, sourceUrl, summary, vacancyList })
    .returning();

  // Persist individual vacancy rows — delete stale snapshot first, then insert current one.
  // Keeps sponsor_licence_vacancies as a point-in-time snapshot (not accumulating history).
  // Liveness carry-over: rows in the new snapshot whose URL was already
  // verified by the liveness sweep keep that verdict (live or dead) and its
  // timestamp/reason instead of resetting to "unverified" on every refresh.
  const priorLiveness = new Map<
    string,
    { liveness: "unverified" | "live" | "dead"; lastVerifiedAt: Date | null; livenessReason: string | null }
  >();
  const priorRows = await db
    .select({
      url: sponsorLicenceVacanciesTable.url,
      liveness: sponsorLicenceVacanciesTable.liveness,
      lastVerifiedAt: sponsorLicenceVacanciesTable.lastVerifiedAt,
      livenessReason: sponsorLicenceVacanciesTable.livenessReason,
    })
    .from(sponsorLicenceVacanciesTable)
    .where(eq(sponsorLicenceVacanciesTable.organisationName, organisationName));
  for (const r of priorRows) {
    if (r.url && r.liveness !== "unverified") {
      priorLiveness.set(r.url, { liveness: r.liveness, lastVerifiedAt: r.lastVerifiedAt, livenessReason: r.livenessReason });
    }
  }

  await db
    .delete(sponsorLicenceVacanciesTable)
    .where(eq(sponsorLicenceVacanciesTable.organisationName, organisationName));

  if (vacancyList && vacancyList.length > 0) {
    const checkDate = new Date().toISOString().split("T")[0]!;
    const inserted = await db
      .insert(sponsorLicenceVacanciesTable)
      .values(
        vacancyList.map((v) => {
          const prior = v.url ? priorLiveness.get(v.url) : undefined;
          return {
            organisationName,
            checkDate,
            title: v.title,
            location: v.location ?? null,
            salary: v.salary ?? null,
            url: v.url ?? null,
            description: v.description ?? null,
            postedDate: v.postedDate ?? null,
            targetRegions: v.targetRegions ?? [],
            sourceType: v.sourceType,
            boardName: v.boardName,
            externalListingId: v.externalListingId,
            liveness: prior?.liveness ?? ("unverified" as const),
            lastVerifiedAt: prior?.lastVerifiedAt ?? null,
            livenessReason: prior?.livenessReason ?? null,
          };
        }),
      )
      .returning({
        id: sponsorLicenceVacanciesTable.id,
        url: sponsorLicenceVacanciesTable.url,
        liveness: sponsorLicenceVacanciesTable.liveness,
      });

    // Verify newly discovered links right away (fire-and-forget) so fresh
    // snapshots don't sit unverified until the next background sweep.
    queueLinkVerificationBatch(
      inserted
        .filter((r) => r.liveness === "unverified" && r.url)
        .map((r) => ({ source: "sponsor_vacancy" as const, id: r.id, url: r.url })),
    );
  }

  // Persist discovered contact details to the sponsor licence record.
  // Only fill empty fields — never overwrite admin-set or previously enriched values.
  // Uses COALESCE so existing non-null values are preserved unconditionally.
  if (discoveredContactEmail || discoveredContactPhone || discoveredWebsite) {
    try {
      const updateResult = await db
        .update(sponsorLicencesTable)
        .set({
          contactEmail: sql`COALESCE(${sponsorLicencesTable.contactEmail}, ${discoveredContactEmail})`,
          contactPhone: sql`COALESCE(${sponsorLicencesTable.contactPhone}, ${discoveredContactPhone})`,
          website: sql`COALESCE(${sponsorLicencesTable.website}, ${discoveredWebsite})`,
        })
        .where(eq(sponsorLicencesTable.organisationName, organisationName))
        .returning({
          id: sponsorLicencesTable.id,
          contactEmail: sponsorLicencesTable.contactEmail,
          contactPhone: sponsorLicencesTable.contactPhone,
          website: sponsorLicencesTable.website,
        });

      if (updateResult.length > 0) {
        console.info(
          `[vacancy-check] Contact details populated for "${organisationName}":`,
          {
            contactEmail: discoveredContactEmail ?? "(none)",
            contactPhone: discoveredContactPhone ?? "(none)",
            website: discoveredWebsite ?? "(none)",
            affectedRows: updateResult.length,
          },
        );
      }
    } catch (contactErr) {
      console.warn(
        `[vacancy-check] Failed to persist contact details for "${organisationName}":`,
        contactErr instanceof Error ? contactErr.message : contactErr,
      );
    }
  }

  return {
    vacanciesFound,
    vacancyCount,
    sourceUrl,
    summary,
    checkedAt: saved?.checkedAt ?? new Date(),
    fromCache: false,
    vacancyList,
    discoveredContactEmail,
    discoveredContactPhone,
    discoveredWebsite,
  };
}
