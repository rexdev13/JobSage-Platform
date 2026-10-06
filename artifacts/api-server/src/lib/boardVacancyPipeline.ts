import {
  db,
  sponsorLicenceVacanciesTable,
  vacancySourceObservationsTable,
} from "@workspace/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { isLikelyEditorialTitle, isManualLabourTitle } from "./vacancyTitlePolicy";
import { canonicalVacancyUrl, classifyVacancySource } from "./vacancySource";
import { isValidVacancyUrlForSource } from "./vacancyUrlPolicy";
import type { StrictRolePageSector } from "./companySiteRoleSectors";
import { queueLinkVerificationBatch } from "./linkVerification";
import { queueCompanySiteVerificationBatch } from "./companySiteVerification";
import { searchNhsJobs } from "./nhsJobsClient";
import { searchReedJobs } from "./reedJobsClient";
import {
  completeNhsVacancyProbe,
  failNhsVacancyProbe,
  reserveNhsVacancyProbe,
  type NhsProbeReservation,
} from "./nhsOutageBackoff";
import {
  completeReedVacancyProbe,
  failReedVacancyProbe,
  reserveReedVacancyProbe,
} from "./reedOutageBackoff";
import {
  choosePreferredPublishedEmail,
  validatePublishedContactEmail,
} from "./publishedContactEmail";
import { enrichAdvertContacts } from "./vacancyAdvertContact";
import {
  extractVacancyClosingDate,
  hasExplicitClosedPhrase,
  hasVacancyClosingDateLabel,
} from "./vacancyDates";
import { hasApprovedCompanyVacancyRoleEligibilityReview } from "./vacancyLiveness";

export interface BoardAdvert {
  organisationName: string;
  title: string;
  employer: string;
  location: string | null;
  salary: string | null;
  url: string;
  applicationUrl?: string | null;
  description: string | null;
  postedDate: string | null;
  targetRegions: string[] | null;
  boardName: string | null;
  externalId: string | null;
  sourceType?: "job_board" | "company_site";
  /** Stable collector identity; never used as a candidate-facing URL. */
  sourceId?: string;
  /** Non-candidate source facts not represented by typed vacancy columns. */
  sourceMetadata?: Record<string, unknown> | null;
  contactEmail?: string | null;
  contactEvidenceUrl?: string | null;
  closesAt?: Date | null;
  expiresAt?: Date | null;
  closedReason?: string | null;
  /** Ephemeral import correlation only; never persisted to sponsor_licence_vacancies. */
  reviewedSourceRow?: string;
  companyVacancyEvidence?: {
    kind: "json_ld_job_posting" | "microdata_job_posting" | "known_ats_posting" | "structured_job_card" | "strict_role_page";
    listingUrl?: string;
    detailUrl?: string;
    applicationUrl?: string;
    contactEmail?: string;
    sector?: StrictRolePageSector;
    provider?: string;
    trustedSource?: "manual_review";
    roleEligibilityReview?: unknown;
  };
  companyEvidenceLegacyUntil?: Date | null;
}

/**
 * Review evidence is candidate-policy data, not feed data. Preserve an
 * approved review only when the refresh is provably the same first-party role;
 * never carry it across employers, sources, URLs, titles, or listing IDs.
 */
export function mergeCompanyVacancyEvidence(
  existing: {
    organisationName: string;
    sourceType: string | null;
    externalListingId: string | null;
    url: string | null;
    title: string;
    companyVacancyEvidence: unknown;
  },
  advert: Pick<BoardAdvert, "organisationName" | "sourceType" | "externalId" | "url" | "title" | "companyVacancyEvidence">,
): BoardAdvert["companyVacancyEvidence"] | null | undefined {
  const rawIncoming = advert.companyVacancyEvidence;
  const incoming =
    rawIncoming && typeof rawIncoming === "object"
      ? Object.fromEntries(
          Object.entries(rawIncoming).filter(([key]) => key !== "roleEligibilityReview"),
        )
      : null;
  const sameCompanyRole =
    existing.sourceType === "company_site" &&
    advert.sourceType === "company_site" &&
    existing.organisationName === advert.organisationName &&
    existing.url === advert.url &&
    existing.title === advert.title;
  const sameListingId =
    existing.externalListingId != null &&
    advert.externalId != null &&
    existing.externalListingId === advert.externalId;
  const sameUrlWithoutListingId =
    existing.externalListingId == null &&
    (advert.externalId == null || advert.externalId === "");
  const carriedReview =
    sameCompanyRole &&
    (sameListingId || sameUrlWithoutListingId) &&
    hasApprovedCompanyVacancyRoleEligibilityReview(existing.companyVacancyEvidence)
      ? (existing.companyVacancyEvidence as Record<string, unknown>).roleEligibilityReview
      : null;
  const incomingRecord =
    rawIncoming && typeof rawIncoming === "object"
      ? rawIncoming as Record<string, unknown>
      : null;
  const incomingReview =
    !carriedReview &&
    sameCompanyRole &&
    incomingRecord?.kind === "strict_role_page" &&
    incomingRecord.trustedSource === "manual_review" &&
    hasApprovedCompanyVacancyRoleEligibilityReview(incomingRecord)
      ? incomingRecord.roleEligibilityReview
      : null;
  const review = carriedReview ?? incomingReview;
  if (!review) {
    // Feed refreshes often omit evidence. Keep the prior evidence/grace in
    // that case, matching the historical partial-update behavior.
    return rawIncoming === undefined
      ? undefined
      : incoming as BoardAdvert["companyVacancyEvidence"] | null;
  }
  return {
    ...(incoming && typeof incoming === "object" ? incoming : {}),
    roleEligibilityReview: review,
  } as BoardAdvert["companyVacancyEvidence"];
}

