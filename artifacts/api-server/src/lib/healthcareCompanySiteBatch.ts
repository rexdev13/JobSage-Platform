import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { discoverCompanySiteVacancies } from "./companySiteDiscovery";
import { fetchCompanySitePage } from "./companySiteHttp";
import { upsertSharedBoardVacancies, type BoardAdvert } from "./boardVacancyPipeline";
import { getCandidateVacancyStatus } from "./vacancyLiveness";
import { canonicalVacancyUrl } from "./vacancySource";
import {
  buildStrictHealthcareRoleEvidence,
  extractHealthcareApplicationRoute,
  isSpecificHealthcareRoleTitle,
  type StrictHealthcareRoleEvidence,
} from "./healthcareRoleEvidence";

export const HEALTHCARE_BATCH_MAX_EMPLOYERS = 15;
export const HEALTHCARE_BATCH_MAX_DETAIL_FETCHES = 40;
export const HEALTHCARE_BATCH_MAX_DISCOVERY_PASSES = 4;
export const HEALTHCARE_BATCH_DEFAULT_BUDGET_MS = 240_000;
const REVIEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DETAIL_PACE_MS = 1_800;

export type HealthcareBatchEmployer = {
  organisationName: string;
  website: string;
  careersUrl: string;
};

export type HealthcareBatchRejection = {
  organisationName: string;
  title?: string;
  url?: string;
  reason: string;
};

export type HealthcareBatchAccepted = {
  organisationName: string;
  title: string;
  location: string | null;
  url: string;
  applicationUrl: string | null;
  contactEmail: string | null;
  listingUrl: string;
  description: string | null;
  evidence: StrictHealthcareRoleEvidence;
};

export type HealthcareBatchStoredRow = {
  id: number;
  organisationName: string;
  title: string;
  url: string | null;
  applicationUrl: string | null;
  liveness: string;
  lastVerifiedAt: Date | null;
  candidateVisible: boolean;
};

export type HealthcareBatchReport = {
  apply: boolean;
  budgetExhausted: boolean;
  employersChecked: Array<Record<string, unknown>>;
  found: number;
  accepted: number;
  rejected: number;
  rejectionReasons: Record<string, number>;
  acceptedRows: HealthcareBatchAccepted[];
  rejectedRows: HealthcareBatchRejection[];
  counts: {
    before: { companySite: number; candidateVisible: number };
    after: { companySite: number; candidateVisible: number };
  };
  inserted: number;
  updated: number;
  repeatInserted: number;
  candidateVisible: number;
  storedRows: HealthcareBatchStoredRow[];
  rollback: {
    reviewUntil: string;
    previouslyExistingIds: number[];
    insertedIds: number[];
    deleteInsertedSql: string | null;
  } | null;
};

export type HealthcareBatchOptions = {
  employers: HealthcareBatchEmployer[];
  apply: boolean;
  budgetMs?: number;
  now?: () => number;
};

export function parseHealthcareBatchEmployers(value: unknown): HealthcareBatchEmployer[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("employers must be a non-empty array.");
  }
  if (value.length > HEALTHCARE_BATCH_MAX_EMPLOYERS) {
    throw new Error(`employers is limited to ${HEALTHCARE_BATCH_MAX_EMPLOYERS} entries.`);
  }
  return value.map((row, index) => {
    if (!row || typeof row !== "object") throw new Error(`employers[${index}] must be an object.`);
    const record = row as Record<string, unknown>;
    const organisationName = typeof record.organisationName === "string" ? record.organisationName.trim() : "";
    const website = typeof record.website === "string" ? record.website.trim() : "";
    const careersUrl = typeof record.careersUrl === "string" ? record.careersUrl.trim() : "";
    if (!organisationName || !website || !careersUrl) {
      throw new Error(`employers[${index}] needs organisationName, website, and careersUrl.`);
    }
    for (const candidate of [website, careersUrl]) {
      let parsed: URL;
      try {
        parsed = new URL(candidate);
      } catch {
        throw new Error(`employers[${index}] has an invalid URL.`);
      }
      if (parsed.protocol !== "https:") throw new Error(`employers[${index}] URLs must use https.`);
    }
    return { organisationName, website, careersUrl };
  });
}

