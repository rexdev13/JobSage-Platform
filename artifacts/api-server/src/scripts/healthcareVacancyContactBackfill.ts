import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pool } from "@workspace/db";
import {
  runHealthcareVacancyContactBackfill,
  type HealthcareVacancyContactBackfillRow,
} from "../lib/healthcareVacancyContactBackfill";

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function toCsv(rows: readonly HealthcareVacancyContactBackfillRow[]): string {
  const headers = [
    "id",
    "organisation_name",
    "title",
    "url",
    "source_type",
    "board_name",
    "existing_contact_email",
    "contact_email",
    "contact_evidence_url",
    "outcome",
  ];
  const body = rows.map((row) => [
    row.id,
    row.organisationName,
    row.title,
    row.url,
    row.sourceType,
    row.boardName,
    row.existingContactEmail,
    row.contactEmail,
    row.contactEvidenceUrl,
    row.outcome,
  ].map(csvCell).join(","));
  return `${headers.join(",")}\n${body.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const requestedLimit = Number.parseInt(args[0] ?? "100", 10);
  const requestedOutput = args[1] ??
    `.agents/outputs/healthcare-vacancy-contact-backfill-${new Date().toISOString().slice(0, 10)}.csv`;
  const outputPath = resolve(requestedOutput);
  try {
    const summary = await runHealthcareVacancyContactBackfill(
      Number.isFinite(requestedLimit) ? requestedLimit : 100,
    );
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, toCsv(summary.rows), "utf8");
    console.log(JSON.stringify({
      selected: summary.selected,
      found: summary.found,
      applied: summary.applied,
      skippedExisting: summary.skippedExisting,
      notFound: summary.notFound,
      errors: summary.errors,
      topEmails: summary.topEmails,
      report: outputPath,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    "[healthcare-vacancy-contact-backfill] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});