import { db, sponsorLicenceVacanciesTable } from "@workspace/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { isManualLabourTitle } from "./vacancyTitlePolicy";
import { canonicalVacancyUrl, classifyVacancySource } from "./vacancySource";
import { queueLinkVerificationBatch } from "./linkVerification";
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

export interface BoardAdvert {
  organisationName: string;
  title: string;
  employer: string;
  location: string | null;
  salary: string | null;
  url: string;
  description: string | null;
  postedDate: string | null;
  targetRegions: string[] | null;
  boardName: string;
  externalId: string | null;
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

export function normaliseAndDedupeBoardAdverts(adverts: readonly BoardAdvert[]): BoardAdvert[] {
  const byUrl = new Map<string, BoardAdvert>();
  for (const advert of adverts) {
    if (isManualLabourTitle(advert.title)) continue;
    const url = canonicalVacancyUrl(advert.url);
    const source = classifyVacancySource(url);
    if (!url || source.sourceType !== "job_board") continue;
    const normalized = {
      ...advert,
      url,
      boardName: source.boardName ?? advert.boardName,
      externalId: source.externalListingId ?? advert.externalId,
    };
    const current = byUrl.get(url);
    if (!current || boardPreference(normalized.boardName) < boardPreference(current.boardName)) {
      byUrl.set(url, normalized);
    }
  }

  const byFingerprint = new Map<string, BoardAdvert>();
  for (const advert of byUrl.values()) {
    const fingerprint = boardVacancyFingerprint(advert);
    const current = byFingerprint.get(fingerprint);
    if (!current || boardPreference(advert.boardName) < boardPreference(current.boardName)) {
      byFingerprint.set(fingerprint, advert);
    }
  }
  return [...byFingerprint.values()];
}

export interface UpsertBoardVacanciesOptions {
  verifiedLive?: boolean;
  organisationName?: string;
}

export async function upsertSharedBoardVacancies(
  input: readonly BoardAdvert[],
  options: UpsertBoardVacanciesOptions = {},
): Promise<{ inserted: number; revived: number }> {
  const adverts = normaliseAndDedupeBoardAdverts(input);
  if (adverts.length === 0) return { inserted: 0, revived: 0 };

  const transactionResult = await db.transaction(async (tx) => {
  // Deterministically lock only the canonical URLs/fingerprints in this batch.
  // The JSON expansion keeps a 300-result candidate refresh to one lock query
  // while still serializing cross-process writers for the same vacancy.
  const lockKeys = [...new Set(adverts.flatMap((advert) => [
    `url:${advert.url}`,
    `fingerprint:${boardVacancyFingerprint(advert)}`,
    ...(advert.externalId ? [`external:${advert.boardName}|${advert.externalId}`] : []),
  ]))].sort();
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
  const externalKeys = adverts
    .filter((advert) => advert.externalId)
    .map((advert) => `${advert.boardName}|${advert.externalId}`);
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
  const storedExternalKey = sql<string>`
    coalesce(${sponsorLicenceVacanciesTable.boardName}, '')
    || '|' ||
    coalesce(${sponsorLicenceVacanciesTable.externalListingId}, '')
  `;
  const existing = await tx
    .select()
    .from(sponsorLicenceVacanciesTable)
    .where(
      and(
        eq(sponsorLicenceVacanciesTable.sourceType, "job_board"),
        or(
          inArray(sponsorLicenceVacanciesTable.organisationName, organisations),
          inArray(sponsorLicenceVacanciesTable.url, urls),
          inArray(storedUrlBase, urlBases),
          inArray(storedFingerprint, fingerprints),
          ...(externalKeys.length > 0 ? [inArray(storedExternalKey, externalKeys)] : []),
        ),
      ),
    );
  const byCanonical = new Map(
    existing.flatMap((row) => {
      const canonical = row.url ? canonicalVacancyUrl(row.url) : null;
      return canonical ? [[canonical, row] as const] : [];
    }),
  );
  const byFingerprint = new Map(
    existing.map((row) => [
      boardVacancyFingerprint({
        organisationName: row.organisationName,
        title: row.title,
        location: row.location,
      }),
      row,
    ] as const),
  );
  const byExternal = new Map(
    existing.flatMap((row) =>
      row.boardName && row.externalListingId
        ? [[`${row.boardName}|${row.externalListingId}`, row] as const]
        : [],
    ),
  );
  const now = new Date();
  const checkDate = now.toISOString().slice(0, 10);
  const toVerify: Array<{ source: "sponsor_vacancy"; id: number; url: string | null }> = [];
  let inserted = 0;
  let revived = 0;

  for (const advert of adverts) {
    const fingerprint = boardVacancyFingerprint(advert);
    const canonicalMatch = byCanonical.get(advert.url);
    const externalMatch = advert.externalId
      ? byExternal.get(`${advert.boardName}|${advert.externalId}`)
      : undefined;
    const fingerprintMatch = byFingerprint.get(fingerprint);
    const existingRow = canonicalMatch ?? externalMatch ?? fingerprintMatch;
    if (existingRow) {
      const incomingWins =
        canonicalMatch != null ||
        externalMatch != null ||
        boardPreference(advert.boardName) < boardPreference(existingRow.boardName);
      if (!incomingWins) continue;
      const wasDead = existingRow.liveness === "dead";
      const [updated] = await tx
        .update(sponsorLicenceVacanciesTable)
        .set({
          organisationName: advert.organisationName,
          checkDate,
          title: advert.title,
          location: advert.location,
          salary: advert.salary,
          url: advert.url,
          description: advert.description,
          postedDate: advert.postedDate,
          targetRegions: advert.targetRegions ?? [],
          sourceType: "job_board",
          boardName: advert.boardName,
          externalListingId: advert.externalId,
          lastDiscoveredAt: now,
          ...(options.verifiedLive
            ? { liveness: "live" as const, lastVerifiedAt: now, livenessReason: null }
            : {}),
        })
        .where(eq(sponsorLicenceVacanciesTable.id, existingRow.id))
        .returning({
          id: sponsorLicenceVacanciesTable.id,
          url: sponsorLicenceVacanciesTable.url,
          liveness: sponsorLicenceVacanciesTable.liveness,
        });
      if (options.verifiedLive && wasDead) revived += 1;
      if (updated && updated.liveness === "unverified") toVerify.push({ source: "sponsor_vacancy", ...updated });
      byCanonical.set(advert.url, { ...existingRow, ...advert, url: advert.url } as typeof existingRow);
      if (advert.externalId) {
        byExternal.set(`${advert.boardName}|${advert.externalId}`, existingRow);
      }
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
        description: advert.description,
        postedDate: advert.postedDate,
        targetRegions: advert.targetRegions ?? [],
        sourceType: "job_board",
        boardName: advert.boardName,
        externalListingId: advert.externalId,
        liveness: options.verifiedLive ? "live" : "unverified",
        lastVerifiedAt: options.verifiedLive ? now : null,
        livenessReason: null,
        lastDiscoveredAt: now,
      }])
      .returning({
        id: sponsorLicenceVacanciesTable.id,
        url: sponsorLicenceVacanciesTable.url,
        liveness: sponsorLicenceVacanciesTable.liveness,
      });
    if (created) {
      inserted += 1;
      if (created.liveness === "unverified") toVerify.push({ source: "sponsor_vacancy", ...created });
    }
  }

  return { inserted, revived, toVerify };
  });
  // Do not let a separate verifier race rows that are not committed yet.
  queueLinkVerificationBatch(transactionResult.toVerify);
  return { inserted: transactionResult.inserted, revived: transactionResult.revived };
}