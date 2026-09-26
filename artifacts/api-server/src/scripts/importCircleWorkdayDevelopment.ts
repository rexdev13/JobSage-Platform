import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { fetchDirectEmployerBoard } from "../lib/directEmployerBoardConnectors";
import { isStandaloneManagerTitle } from "../lib/vacancyLiveness";
import { isManualLabourTitle } from "../lib/vacancyTitlePolicy";
import {
  normaliseAndDedupeBoardAdverts,
  upsertSharedBoardVacancies,
} from "../lib/boardVacancyPipeline";

const TARGET = {
  organisationName: "BMI Healthcare Limited trading as Circle Health Group Limited",
  provider: "Workday",
  boardId: "chgcareers",
  careersUrl: "https://circlehealth.wd103.myworkdayjobs.com/chgcareers",
  evidenceUrl: "http://careers.circlehealthgroup.co.uk/jobs/sister-charge-nurse-critical-care-jr110643",
  feedUrl: "https://circlehealth.wd103.myworkdayjobs.com/wday/cxs/circlehealth/chgcareers/jobs",
} as const;

const FEED_DEADLINE_MS = 5 * 60_000;
const VERIFICATION_WAIT_MS = 25 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertVerifiedDevelopmentMapping(): Promise<void> {
  const result = await db.execute<{
    careers_url: string | null;
    ats_provider: string | null;
    ats_board_id: string | null;
    ats_mapping_status: string;
    ats_mapping_evidence_url: string | null;
  }>(sql`
    SELECT careers_url, ats_provider, ats_board_id, ats_mapping_status, ats_mapping_evidence_url
    FROM sponsor_licence_company_site_checks
    WHERE lower(btrim(organisation_name)) = lower(btrim(${TARGET.organisationName}))
    LIMIT 2
  `);

  const [saved] = result.rows;
  if (
    result.rows.length !== 1 ||
    saved?.ats_mapping_status !== "verified" ||
    saved.ats_provider?.toLowerCase() !== TARGET.provider.toLowerCase() ||
    saved.ats_board_id !== TARGET.boardId ||
    saved.careers_url !== TARGET.careersUrl ||
    saved.ats_mapping_evidence_url !== TARGET.evidenceUrl
  ) {
    throw new Error("Development database does not contain the exact verified Circle Workday mapping.");
  }
}