type StoredVacancy = {
  id: number;
  organisation_name: string;
  title: string;
  url: string | null;
  application_url: string | null;
  liveness: string;
  last_verified_at: Date | null;
  source_type: string | null;
  company_vacancy_evidence: unknown;
  company_evidence_legacy_until: Date | null;
  closes_at: Date | null;
  expires_at: Date | null;
  closed_reason: string | null;
  source_missing_since: Date | null;
  source_missing_observations: number | null;
};

function isCandidateVisible(row: StoredVacancy): boolean {
  return getCandidateVacancyStatus({
    sourceType: "company_site",
    title: row.title,
    liveness: row.liveness,
    lastVerifiedAt: row.last_verified_at,
    companyVacancyEvidence: row.company_vacancy_evidence,
    companyEvidenceLegacyUntil: row.company_evidence_legacy_until,
    closesAt: row.closes_at,
    expiresAt: row.expires_at,
    closedReason: row.closed_reason,
    sourceMissingSince: row.source_missing_since,
    sourceMissingObservations: row.source_missing_observations,
  }) === "visible";
}

async function loadCohortRows(organisationNames: string[]): Promise<StoredVacancy[]> {
  if (organisationNames.length === 0) return [];
  const result = await db.execute<StoredVacancy>(sql`
    SELECT id, organisation_name, title, url, application_url, liveness, last_verified_at,
           source_type, company_vacancy_evidence, company_evidence_legacy_until,
           closes_at, expires_at, closed_reason, source_missing_since, source_missing_observations
    FROM sponsor_licence_vacancies
    WHERE source_type = 'company_site'
      AND lower(btrim(organisation_name)) = ANY(${sql.param(organisationNames.map((name) => name.trim().toLowerCase()))}::text[])
    ORDER BY id
  `);
  return result.rows;
}

function summarise(rows: StoredVacancy[]): { companySite: number; candidateVisible: number } {
  return {
    companySite: rows.length,
    candidateVisible: rows.filter(isCandidateVisible).length,
  };
}