export interface BoardAdapterSearchResult {
  sourceUrl: string;
  adverts: BoardAdvert[];
  requestSucceeded: boolean;
  transientFailure: boolean;
}

export interface BoardAdapter {
  id: string;
  searchByEmployer(organisationName: string): Promise<BoardAdapterSearchResult>;
  reserve(organisationName: string): Promise<NhsProbeReservation>;
  complete(reservation: Extract<NhsProbeReservation, { allowed: true }>): Promise<void>;
  fail(reservation: Extract<NhsProbeReservation, { allowed: true }>): Promise<Date | null>;
}

export interface EmployerBoardDiscoveryResult {
  adverts: BoardAdvert[];
  sourceUrl: string | null;
  transientFailure: boolean;
  retryAt?: Date;
  boardCounts: Record<string, number>;
}

function sourceNameForUrl(url: string, fallback: string): string {
  return classifyVacancySource(url).boardName ?? fallback;
}

export const nhsEmployerBoardAdapter: BoardAdapter = {
  id: "nhs",
  reserve: reserveNhsVacancyProbe,
  complete: completeNhsVacancyProbe,
  fail: failNhsVacancyProbe,
  async searchByEmployer(organisationName) {
    const result = await searchNhsJobs(organisationName);
    return {
      sourceUrl: result.sourceUrl,
      requestSucceeded: result.resultsRequestSucceeded,
      transientFailure: result.transientFailure ?? !result.resultsRequestSucceeded,
      adverts: result.vacancies.map((vacancy) => ({
        organisationName,
        employer: organisationName,
        title: vacancy.title,
        location: vacancy.location,
        salary: vacancy.salary,
        url: vacancy.url,
        description: vacancy.description,
        postedDate: vacancy.postedDate,
        targetRegions: vacancy.targetRegions,
        boardName: sourceNameForUrl(vacancy.url, "NHS Jobs"),
        externalId: classifyVacancySource(vacancy.url).externalListingId,
        contactEmail: vacancy.contactEmail,
        contactEvidenceUrl: vacancy.contactEvidenceUrl,
        closesAt: vacancy.closesAt,
      })),
    };
  },
};

export const reedHtmlBoardAdapter: BoardAdapter = {
  id: "reed_html",
  reserve: reserveReedVacancyProbe,
  complete: completeReedVacancyProbe,
  fail: failReedVacancyProbe,
  async searchByEmployer(organisationName) {
    const result = await searchReedJobs(organisationName);
    return {
      sourceUrl: result.sourceUrl,
      requestSucceeded: result.requestSucceeded,
      transientFailure: result.transientFailure,
      adverts: result.vacancies.map((vacancy) => ({
        organisationName,
        employer: vacancy.employer,
        title: vacancy.title,
        location: vacancy.location,
        salary: vacancy.salary,
        url: vacancy.url,
        description: vacancy.description,
        postedDate: vacancy.postedDate,
        targetRegions: vacancy.targetRegions,
        boardName: vacancy.boardName,
        externalId: vacancy.externalListingId,
        contactEmail: vacancy.contactEmail,
        contactEvidenceUrl: vacancy.contactEvidenceUrl,
        closesAt: vacancy.closesAt,
      })),
    };
  },
};

export const employerBoardAdapters: readonly BoardAdapter[] = [
  nhsEmployerBoardAdapter,
  reedHtmlBoardAdapter,
];

export async function discoverEmployerBoardVacancies(
  organisationName: string,
  adapters: readonly BoardAdapter[] = employerBoardAdapters,
): Promise<EmployerBoardDiscoveryResult> {
  const adverts: BoardAdvert[] = [];
  const boardCounts: Record<string, number> = {};
  let sourceUrl: string | null = null;
  let transientFailure = false;
  let retryAt: Date | undefined;

  for (const adapter of adapters) {
    const reservation = await adapter.reserve(organisationName);
    if (!reservation.allowed) {
      transientFailure = true;
      retryAt ??= reservation.retryAt;
      continue;
    }

    try {
      const result = await adapter.searchByEmployer(organisationName);
      sourceUrl ??= result.sourceUrl;
      boardCounts[adapter.id] = result.adverts.length;
      adverts.push(...result.adverts);
      if (result.transientFailure || !result.requestSucceeded) {
        transientFailure = true;
        retryAt ??= (await adapter.fail(reservation)) ?? undefined;
        if (retryAt) {
          console.warn(
            `[vacancy-check] ${adapter.id} unavailable organisation="${organisationName}" retry_after=${retryAt.toISOString()}`,
          );
        }
      } else {
        await adapter.complete(reservation);
      }
    } catch {
      transientFailure = true;
      retryAt ??= (await adapter.fail(reservation)) ?? undefined;
    }
  }

  return { adverts, sourceUrl, transientFailure, retryAt, boardCounts };
}

