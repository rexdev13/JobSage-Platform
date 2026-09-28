import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  classifyCompanySiteJobErrorCategory,
  runCompanySiteCheck,
  type CompanySiteBatchRow,
  type CompanySiteCheckOutcome,
} from "../lib/companySiteScheduler";
import { assertDatabaseFingerprint, safeToolErrorSummary } from "./databaseSafety";

type EmployerRow = {
  id: number;
  organisation_name: string;
  website: string;
  industry: string | null;
  generic_checked_at: Date | string | null;
  ats_checked_at: Date | string | null;
  careers_url: string | null;
  ats_mapping_evidence_url: string | null;
  ats_provider: string | null;
  ats_board_id: string | null;
  ats_mapping_status: "verified" | "unverified" | null;
};

function getArgument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function dateOrNull(value: Date | string | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function summarize(outcome: CompanySiteCheckOutcome): Record<string, unknown> {
  if (outcome.status === "skipped") {
    return { status: "skipped", reason: outcome.reason };
  }
  return {
    status: "checked",
    provider: outcome.atsProvider,
    completion: outcome.completion,
    errorCategory: outcome.errorCategory ?? null,
    httpStatus: outcome.httpStatus ?? null,
    retryAfter: outcome.retryAfter?.toISOString() ?? null,
    accepted: outcome.adverts,
    inserted: outcome.inserted,
    updated: outcome.updated,
    revived: outcome.revived,
    retired: outcome.retired ?? 0,
    repeatImport: outcome.repeatImport ?? null,
  };
}

async function main(): Promise<void> {
  const organisationName = getArgument("organisation")?.trim();
  if (!organisationName) {
    throw new Error("Provide exactly one employer with --organisation=NAME.");
  }
  if (
    process.env.NODE_ENV !== "development" ||
    getArgument("environment") !== "development" ||
    getArgument("confirm-dev-writes") !== "true" ||
    process.env.SPONSOR_WEBSITE_VACANCY_PIPELINE_DEV_DB !== "confirmed"
  ) {
    throw new Error(
      "This test is development-only and requires NODE_ENV=development, --environment=development, --confirm-dev-writes=true, and SPONSOR_WEBSITE_VACANCY_PIPELINE_DEV_DB=confirmed.",
    );
  }
  const expectedFingerprint = getArgument("expected-db-fingerprint");
  if (!expectedFingerprint) {
    throw new Error("Provide --expected-db-fingerprint from the confirmed development database.");
  }
  await assertDatabaseFingerprint(expectedFingerprint);

  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const result = await tx.execute<EmployerRow>(sql`
      SELECT DISTINCT ON (
        lower(btrim(sl.organisation_name)),
        lower(btrim(sl.website))
      )
        sl.id,
        sl.organisation_name,
        trim(sl.website) AS website,
        sl.industry,
        cs.generic_checked_at,
        cs.ats_checked_at,
        cs.careers_url,
        cs.ats_mapping_evidence_url,
        cs.ats_provider,
        cs.ats_board_id,
        cs.ats_mapping_status
      FROM sponsor_licences sl
      JOIN sponsor_licence_company_site_checks cs
        ON cs.organisation_name = sl.organisation_name
      WHERE lower(btrim(sl.organisation_name)) = lower(btrim(${organisationName}))
        AND sl.website IS NOT NULL
        AND trim(sl.website) <> ''
        AND cs.ats_mapping_status = 'verified'
        AND cs.ats_provider IS NOT NULL
        AND cs.ats_board_id IS NOT NULL
        AND cs.careers_url IS NOT NULL
      ORDER BY
        lower(btrim(sl.organisation_name)),
        lower(btrim(sl.website)),
        sl.id
      LIMIT 2
    `);
    return result.rows;
  });
  if (rows.length !== 1) {
    throw new Error(
      rows.length === 0
        ? "No verified direct-feed mapping found for that exact employer."
        : "Employer identity is ambiguous; the repeat test requires one unique mapping.",
    );
  }
  const value = rows[0]!;
  const employer: CompanySiteBatchRow = {
    id: Number(value.id),
    organisationName: value.organisation_name,
    website: value.website,
    industry: value.industry,
    genericCheckedAt: dateOrNull(value.generic_checked_at),
    atsCheckedAt: dateOrNull(value.ats_checked_at),
    careersUrl: value.careers_url,
    atsMappingEvidenceUrl: value.ats_mapping_evidence_url,
    atsProvider: value.ats_provider,
    atsBoardId: value.ats_board_id,
    atsMappingStatus: value.ats_mapping_status,
    bookmarked: false,
    healthcareEvidenceBackfill: false,
    lastOutcome: null,
    probeStatus: "unknown",
    lastProbedAt: null,
    probeReason: null,
  };

  const deadlineMs = Date.now() + 20_000;
  const first = await runCompanySiteCheck(employer, {
    directFeedsOnly: true,
    acquireLease: true,
    deadlineMs,
  });
  if (
    first.status !== "checked" ||
    first.completion !== "complete" ||
    first.adverts < 1
  ) {
    process.stdout.write(`${JSON.stringify({
      environment: "development",
      result: "precondition_not_met",
      employer: employer.organisationName,
      firstRun: summarize(first),
      reason: "A complete feed with at least one accepted posting is required for the repeat-import assertion.",
    }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  const second = await runCompanySiteCheck(employer, {
    directFeedsOnly: true,
    acquireLease: true,
    deadlineMs: Date.now() + 20_000,
    verifyImportIdempotency: true,
    expectNoInserts: true,
    queueVerifications: false,
  });
  const repeatInsertCount = second.status === "checked"
    ? second.repeatImport?.inserted ?? null
    : null;
  const passed =
    second.status === "checked" &&
    second.completion === "complete" &&
    second.inserted === 0 &&
    repeatInsertCount === 0;
  const report = {
    environment: "development",
    mode: "one_employer_direct_feed_repeat_import",
    employer: employer.organisationName,
    mappingId: `${employer.atsProvider}:${employer.atsBoardId}`,
    firstRun: summarize(first),
    secondRun: summarize(second),
    passed,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!passed) {
    console.error(
      `Repeat import did not prove idempotency (${classifyCompanySiteJobErrorCategory(
        second.status === "checked" ? second.errorCategory : second.reason,
      )}).`,
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "Development repeat-import test failed:",
    classifyCompanySiteJobErrorCategory(error),
    safeToolErrorSummary(error),
  );
  process.exitCode = 1;
});