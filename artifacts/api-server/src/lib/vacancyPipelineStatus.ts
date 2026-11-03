import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** A source that has not completed a sweep for this long needs attention. */
export const SOURCE_STALE_AFTER_HOURS = 24;

export type VacancyPipelineStatus = {
  generatedAt: string;
  totals: {
    vacancies: number;
    jobBoard: number;
    companySite: number;
    live: number;
    unverified: number;
    dead: number;
    insertedLast24h: number;
    verifiedLast24h: number;
    repeatedListings: number;
  };
  sendCv: { sponsorsWithPublishedEmail: number; sponsorsWithWebsite: number };
  sectors: { sector: string; jobBoard: number; companySite: number }[];
  sources: {
    sourceId: string;
    lastOutcome: string | null;
    lastSuccessAt: string | null;
    lastRunAt: string | null;
    consecutiveFailures: number;
    lastError: string | null;
    stale: boolean;
  }[];
  alerts: string[];
};

const iso = (value: unknown): string | null =>
  value == null ? null : new Date(value as string).toISOString();

export async function getVacancyPipelineStatus(now = new Date()): Promise<VacancyPipelineStatus> {
  const [totalsResult, sendCvResult, sectorsResult, sourcesResult] = await Promise.all([
    db.execute<Record<string, number>>(sql`
      SELECT
        count(*)::int AS vacancies,
        count(*) FILTER (WHERE source_type = 'job_board')::int AS job_board,
        count(*) FILTER (WHERE source_type = 'company_site')::int AS company_site,
        count(*) FILTER (WHERE liveness = 'live')::int AS live,
        count(*) FILTER (WHERE liveness = 'unverified')::int AS unverified,
        count(*) FILTER (WHERE liveness = 'dead')::int AS dead,
        count(*) FILTER (WHERE created_at > ${now}::timestamptz - interval '24 hours')::int AS inserted_24h,
        count(*) FILTER (WHERE last_verified_at > ${now}::timestamptz - interval '24 hours')::int AS verified_24h,
        (count(*) - count(DISTINCT (coalesce(board_name, source_type), lower(btrim(organisation_name)),
          lower(btrim(title)), lower(btrim(coalesce(location, ''))))))::int AS repeated
      FROM sponsor_licence_vacancies
    `),
    db.execute<Record<string, number>>(sql`
      SELECT
        count(DISTINCT lower(btrim(organisation_name))) FILTER (WHERE NULLIF(btrim(contact_email), '') IS NOT NULL)::int AS emails,
        count(DISTINCT lower(btrim(organisation_name))) FILTER (WHERE NULLIF(btrim(website), '') IS NOT NULL)::int AS websites
      FROM sponsor_licences
    `),
    // One industry per employer so multi-licence sponsors are not counted twice.
    db.execute<{ sector: string; job_board: number; company_site: number }>(sql`
      WITH industry AS (
        SELECT lower(btrim(organisation_name)) AS org, min(btrim(industry)) AS sector
        FROM sponsor_licences WHERE NULLIF(btrim(industry), '') IS NOT NULL
        GROUP BY 1
      )
      SELECT coalesce(i.sector, '(unlabeled)') AS sector,
        count(*) FILTER (WHERE v.source_type = 'job_board')::int AS job_board,
        count(*) FILTER (WHERE v.source_type = 'company_site')::int AS company_site
      FROM sponsor_licence_vacancies v
      LEFT JOIN industry i ON i.org = lower(btrim(v.organisation_name))
      GROUP BY 1 ORDER BY count(*) DESC
    `),
    db.execute<Record<string, unknown>>(sql`
      SELECT source_id, last_outcome, last_success_at, last_run_at, consecutive_failures, last_error
      FROM vacancy_source_states ORDER BY source_id
    `),
  ]);

  const t = totalsResult.rows[0] ?? {};
  const staleBefore = now.getTime() - SOURCE_STALE_AFTER_HOURS * 3_600_000;
  const sources = sourcesResult.rows.map((row) => {
    const lastSuccessAt = iso(row.last_success_at);
    return {
      sourceId: String(row.source_id),
      lastOutcome: (row.last_outcome as string | null) ?? null,
      lastSuccessAt,
      lastRunAt: iso(row.last_run_at),
      consecutiveFailures: Number(row.consecutive_failures ?? 0),
      lastError: (row.last_error as string | null) ?? null,
      stale: !lastSuccessAt || new Date(lastSuccessAt).getTime() < staleBefore,
    };
  });

  const totals = {
    vacancies: Number(t.vacancies ?? 0),
    jobBoard: Number(t.job_board ?? 0),
    companySite: Number(t.company_site ?? 0),
    live: Number(t.live ?? 0),
    unverified: Number(t.unverified ?? 0),
    dead: Number(t.dead ?? 0),
    insertedLast24h: Number(t.inserted_24h ?? 0),
    verifiedLast24h: Number(t.verified_24h ?? 0),
    repeatedListings: Number(t.repeated ?? 0),
  };

  const alerts: string[] = [];
  for (const source of sources) {
    if (source.stale) alerts.push(`source ${source.sourceId} has no successful sweep in ${SOURCE_STALE_AFTER_HOURS}h`);
    if (source.consecutiveFailures >= 3) {
      alerts.push(`source ${source.sourceId} failed ${source.consecutiveFailures} times in a row: ${source.lastError ?? "unknown error"}`);
    }
  }
  if (totals.vacancies > 0 && totals.verifiedLast24h === 0) alerts.push("no vacancy liveness checks in 24h");
  if (totals.vacancies > 0 && totals.unverified / totals.vacancies > 0.25) {
    alerts.push(`${totals.unverified} vacancies (${Math.round((100 * totals.unverified) / totals.vacancies)}%) never liveness-checked`);
  }
  if (totals.repeatedListings > 0) alerts.push(`${totals.repeatedListings} repeated listings stored`);

  return {
    generatedAt: now.toISOString(),
    totals,
    sendCv: {
      sponsorsWithPublishedEmail: Number(sendCvResult.rows[0]?.emails ?? 0),
      sponsorsWithWebsite: Number(sendCvResult.rows[0]?.websites ?? 0),
    },
    sectors: sectorsResult.rows.map((row) => ({
      sector: row.sector,
      jobBoard: Number(row.job_board),
      companySite: Number(row.company_site),
    })),
    sources,
    alerts,
  };
}