async function waitForVerification(deadlineMs: number): Promise<number> {
  let lastReportAt = 0;

  while (Date.now() < deadlineMs) {
    const result = await db.execute<{ pending_count: number }>(sql`
      SELECT count(*)::int AS pending_count
      FROM sponsor_licence_vacancies
      WHERE lower(btrim(organisation_name)) = lower(btrim(${TARGET.organisationName}))
        AND source_type = 'company_site'
        AND company_vacancy_evidence->>'provider' = ${TARGET.provider}
        AND last_verified_at IS NULL
    `);
    const pending = result.rows[0]?.pending_count ?? 0;
    if (pending === 0) return 0;

    if (lastReportAt === 0 || Date.now() - lastReportAt >= 30_000) {
      process.stdout.write(`Waiting for exact Workday listing checks: ${pending} pending\n`);
      lastReportAt = Date.now();
    }
    await sleep(5_000);
  }

  const result = await db.execute<{ pending_count: number }>(sql`
    SELECT count(*)::int AS pending_count
    FROM sponsor_licence_vacancies
    WHERE lower(btrim(organisation_name)) = lower(btrim(${TARGET.organisationName}))
      AND source_type = 'company_site'
      AND company_vacancy_evidence->>'provider' = ${TARGET.provider}
      AND last_verified_at IS NULL
  `);
  return result.rows[0]?.pending_count ?? 0;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("This importer is development-only; NODE_ENV must be development.");
  }
  if (!process.argv.includes("--apply-dev")) {
    throw new Error("No rows were changed. Pass --apply-dev to import the verified Circle feed into development.");
  }

  await assertVerifiedDevelopmentMapping();

  const scan = await fetchDirectEmployerBoard(
    TARGET.organisationName,
    TARGET.provider,
    TARGET.careersUrl,
    {
      deadlineMs: Date.now() + FEED_DEADLINE_MS,
      firstPartyEvidenceUrl: TARGET.evidenceUrl,
    },
  );

  if (
    !scan.complete ||
    !scan.mapping ||
    scan.mapping.provider !== TARGET.provider ||
    scan.mapping.boardId !== TARGET.boardId ||
    scan.mapping.evidenceUrl !== TARGET.careersUrl ||
    scan.mapping.feedUrl !== TARGET.feedUrl ||
    scan.advertsExtracted === 0 ||
    scan.advertsExtracted !== scan.adverts.length
  ) {
    throw new Error(
      `Circle direct feed was not a complete, validated snapshot: ${scan.error ?? "feed count or mapping mismatch"}`,
    );
  }

  const normalizedRows = normaliseAndDedupeBoardAdverts(scan.adverts).length;
  const manualLabourRowsFiltered = scan.adverts.filter((advert) =>
    isManualLabourTitle(advert.title),
  ).length;
  const managerTitleCount = scan.adverts.filter((advert) =>
    isStandaloneManagerTitle(advert.title),
  ).length;
  const invalidAdverts = scan.adverts.filter((advert) => {
    if (
      advert.organisationName !== TARGET.organisationName ||
      advert.sourceType !== "company_site" ||
      advert.companyVacancyEvidence?.provider !== TARGET.provider
    ) {
      return true;
    }
    try {
      const url = new URL(advert.url);
      return url.protocol !== "https:" ||
        url.hostname !== "circlehealth.wd103.myworkdayjobs.com" ||
        !url.pathname.startsWith("/en-GB/chgcareers/job/");
    } catch {
      return true;
    }
  });
  if (invalidAdverts.length > 0) {
    throw new Error(`Refusing import: ${invalidAdverts.length} adverts failed the Circle direct-feed boundary.`);
  }

  const imported = await upsertSharedBoardVacancies(scan.adverts, { queueVerifications: true });
  const pendingVerification = await waitForVerification(Date.now() + VERIFICATION_WAIT_MS);

  const liveness = await db.execute<{ liveness: string; count: number }>(sql`
    SELECT liveness, count(*)::int AS count
    FROM sponsor_licence_vacancies
    WHERE lower(btrim(organisation_name)) = lower(btrim(${TARGET.organisationName}))
      AND source_type = 'company_site'
      AND company_vacancy_evidence->>'provider' = ${TARGET.provider}
    GROUP BY liveness
    ORDER BY liveness
  `);
  const managerReview = await db.execute<{ pending_review_count: number }>(sql`
    SELECT count(*)::int AS pending_review_count
    FROM sponsor_licence_vacancies
    WHERE lower(btrim(organisation_name)) = lower(btrim(${TARGET.organisationName}))
      AND source_type = 'company_site'
      AND company_vacancy_evidence->>'provider' = ${TARGET.provider}
      AND title ~* '\\mmanagers?\\M'
      AND (
        company_vacancy_evidence->'roleEligibilityReview'->>'status' = 'approved'
        AND company_vacancy_evidence->'roleEligibilityReview'->>'socCode' ~ '^[0-9]{4}$'
        AND company_vacancy_evidence->'roleEligibilityReview'->>'evidenceUrl' ~ '^https://[^[:space:]]+$'
      ) IS NOT TRUE
  `);

  process.stdout.write(`${JSON.stringify({
    directFeedOnly: true,
    provider: TARGET.provider,
    boardId: TARGET.boardId,
    pagesFetched: scan.pagesFetched,
    feedRows: scan.advertsExtracted,
    normalizedRows,
    manualLabourRowsFiltered,
    managerTitleRowsPendingReview: managerTitleCount,
    upsert: imported,
    pendingExactLinkVerification: pendingVerification,
    storedLiveness: liveness.rows,
    managerRowsCurrentlyHiddenPendingReview: managerReview.rows[0]?.pending_review_count ?? 0,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});