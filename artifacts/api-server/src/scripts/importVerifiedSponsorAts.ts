import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { fetchDirectEmployerBoard } from "../lib/directEmployerBoardConnectors";
import { upsertSharedBoardVacancies } from "../lib/boardVacancyPipeline";

type Target = {
  organisationName: string;
  provider: "Ashby" | "Greenhouse";
  boardId: string;
  careersUrl: string;
  evidenceUrl: string;
};

const TARGETS: Target[] = [
  {
    organisationName: "Vertical Aerospace Group Ltd",
    provider: "Ashby",
    boardId: "vertical-aerospace",
    careersUrl: "https://jobs.ashbyhq.com/vertical-aerospace",
    evidenceUrl: "https://www.vertical-aerospace.com/careers",
  },
  {
    organisationName: "Pliant Payments Limited",
    provider: "Ashby",
    boardId: "pliant",
    careersUrl: "https://jobs.ashbyhq.com/pliant",
    evidenceUrl: "https://www.getpliant.com/en/careers",
  },
  {
    organisationName: "59 Studio Ltd",
    provider: "Greenhouse",
    boardId: "journey",
    careersUrl: "https://job-boards.greenhouse.io/journey",
    evidenceUrl: "https://59.studio/join",
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForVerification(deadlineMs: number): Promise<void> {
  while (Date.now() < deadlineMs) {
    const pending = await db.execute<{ pending_count: number }>(sql`
      SELECT count(*)::int AS pending_count
      FROM sponsor_licence_vacancies
      WHERE source_type = 'company_site'
        AND company_vacancy_evidence->>'provider' IN ('Ashby', 'Greenhouse')
        AND lower(btrim(organisation_name)) = ANY(${sql.param(
          TARGETS.map((target) => target.organisationName.toLowerCase()),
        )}::text[])
        AND last_verified_at IS NULL
    `);
    if ((pending.rows[0]?.pending_count ?? 0) === 0) return;
    await sleep(2_000);
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("This audit importer is development-only; set NODE_ENV=development.");
  }

  const scans = [];
  for (const target of TARGETS) {
    const mapping = await db.execute<{
      careers_url: string | null;
      ats_provider: string | null;
      ats_board_id: string | null;
      ats_mapping_status: string;
      ats_mapping_evidence_url: string | null;
    }>(sql`
      SELECT careers_url, ats_provider, ats_board_id, ats_mapping_status, ats_mapping_evidence_url
      FROM sponsor_licence_company_site_checks
      WHERE lower(btrim(organisation_name)) = lower(btrim(${target.organisationName}))
      LIMIT 1
    `);
    const saved = mapping.rows[0];
    if (
      !saved ||
      saved.ats_mapping_status !== "verified" ||
      saved.ats_provider?.toLowerCase() !== target.provider.toLowerCase() ||
      saved.ats_board_id !== target.boardId ||
      saved.careers_url !== target.careersUrl ||
      saved.ats_mapping_evidence_url !== target.evidenceUrl
    ) {
      throw new Error(`Development mapping is not verified exactly as expected for ${target.organisationName}.`);
    }

    const scan = await fetchDirectEmployerBoard(
      target.organisationName,
      target.provider,
      target.careersUrl,
      { deadlineMs: Date.now() + 45_000 },
    );
    if (!scan.complete || !scan.mapping || scan.mapping.boardId !== target.boardId) {
      throw new Error(`Direct ATS feed failed for ${target.organisationName}: ${scan.error ?? "incomplete feed"}`);
    }
    scans.push({ target, scan });
  }

  const firstImport = [];
  for (const { target, scan } of scans) {
    const result = await upsertSharedBoardVacancies(scan.adverts);
    firstImport.push({
      organisationName: target.organisationName,
      provider: target.provider,
      boardId: target.boardId,
      feedCount: scan.advertsExtracted,
      normalizedImportCandidates: scan.adverts.length,
      firstImport: result,
      sampleListings: scan.adverts.slice(0, 2).map(({ title, url, applicationUrl }) => ({
        title,
        detailUrl: url,
        applicationUrl,
      })),
    });
  }

  await waitForVerification(Date.now() + 150_000);

  const repeatImport = [];
  for (const { target, scan } of scans) {
    const result = await upsertSharedBoardVacancies(scan.adverts);
    if (result.inserted !== 0) {
      throw new Error(`Repeat import inserted ${result.inserted} duplicates for ${target.organisationName}.`);
    }
    repeatImport.push({
      organisationName: target.organisationName,
      provider: target.provider,
      feedCount: scan.advertsExtracted,
      result,
    });
  }

  await waitForVerification(Date.now() + 150_000);

  const storedRows = [];
  for (const target of TARGETS) {
    const rows = await db.execute<{
      id: number;
      title: string;
      url: string;
      application_url: string | null;
      liveness: string;
      last_verified_at: Date | string | null;
    }>(sql`
      SELECT id, title, url, application_url, liveness, last_verified_at
      FROM sponsor_licence_vacancies
      WHERE lower(btrim(organisation_name)) = lower(btrim(${target.organisationName}))
        AND source_type = 'company_site'
        AND company_vacancy_evidence->>'provider' = ${target.provider}
      ORDER BY title, id
    `);
    storedRows.push({
      organisationName: target.organisationName,
      total: rows.rows.length,
      liveness: rows.rows.reduce<Record<string, number>>((counts, row) => {
        counts[row.liveness] = (counts[row.liveness] ?? 0) + 1;
        return counts;
      }, {}),
      verifiedAtCount: rows.rows.filter((row) => row.last_verified_at != null).length,
    });
  }

  process.stdout.write(`${JSON.stringify({ firstImport, repeatImport, storedRows }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});