function normaliseFingerprintPart(value: string | null): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function boardVacancyFingerprint(advert: Pick<BoardAdvert, "organisationName" | "title" | "location">): string {
  return [
    normaliseFingerprintPart(advert.organisationName),
    normaliseFingerprintPart(advert.title),
    normaliseFingerprintPart(advert.location),
  ].join("|");
}

function boardPreference(boardName: string | null): number {
  return boardName === "NHS Jobs" || boardName === "Trac" || boardName === "HealthJobsUK"
    ? 0
    : boardName === "Reed"
      ? 1
      : 2;
}

function normalizedSourcePart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function boardAdvertSourceId(advert: Pick<
  BoardAdvert,
  "sourceId" | "sourceType" | "organisationName" | "boardName" | "url" | "companyVacancyEvidence"
>): string | null {
  const explicit = advert.sourceId?.trim();
  if (explicit) return explicit.toLowerCase();
  const sourceType = advert.sourceType ?? classifyVacancySource(advert.url).sourceType;
  if (!sourceType) return null;
  if (sourceType === "company_site") {
    const evidence = advert.companyVacancyEvidence;
    const provider = evidence?.provider?.trim().toLowerCase();
    const listingUrl = evidence?.listingUrl
      ? canonicalVacancyUrl(evidence.listingUrl)
      : null;
    const employer = normalizedSourcePart(advert.organisationName);
    if (evidence?.kind === "known_ats_posting" && provider && listingUrl) {
      return `company_site:ats:${employer}:${provider}:${listingUrl}`;
    }
    let host = "";
    try {
      host = new URL(evidence?.listingUrl ?? advert.url).hostname.toLowerCase();
    } catch {
      return null;
    }
    return host ? `company_site:${employer}:${host}` : null;
  }
  const boardName = advert.boardName ?? classifyVacancySource(advert.url).boardName;
  if (boardName?.trim()) return `job_board:${boardName.trim().toLowerCase()}`;
  try {
    return `job_board:${new URL(advert.url).hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

function sourcePreference(advert: Pick<BoardAdvert, "sourceType" | "boardName" | "companyVacancyEvidence">): number {
  if (advert.sourceType === "company_site") {
    return advert.companyVacancyEvidence?.kind === "known_ats_posting" ? -2 : 0;
  }
  return boardPreference(advert.boardName) + 1;
}

function storedAdvertSourceId(row: {
  sourceType: string | null;
  organisationName: string;
  boardName: string | null;
  url: string | null;
  companyVacancyEvidence: unknown;
}): string | null {
  const evidence =
    row.companyVacancyEvidence && typeof row.companyVacancyEvidence === "object"
      ? row.companyVacancyEvidence as BoardAdvert["companyVacancyEvidence"]
      : null;
  return row.url
    ? boardAdvertSourceId({
        sourceType: row.sourceType === "company_site" || row.sourceType === "job_board"
          ? row.sourceType
          : undefined,
        organisationName: row.organisationName,
        boardName: row.boardName,
        url: row.url,
        companyVacancyEvidence: evidence ?? undefined,
      })
    : null;
}

function knownAtsPostingIdentityKey(advert: {
  sourceType?: string | null;
  organisationName: string;
  externalId?: string | null;
  companyVacancyEvidence?: unknown;
}): string | null {
  if (advert.sourceType !== "company_site" || !advert.externalId?.trim()) return null;
  const evidence = advert.companyVacancyEvidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const record = evidence as Record<string, unknown>;
  const provider = typeof record.provider === "string" ? record.provider.trim().toLowerCase() : "";
  const listingUrl = typeof record.listingUrl === "string"
    ? canonicalVacancyUrl(record.listingUrl)
    : null;
  if (record.kind !== "known_ats_posting" || !provider || !listingUrl) return null;
  return [
    normaliseFingerprintPart(advert.organisationName),
    provider,
    listingUrl,
    advert.externalId.trim(),
  ].join("\u0000");
}

export function normaliseAndDedupeBoardAdverts(
  adverts: readonly BoardAdvert[],
  options: { preserveCrossSourceRows?: boolean } = {},
): BoardAdvert[] {
  const normalizedAdverts: BoardAdvert[] = [];
  for (const advert of adverts) {
    if (isManualLabourTitle(advert.title)) continue;
    const url = canonicalVacancyUrl(advert.url);
    const source = classifyVacancySource(url);
    const sourceType = advert.sourceType ?? source.sourceType;
    if (sourceType === "company_site" && isLikelyEditorialTitle(advert.title)) continue;
    if (sourceType === "company_site" && !advert.companyVacancyEvidence) continue;
    if (!url || !sourceType || !isValidVacancyUrlForSource(url, sourceType)) continue;
    const postedDateClose = extractVacancyClosingDate(advert.postedDate);
    const closesAt =
      advert.closesAt ??
      extractVacancyClosingDate(advert.description) ??
      postedDateClose ??
      undefined;
    const normalized = {
      ...advert,
      url,
      // Some legacy company-site extractors placed a labelled closing date in
      // postedDate. Recover only explicitly labelled values and clear that
      // mislabeled posting date. Keep an existing close date when a refresh has
      // no new closing-date evidence.
      closesAt,
      ...(hasVacancyClosingDateLabel(advert.postedDate) ? { postedDate: null } : {}),
      closedReason: advert.closedReason ?? (hasExplicitClosedPhrase(advert.description) ? "source page explicitly closed" : null),
      sourceType,
      boardName: sourceType === "company_site" ? null : source.boardName ?? advert.boardName,
      sourceId:
        boardAdvertSourceId({
          ...advert,
          sourceType,
          boardName: sourceType === "company_site" ? null : source.boardName ?? advert.boardName,
          url,
        }) ?? advert.sourceId,
      // Direct employer-board connectors use the same Company Websites channel,
      // but their platform listing ID remains valuable for repeat-import
      // deduplication. Generic website extraction still has no external ID.
      externalId: advert.externalId ?? source.externalListingId ?? null,
    };
    const sourceId = boardAdvertSourceId(normalized);
    const externalId = normalized.externalId?.trim() ?? "";
    const canonicalUrl = canonicalVacancyUrl(normalized.url);
    const fingerprint = boardVacancyFingerprint(normalized);
    const duplicateIndex = sourceId
      ? normalizedAdverts.findIndex((prior) => {
          const priorSourceId = boardAdvertSourceId(prior);
          if (!priorSourceId) return false;
          const sameSource = priorSourceId === sourceId;
          const priorExternalId = prior.externalId?.trim() ?? "";
          if (
            sameSource &&
            externalId &&
            priorExternalId &&
            externalId !== priorExternalId
          ) {
            return false;
          }
          if (options.preserveCrossSourceRows && !sameSource) return false;
          if (sameSource && externalId && priorExternalId === externalId) return true;
          if (canonicalUrl && canonicalUrl === canonicalVacancyUrl(prior.url)) return true;
          if (fingerprint !== boardVacancyFingerprint(prior)) return false;
          return sameSource || prior.sourceType === normalized.sourceType;
        })
      : -1;
    if (duplicateIndex < 0) {
      normalizedAdverts.push(normalized);
      continue;
    }
    const prior = normalizedAdverts[duplicateIndex]!;
    const sameSource = boardAdvertSourceId(prior) === sourceId;
    if (sameSource || sourcePreference(normalized) < sourcePreference(prior)) {
      normalizedAdverts[duplicateIndex] = normalized;
    }
  }
  return normalizedAdverts;
}

export interface UpsertBoardVacanciesOptions {
  verifiedLive?: boolean;
  organisationName?: string;
  queueVerifications?: boolean;
  requireExisting?: boolean;
  /** Keep exact/canonical/fingerprint matches unchanged instead of merging them. */
  skipExisting?: boolean;
  /** Perform the same locked match check without inserting or updating rows. */
  dryRun?: boolean;
  /** Reviewed imports can opt out of both public-contact fetching and persistence. */
  enrichContacts?: boolean;
  /** Return per-advert outcomes for an explicit import report. */
  includeOutcomes?: boolean;
}

export interface UpsertBoardVacancyOutcome {
  sourceRow: string | null;
  url: string;
  status: "would_insert" | "inserted" | "already_present" | "updated" | "revived";
  matchedBy?: "canonical_url" | "external_id" | "known_ats_identity" | "fingerprint";
}

export interface UpsertBoardVacanciesResult {
  inserted: number;
  updated: number;
  revived: number;
  outcomes?: UpsertBoardVacancyOutcome[];
}

type ContactWriteExecutor = {
  execute(query: unknown): Promise<unknown>;
};

export async function persistScrapedAdvertContacts(
  executor: ContactWriteExecutor,
  adverts: readonly BoardAdvert[],
): Promise<{ upserted: number; skippedExisting: number; rejected: number }> {
  const contactsByOrganisation = new Map<string, BoardAdvert[]>();
  let rejected = 0;
  for (const advert of adverts) {
    const contactEmail = validatePublishedContactEmail(advert.contactEmail);
    if (!contactEmail || !advert.contactEvidenceUrl) {
      if (advert.contactEmail) rejected++;
      continue;
    }
    const key = advert.organisationName.trim().toLowerCase();
    const current = contactsByOrganisation.get(key) ?? [];
    current.push({ ...advert, contactEmail });
    contactsByOrganisation.set(key, current);
  }

  let upserted = 0;
  let skippedExisting = 0;
  for (const candidates of contactsByOrganisation.values()) {
    const selectedEmail = choosePreferredPublishedEmail(
      candidates.flatMap((advert) => advert.contactEmail ? [advert.contactEmail] : []),
    );
    const advert = candidates.find((candidate) => candidate.contactEmail === selectedEmail);
    if (!advert || !selectedEmail) continue;
    const updated = await executor.execute(sql`
      UPDATE sponsor_licences
      SET contact_email = COALESCE(NULLIF(btrim(contact_email), ''), ${selectedEmail})
      WHERE lower(btrim(organisation_name)) = lower(btrim(${advert.organisationName}))
        AND NULLIF(btrim(contact_email), '') IS NULL
      RETURNING id
    `);
    if (((updated as any)?.rows?.length ?? 0) === 0) {
      skippedExisting++;
      continue;
    }
    upserted++;
    await executor.execute(sql`
      INSERT INTO sponsor_licence_contact_enrichments
        (organisation_name, stage, status, attempts, contact_email, contact_source,
         contact_evidence_url, contact_extracted_at, completed_at, updated_at)
      VALUES (${advert.organisationName}, 'contact', 'complete', 0, ${selectedEmail},
        'vacancy_scrape', ${advert.contactEvidenceUrl}, NOW(), NOW(), NOW())
      ON CONFLICT (organisation_name) DO UPDATE SET
        stage = 'contact', status = 'complete', retry_after = NULL,
        contact_email = EXCLUDED.contact_email,
        contact_source = 'vacancy_scrape',
        contact_evidence_url = EXCLUDED.contact_evidence_url,
        contact_extracted_at = NOW(),
        last_error = NULL, completed_at = NOW(), updated_at = NOW()
    `);
  }
  return { upserted, skippedExisting, rejected };
}

export async function upsertSharedBoardVacancies(
  input: readonly BoardAdvert[],
  options: UpsertBoardVacanciesOptions = {},
): Promise<UpsertBoardVacanciesResult> {
  const normalizedAdverts = normaliseAndDedupeBoardAdverts(input, {
    preserveCrossSourceRows: true,
  });
  const adverts = options.enrichContacts === false || options.dryRun
    ? normalizedAdverts
    : await enrichAdvertContacts(normalizedAdverts);
  if (adverts.length === 0) {
    return {
      inserted: 0,
      updated: 0,
      revived: 0,
      ...(options.includeOutcomes ? { outcomes: [] } : {}),
    };
  }

  const transactionResult = await db.transaction(async (tx) => {
  // Deterministically lock only the canonical URLs/fingerprints in this batch.
  // The JSON expansion keeps a 300-result candidate refresh to one lock query
  // while still serializing cross-process writers for the same vacancy.
  const lockKeys = [...new Set(adverts.flatMap((advert) => {
    const sourceId = boardAdvertSourceId(advert);
    return [
      `url:${canonicalVacancyUrl(advert.url) ?? advert.url}`,
      `fingerprint:${boardVacancyFingerprint(advert)}`,
      ...(advert.externalId && sourceId
        ? [`external:${sourceId}|${advert.externalId}`]
        : []),
    ];
  }))].sort();
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext(value))
    FROM jsonb_array_elements_text(${JSON.stringify(lockKeys)}::jsonb) AS value
    ORDER BY value
  `);
  const organisations = [...new Set(adverts.map((advert) => advert.organisationName))];
  const urls = adverts.map((advert) => advert.url);
  const urlBases = adverts.map((advert) =>
    advert.url.split(/[?#]/, 1)[0]!.toLowerCase().replace(/\/+$/, ""),
  );
  const fingerprints = adverts.map(boardVacancyFingerprint);
  const storedFingerprint = sql<string>`
    btrim(regexp_replace(lower(trim(coalesce(${sponsorLicenceVacanciesTable.organisationName}, ''))), '[^a-z0-9]+', ' ', 'g'))
    || '|' ||
    btrim(regexp_replace(lower(trim(coalesce(${sponsorLicenceVacanciesTable.title}, ''))), '[^a-z0-9]+', ' ', 'g'))
    || '|' ||
    btrim(regexp_replace(lower(trim(coalesce(${sponsorLicenceVacanciesTable.location}, ''))), '[^a-z0-9]+', ' ', 'g'))
  `;
  const storedUrlBase = sql<string>`
    regexp_replace(
      split_part(split_part(lower(coalesce(${sponsorLicenceVacanciesTable.url}, '')), '#', 1), '?', 1),
      '/+$',
      ''
    )
  `;
  let existing = await tx
    .select()
    .from(sponsorLicenceVacanciesTable)
    .where(
      or(
        inArray(sponsorLicenceVacanciesTable.organisationName, organisations),
        inArray(sponsorLicenceVacanciesTable.url, urls),
        inArray(storedUrlBase, urlBases),
        inArray(storedFingerprint, fingerprints),
      ),
    );

  const incomingSourcePairs = adverts.flatMap((advert) => {
    const sourceId = boardAdvertSourceId(advert);
    return sourceId && advert.externalId
      ? [{ sourceId, externalId: advert.externalId }]
      : [];
  });
  const incomingSourceIds = [...new Set(incomingSourcePairs.map((pair) => pair.sourceId))];
  const incomingExternalIds = [...new Set(incomingSourcePairs.map((pair) => pair.externalId))];
  const incomingPairKeys = new Set(
    incomingSourcePairs.map((pair) => `${pair.sourceId}\u0000${pair.externalId}`),
  );
  const exactObservations = incomingSourceIds.length && incomingExternalIds.length
    ? (await tx
        .select()
        .from(vacancySourceObservationsTable)
        .where(and(
          inArray(vacancySourceObservationsTable.sourceId, incomingSourceIds),
          inArray(vacancySourceObservationsTable.externalId, incomingExternalIds),
        )))
        .filter((observation) =>
          incomingPairKeys.has(`${observation.sourceId}\u0000${observation.externalId}`),
        )
    : [];
  const exactObservationVacancyIds = [...new Set(exactObservations.map((observation) => observation.vacancyId))];
  const existingIds = new Set(existing.map((row) => row.id));
  const missingExactRows = exactObservationVacancyIds.filter((id) => !existingIds.has(id));
  if (missingExactRows.length > 0) {
    const exactRows = await tx
      .select()
      .from(sponsorLicenceVacanciesTable)
      .where(inArray(sponsorLicenceVacanciesTable.id, missingExactRows));
    existing = [...existing, ...exactRows];
  }
  const candidateVacancyIds = [...new Set([
    ...existing.map((row) => row.id),
    ...exactObservationVacancyIds,
  ])];
  const sourceObservations = candidateVacancyIds.length > 0
    ? await tx
        .select()
        .from(vacancySourceObservationsTable)
        .where(inArray(vacancySourceObservationsTable.vacancyId, candidateVacancyIds))
    : [];
  const rowsById = new Map(existing.map((row) => [row.id, row] as const));
  const sourceIdsByVacancy = new Map<number, Set<string>>();
  const addSourceForVacancy = (vacancyId: number, sourceId: string | null): void => {
    if (!sourceId) return;
    const sourceIds = sourceIdsByVacancy.get(vacancyId) ?? new Set<string>();
    sourceIds.add(sourceId);
    sourceIdsByVacancy.set(vacancyId, sourceIds);
  };
  for (const row of existing) addSourceForVacancy(row.id, storedAdvertSourceId(row));
  for (const observation of sourceObservations) {
    addSourceForVacancy(observation.vacancyId, observation.sourceId);
  }

  const byCanonical = new Map<string, (typeof existing)[number][]>();
  const byFingerprint = new Map<string, (typeof existing)[number][]>();
  const byKnownAtsIdentity = new Map<string, (typeof existing)[number]>();
  const byExternal = new Map<string, (typeof existing)[number]>();
  const addCandidate = (
    map: Map<string, (typeof existing)[number][]>,
    key: string | null,
    row: (typeof existing)[number],
  ): void => {
    if (!key) return;
    const rows = map.get(key) ?? [];
    if (!rows.some((candidate) => candidate.id === row.id)) rows.push(row);
    map.set(key, rows);
  };
  for (const row of existing) {
    const canonical = row.url ? canonicalVacancyUrl(row.url) : null;
    addCandidate(byCanonical, canonical, row);
    addCandidate(byFingerprint, boardVacancyFingerprint({
        organisationName: row.organisationName,
        title: row.title,
        location: row.location,
      }), row);
    const sourceId = storedAdvertSourceId(row);
    if (sourceId && row.externalListingId) {
      byExternal.set(`${sourceId}\u0000${row.externalListingId}`, row);
    }
    const directAtsIdentity = knownAtsPostingIdentityKey({
      sourceType: row.sourceType,
      organisationName: row.organisationName,
      externalId: row.externalListingId,
      companyVacancyEvidence: row.companyVacancyEvidence,
    });
    if (directAtsIdentity) byKnownAtsIdentity.set(directAtsIdentity, row);
  }
  for (const observation of sourceObservations) {
    const row = rowsById.get(observation.vacancyId);
    if (row) byExternal.set(`${observation.sourceId}\u0000${observation.externalId}`, row);
  }
  const now = new Date();
  const checkDate = now.toISOString().slice(0, 10);
  const toVerify: Array<{
    source: "sponsor_vacancy";
    sourceType: "job_board" | "company_site";
    id: number;
    url: string | null;
    applicationUrl: string | null;
  }> = [];
  let inserted = 0;
  let revived = 0;
  let updatedCount = 0;
  const outcomes: UpsertBoardVacancyOutcome[] = [];

  const addSourceObservation = async (
    vacancyId: number,
    advert: BoardAdvert,
    clearVacancyMissingState = true,
  ): Promise<void> => {
    const sourceId = boardAdvertSourceId(advert);
    const externalId = advert.externalId?.trim();
    const canonicalUrl = canonicalVacancyUrl(advert.url);
    if (!sourceId || !externalId || !canonicalUrl) return;
    const provider =
      typeof advert.sourceMetadata?.["provider"] === "string"
        ? advert.sourceMetadata["provider"] as string
        : sourceId;
    const parserVersion =
      typeof advert.sourceMetadata?.["parserVersion"] === "string"
        ? advert.sourceMetadata["parserVersion"] as string
        : "pipeline";
    const observation = {
      vacancyId,
      sourceId,
      provider,
      sourceType: advert.sourceType ?? "job_board",
      boardName: advert.boardName ?? "Company Website",
      externalId,
      url: advert.url,
      canonicalUrl,
      applicationUrl: advert.applicationUrl ?? null,
      sourceMetadata: advert.sourceMetadata ?? null,
      parserVersion,
      lastSeenAt: now,
      missingSince: null,
    };
    await tx
      .insert(vacancySourceObservationsTable)
      .values(observation)
      .onConflictDoUpdate({
        target: [
          vacancySourceObservationsTable.sourceId,
          vacancySourceObservationsTable.externalId,
        ],
        set: {
          vacancyId,
          provider,
          sourceType: observation.sourceType,
          boardName: observation.boardName,
          url: advert.url,
          canonicalUrl,
          applicationUrl: observation.applicationUrl,
          sourceMetadata: observation.sourceMetadata,
          parserVersion,
          lastSeenAt: now,
          missingSince: null,
        },
      });
    if (clearVacancyMissingState) {
      await tx
        .update(sponsorLicenceVacanciesTable)
        .set({ sourceMissingSince: null, sourceMissingObservations: 0 })
        .where(eq(sponsorLicenceVacanciesTable.id, vacancyId));
    }
    addSourceForVacancy(vacancyId, sourceId);
    byExternal.set(`${sourceId}\u0000${externalId}`, rowsById.get(vacancyId)!);
  };

  const registerRow = (row: (typeof existing)[number]): void => {
    rowsById.set(row.id, row);
    addCandidate(byCanonical, row.url ? canonicalVacancyUrl(row.url) : null, row);
    addCandidate(byFingerprint, boardVacancyFingerprint(row), row);
    addSourceForVacancy(row.id, storedAdvertSourceId(row));
  };

  for (const advert of adverts) {
    const sourceType = advert.sourceType ?? "job_board";
    const sourceId = boardAdvertSourceId(advert);
    const fingerprint = boardVacancyFingerprint(advert);
    const directAtsIdentity = knownAtsPostingIdentityKey(advert);
    const sourceHasSeen = (row: (typeof existing)[number]): boolean =>
      !!sourceId && sourceIdsByVacancy.get(row.id)?.has(sourceId) === true;
    const crossSourceCandidate = (
      candidates: (typeof existing)[number][] | undefined,
    ): (typeof existing)[number] | undefined =>
      candidates?.find((row) => storedAdvertSourceId(row) != null && !sourceHasSeen(row));
    const canonicalMatch = sourceId
      ? crossSourceCandidate(byCanonical.get(canonicalVacancyUrl(advert.url) ?? advert.url))
      : undefined;
    const externalMatch = advert.externalId && sourceId
      ? byExternal.get(`${sourceId}\u0000${advert.externalId}`)
      : undefined;
    const knownAtsMatch = directAtsIdentity ? byKnownAtsIdentity.get(directAtsIdentity) : undefined;
    const fingerprintMatch = sourceId
      ? crossSourceCandidate(byFingerprint.get(fingerprint))
      : undefined;
    const existingRow = externalMatch ?? knownAtsMatch ?? canonicalMatch ?? fingerprintMatch;
    const matchedBy = externalMatch
      ? "external_id"
      : knownAtsMatch
        ? "known_ats_identity"
        : canonicalMatch
          ? "canonical_url"
          : fingerprintMatch
            ? "fingerprint"
            : undefined;
    if (existingRow) {
      if (options.skipExisting) {
        outcomes.push({
          sourceRow: advert.reviewedSourceRow ?? null,
          url: advert.url,
          status: "already_present",
          ...(matchedBy ? { matchedBy } : {}),
        });
        continue;
      }
      const existingSourcePreference = sourcePreference({
        sourceType: existingRow.sourceType === "company_site" ? "company_site" : "job_board",
        boardName: existingRow.boardName,
        companyVacancyEvidence: existingRow.companyVacancyEvidence as BoardAdvert["companyVacancyEvidence"],
      });
      const incomingWins =
        sourceHasSeen(existingRow) ||
        knownAtsMatch != null ||
        sourcePreference(advert) < existingSourcePreference;
      if (!incomingWins) {
        await addSourceObservation(existingRow.id, advert);
        outcomes.push({
          sourceRow: advert.reviewedSourceRow ?? null,
          url: advert.url,
          status: "already_present",
          ...(matchedBy ? { matchedBy } : {}),
        });
        continue;
      }
      if (options.dryRun) {
        outcomes.push({
          sourceRow: advert.reviewedSourceRow ?? null,
          url: advert.url,
          status: "already_present",
          ...(matchedBy ? { matchedBy } : {}),
        });
        continue;
      }
      const wasDead = existingRow.liveness === "dead";
      const mergedCompanyVacancyEvidence = mergeCompanyVacancyEvidence(existingRow, advert);
      const [updated] = await tx
        .update(sponsorLicenceVacanciesTable)
        .set({
          organisationName: advert.organisationName,
          checkDate,
          title: advert.title,
          location: advert.location,
          salary: advert.salary,
          url: advert.url,
           applicationUrl: advert.applicationUrl ?? existingRow.applicationUrl ?? null,
          description: advert.description,
          postedDate: advert.postedDate,
          sourceMetadata: advert.sourceMetadata ?? existingRow.sourceMetadata ?? null,
          targetRegions: advert.targetRegions ?? [],
          sourceType,
          boardName: sourceType === "company_site" ? null : advert.boardName,
          externalListingId: advert.externalId,
           ...(advert.closesAt !== undefined ? { closesAt: advert.closesAt } : {}),
           ...(advert.expiresAt !== undefined ? { expiresAt: advert.expiresAt } : {}),
           ...(advert.closedReason !== undefined ? { closedReason: advert.closedReason } : {}),
           ...(mergedCompanyVacancyEvidence !== undefined
             ? {
                 companyVacancyEvidence: mergedCompanyVacancyEvidence,
                 companyEvidenceLegacyUntil: advert.companyEvidenceLegacyUntil !== undefined
                   ? advert.companyEvidenceLegacyUntil
                   : null,
               }
             : {}),
          lastDiscoveredAt: now,
           sourceMissingSince: null,
           sourceMissingObservations: 0,
          ...(options.verifiedLive
            ? { liveness: "live" as const, lastVerifiedAt: now, livenessReason: null }
            : {}),
        })
        .where(eq(sponsorLicenceVacanciesTable.id, existingRow.id))
        .returning({
          id: sponsorLicenceVacanciesTable.id,
          url: sponsorLicenceVacanciesTable.url,
          applicationUrl: sponsorLicenceVacanciesTable.applicationUrl,
          liveness: sponsorLicenceVacanciesTable.liveness,
        });
      if (options.verifiedLive && wasDead) revived += 1;
      if (updated) updatedCount += 1;
      if (updated) {
        outcomes.push({
          sourceRow: advert.reviewedSourceRow ?? null,
          url: advert.url,
          status: options.verifiedLive && wasDead ? "revived" : "updated",
          ...(matchedBy ? { matchedBy } : {}),
        });
      }
      if (updated && updated.liveness === "unverified") {
        toVerify.push({ source: "sponsor_vacancy", sourceType, ...updated });
      }
      const updatedRow = {
        ...existingRow,
        ...advert,
        id: existingRow.id,
        sourceType,
        boardName: sourceType === "company_site" ? null : advert.boardName,
        externalListingId: advert.externalId,
        url: advert.url,
        applicationUrl: advert.applicationUrl ?? existingRow.applicationUrl ?? null,
        sourceMetadata: advert.sourceMetadata ?? existingRow.sourceMetadata ?? null,
        companyVacancyEvidence: mergedCompanyVacancyEvidence !== undefined
          ? mergedCompanyVacancyEvidence
          : existingRow.companyVacancyEvidence,
        companyEvidenceLegacyUntil: mergedCompanyVacancyEvidence !== undefined
          ? null
          : existingRow.companyEvidenceLegacyUntil,
        liveness: updated?.liveness ?? existingRow.liveness,
      } as unknown as (typeof existing)[number];
      registerRow(updatedRow);
      await addSourceObservation(existingRow.id, advert);
      if (directAtsIdentity) {
        byKnownAtsIdentity.set(directAtsIdentity, updatedRow);
      }
      continue;
    }

    if (options.requireExisting) {
      throw new Error(
        `Repeat-run guard stopped before insert: no existing vacancy matched ${advert.url}.`,
      );
    }

    if (options.dryRun) {
      outcomes.push({
        sourceRow: advert.reviewedSourceRow ?? null,
        url: advert.url,
        status: "would_insert",
      });
      continue;
    }

    const [created] = await tx
      .insert(sponsorLicenceVacanciesTable)
      .values([{
        organisationName: advert.organisationName,
        checkDate,
        title: advert.title,
        location: advert.location,
        salary: advert.salary,
        url: advert.url,
         applicationUrl: advert.applicationUrl ?? null,
        description: advert.description,
        postedDate: advert.postedDate,
        targetRegions: advert.targetRegions ?? [],
        sourceType,
        boardName: sourceType === "company_site" ? null : advert.boardName,
        externalListingId: advert.externalId,
         sourceMetadata: advert.sourceMetadata ?? null,
         closesAt: advert.closesAt ?? null,
         expiresAt: advert.expiresAt ?? null,
         closedReason: advert.closedReason ?? null,
         companyVacancyEvidence: advert.companyVacancyEvidence ?? null,
         companyEvidenceLegacyUntil: advert.companyEvidenceLegacyUntil ?? null,
        liveness: options.verifiedLive ? "live" : "unverified",
        lastVerifiedAt: options.verifiedLive ? now : null,
        livenessReason: null,
        lastDiscoveredAt: now,
         sourceMissingSince: null,
         sourceMissingObservations: 0,
      }])
      .returning({
        id: sponsorLicenceVacanciesTable.id,
        url: sponsorLicenceVacanciesTable.url,
        applicationUrl: sponsorLicenceVacanciesTable.applicationUrl,
        liveness: sponsorLicenceVacanciesTable.liveness,
      });
    if (created) {
      inserted += 1;
      const createdRow = {
        ...advert,
        id: created.id,
        sourceType,
        boardName: sourceType === "company_site" ? null : advert.boardName,
        externalListingId: advert.externalId,
        url: advert.url,
        applicationUrl: advert.applicationUrl ?? null,
        sourceMetadata: advert.sourceMetadata ?? null,
        liveness: created.liveness,
        companyVacancyEvidence: advert.companyVacancyEvidence ?? null,
      } as unknown as (typeof existing)[number];
      registerRow(createdRow);
      await addSourceObservation(created.id, advert, false);
      outcomes.push({
        sourceRow: advert.reviewedSourceRow ?? null,
        url: advert.url,
        status: "inserted",
      });
      if (created.liveness === "unverified") {
        toVerify.push({ source: "sponsor_vacancy", sourceType, ...created });
      }
    }
  }

  if (options.enrichContacts !== false && !options.dryRun) {
    await persistScrapedAdvertContacts(tx as ContactWriteExecutor, adverts);
  }

  return { inserted, updated: updatedCount, revived, toVerify, outcomes };
  });
  // Do not let a separate verifier race rows that are not committed yet.
  const companySiteItems = transactionResult.toVerify
    .filter((item) => item.sourceType === "company_site")
    .map(({ id, url, applicationUrl }) => ({ id, url: applicationUrl ?? url }));
  const boardItems = transactionResult.toVerify
    .filter((item) => item.sourceType === "job_board")
    .map(({ source, id, url }) => ({ source, id, url }));
  if (options.queueVerifications !== false) {
    queueCompanySiteVerificationBatch(companySiteItems);
    queueLinkVerificationBatch(boardItems);
  }
  return {
    inserted: transactionResult.inserted,
    updated: transactionResult.updated,
    revived: transactionResult.revived,
    ...(options.includeOutcomes ? { outcomes: transactionResult.outcomes } : {}),
  };
}