export async function runHealthcareCompanySiteBatch(
  options: HealthcareBatchOptions,
): Promise<HealthcareBatchReport> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? HEALTHCARE_BATCH_DEFAULT_BUDGET_MS);
  const employers = parseHealthcareBatchEmployers(options.employers);
  const accepted: HealthcareBatchAccepted[] = [];
  const rejected: HealthcareBatchRejection[] = [];
  const employersChecked: Array<Record<string, unknown>> = [];
  const resolvedNames: string[] = [];
  let budgetExhausted = false;

  for (const employer of employers) {
    if (now() >= deadline) {
      budgetExhausted = true;
      employersChecked.push({ organisationName: employer.organisationName, status: "skipped_budget" });
      continue;
    }
    const sponsor = await db.execute<{ organisation_name: string }>(sql`
      SELECT organisation_name
      FROM sponsor_licences
      WHERE lower(btrim(organisation_name)) = lower(btrim(${employer.organisationName}))
        AND industry IN ('Healthcare', 'Social Care')
      LIMIT 1
    `);
    const organisationName = sponsor.rows[0]?.organisation_name;
    if (!organisationName) {
      rejected.push({ organisationName: employer.organisationName, reason: "not_a_healthcare_sponsor" });
      employersChecked.push({ organisationName: employer.organisationName, status: "rejected", reason: "not_a_healthcare_sponsor" });
      continue;
    }
    resolvedNames.push(organisationName);
    const origin = new URL(employer.website).hostname;
    const discoveredAdverts: BoardAdvert[] = [];
    let lastDiscovery: Awaited<ReturnType<typeof discoverCompanySiteVacancies>> | undefined;
    let resumeState: Awaited<ReturnType<typeof discoverCompanySiteVacancies>>["resumeState"] = null;
    try {
      for (let pass = 0; pass < HEALTHCARE_BATCH_MAX_DISCOVERY_PASSES && now() < deadline; pass += 1) {
        lastDiscovery = await discoverCompanySiteVacancies(organisationName, employer.website, {
          knownCareersUrl: employer.careersUrl,
          checkGeneric: true,
          checkAts: true,
          directFeedsOnly: false,
          readOnly: true,
          noHostState: true,
          resumeState,
          deadlineMs: deadline,
        });
        discoveredAdverts.push(...lastDiscovery.adverts);
        resumeState = lastDiscovery.resumeState ?? null;
        if (!resumeState || resumeState.queue.length === 0) break;
      }
    } catch (error) {
      rejected.push({
        organisationName,
        reason: `discovery_failed:${error instanceof Error ? error.message.slice(0, 180) : "unknown"}`,
      });
      employersChecked.push({ organisationName, status: "error" });
      continue;
    }
    let detailFetches = 0;
    let found = 0;
    let kept = 0;
    const seenUrls = new Set<string>();
    for (const advert of discoveredAdverts) {
      if (seenUrls.has(advert.url)) continue;
      seenUrls.add(advert.url);
      found += 1;
      if (now() >= deadline) {
        budgetExhausted = true;
        rejected.push({ organisationName, title: advert.title, url: advert.url, reason: "budget_exhausted" });
        continue;
      }
      if (!isSpecificHealthcareRoleTitle(advert.title)) {
        rejected.push({ organisationName, title: advert.title, url: advert.url, reason: "title_not_specific_healthcare_role" });
        continue;
      }
      if (detailFetches >= HEALTHCARE_BATCH_MAX_DETAIL_FETCHES) {
        rejected.push({ organisationName, title: advert.title, url: advert.url, reason: "detail_fetch_cap" });
        continue;
      }
      detailFetches += 1;
      await new Promise((resolve) => setTimeout(resolve, DETAIL_PACE_MS));
      const detailDeadline = Math.min(deadline, now() + 20_000);
      let detail = await fetchCompanySitePage(advert.url, origin, detailDeadline, undefined, {
        readOnly: true,
        noHostState: true,
      });
      for (let attempt = 0; !detail.ok && detail.kind === "rate_limited" && attempt < 3 && now() < deadline; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        detail = await fetchCompanySitePage(advert.url, origin, Math.min(deadline, now() + 20_000), undefined, {
          readOnly: true,
          noHostState: true,
        });
      }
      if (!detail.ok) {
        rejected.push({ organisationName, title: advert.title, url: advert.url, reason: `detail_${detail.kind}` });
        continue;
      }
      const route = extractHealthcareApplicationRoute(detail.body, advert.url, origin);
      const listingUrl = advert.companyVacancyEvidence?.listingUrl || employer.careersUrl;
      const evidence = buildStrictHealthcareRoleEvidence({
        title: advert.title,
        detailUrl: advert.url,
        listingUrl,
        employerHost: origin,
        applicationUrl: route.applicationUrl ?? advert.applicationUrl,
        contactEmail: route.contactEmail ?? advert.contactEmail,
      });
      if (!evidence) {
        rejected.push({ organisationName, title: advert.title, url: advert.url, reason: "missing_apply_or_recruitment_route" });
        continue;
      }
      const canonical = canonicalVacancyUrl(advert.url);
      if (!canonical) {
        rejected.push({ organisationName, title: advert.title, url: advert.url, reason: "invalid_url" });
        continue;
      }
      const duplicate = await db.execute<{ id: number; source_type: string | null }>(sql`
        SELECT id, source_type
        FROM sponsor_licence_vacancies
        WHERE source_type IS DISTINCT FROM 'company_site'
          AND (
            lower(split_part(split_part(coalesce(url, ''), '#', 1), '?', 1)) = lower(split_part(split_part(${canonical}, '#', 1), '?', 1))
            OR (
              lower(btrim(organisation_name)) = lower(btrim(${organisationName}))
              AND lower(btrim(title)) = lower(btrim(${advert.title}))
              AND lower(btrim(coalesce(location, ''))) = lower(btrim(${advert.location ?? ""}))
            )
          )
        LIMIT 1
      `);
      if (duplicate.rows[0]) {
        rejected.push({ organisationName, title: advert.title, url: advert.url, reason: "duplicate_other_source_vacancy" });
        continue;
      }
      kept += 1;
      accepted.push({
        organisationName,
        title: advert.title,
        location: advert.location,
        url: canonical,
        applicationUrl: evidence.applicationUrl ?? null,
        contactEmail: evidence.contactEmail ?? null,
        listingUrl: evidence.listingUrl,
        description: advert.description,
        evidence,
      });
    }
    employersChecked.push({
      organisationName,
      pagesFetched: lastDiscovery?.pagesFetched ?? 0,
      discovered: found,
      accepted: kept,
      careersUrl: lastDiscovery?.careersUrl ?? employer.careersUrl,
      error: lastDiscovery?.error ?? null,
    });
  }

  const beforeRows = await loadCohortRows(resolvedNames);
  const before = summarise(beforeRows);
  const report: HealthcareBatchReport = {
    apply: options.apply,
    budgetExhausted,
    employersChecked,
    found: employersChecked.reduce((sum, row) => sum + Number(row.discovered ?? 0), 0),
    accepted: accepted.length,
    rejected: rejected.length,
    rejectionReasons: rejected.reduce<Record<string, number>>((counts, row) => {
      counts[row.reason] = (counts[row.reason] ?? 0) + 1;
      return counts;
    }, {}),
    acceptedRows: accepted,
    rejectedRows: rejected,
    counts: { before, after: before },
    inserted: 0,
    updated: 0,
    repeatInserted: 0,
    candidateVisible: 0,
    storedRows: [],
    rollback: null,
  };

  if (!options.apply || accepted.length === 0) return report;

  const reviewUntil = new Date(now() + REVIEW_WINDOW_MS);
  const adverts: BoardAdvert[] = accepted.map((row) => ({
    organisationName: row.organisationName,
    employer: row.organisationName,
    title: row.title,
    location: row.location,
    salary: null,
    url: row.url,
    applicationUrl: row.applicationUrl,
    description: row.description,
    postedDate: null,
    targetRegions: null,
    boardName: null,
    externalId: null,
    sourceType: "company_site",
    contactEmail: row.contactEmail,
    contactEvidenceUrl: row.url,
    companyVacancyEvidence: row.evidence,
    companyEvidenceLegacyUntil: reviewUntil,
  }));
  const previouslyExistingIds = beforeRows
    .filter((row) => row.url && adverts.some((advert) => advert.url === canonicalVacancyUrl(row.url!)))
    .map((row) => row.id);
  const first = await upsertSharedBoardVacancies(adverts, { queueVerifications: false, verifiedLive: true });
  const second = await upsertSharedBoardVacancies(adverts, {
    queueVerifications: false,
    verifiedLive: true,
    requireExisting: true,
  });
  const afterRows = await loadCohortRows(resolvedNames);
  const batchUrls = new Set(adverts.map((advert) => advert.url));
  const stored = afterRows.filter((row) => row.url && batchUrls.has(canonicalVacancyUrl(row.url) ?? ""));
  const insertedIds = stored.map((row) => row.id).filter((id) => !previouslyExistingIds.includes(id));
  report.inserted = first.inserted;
  report.updated = first.updated;
  report.repeatInserted = second.inserted;
  report.counts.after = summarise(afterRows);
  report.storedRows = stored.map((row) => ({
    id: row.id,
    organisationName: row.organisation_name,
    title: row.title,
    url: row.url,
    applicationUrl: row.application_url,
    liveness: row.liveness,
    lastVerifiedAt: row.last_verified_at,
    candidateVisible: isCandidateVisible(row),
  }));
  report.candidateVisible = report.storedRows.filter((row) => row.candidateVisible).length;
  report.rollback = {
    reviewUntil: reviewUntil.toISOString(),
    previouslyExistingIds,
    insertedIds,
    deleteInsertedSql: insertedIds.length > 0
      ? `DELETE FROM sponsor_licence_vacancies WHERE source_type = 'company_site' AND id IN (${insertedIds.join(",")});`
      : null,
  };
  if (second.inserted !== 0) {
    throw new Error(`Repeat import inserted ${second.inserted} rows; inspect rollback ids ${insertedIds.join(",")}.`);
  }
  return report;
}
