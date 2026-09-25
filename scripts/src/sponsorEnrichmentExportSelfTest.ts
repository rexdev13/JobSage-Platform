import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPANY_SITE_EXPORT_COLUMNS,
  IMPORT_TEMPLATE_COLUMNS,
  SPONSOR_EXPORT_COLUMNS,
  VACANCY_SOURCE_EXPORT_COLUMNS,
  aggregateVacancySources,
  assertDevelopmentTarget,
  selectSponsorRows,
  validateExportArtifacts,
  validateSourceCoverage,
  vacancyUrlHost,
} from "./sponsorEnrichmentExport";
import { parseCsv, writeCsvFile } from "./sponsor-contact-discovery/csv";

async function main(): Promise<void> {
  const sponsorRows = [
    { sponsor_licence_id: 1, organisation_name: "Example Website Ltd", industry: "General", website: "https://example.test" },
    { sponsor_licence_id: 2, organisation_name: "North Care Group", industry: "Social care", website: "" },
    { sponsor_licence_id: 3, organisation_name: "Byte Technology Ltd", industry: "Technology", website: "" },
    { sponsor_licence_id: 4, organisation_name: "Employer Four", industry: "Other", website: "" },
    { sponsor_licence_id: 5, organisation_name: "Employer Five", industry: "Other", website: "" },
    { sponsor_licence_id: 6, organisation_name: "Employer Six", industry: "Other", website: "" },
  ];
  const firstSelection = selectSponsorRows(sponsorRows, 2, 2);
  const secondSelection = selectSponsorRows(sponsorRows, 2, 2);
  const selectedIds = firstSelection.selected.map((row) => String(row.sponsor_licence_id));
  assert.deepEqual(selectedIds, secondSelection.selected.map((row) => String(row.sponsor_licence_id)));
  assert.equal(firstSelection.fullExport, false);
  assert.ok(selectedIds.includes("1"), "existing website rows must always be included");
  assert.ok(selectedIds.includes("2"), "health/social-care sector rows must always be included");
  assert.ok(selectedIds.includes("3"), "technology sector rows must always be included");
  assert.equal(firstSelection.sampledRows, 2);

  assert.doesNotThrow(() => validateSourceCoverage([{
    source: "Test",
    sourceFile: "fixture.csv",
    sourceSnapshotDate: "2026-09-25",
    sourceVersionEvidence: "test fixture",
    sourceRecordCount: 2,
    sourceRecordsWithWebsite: 1,
    sourceRecordsWithEmail: 1,
    sourceRecordMatches: 1,
    sponsorRowsMatched: 1,
    matchedRowsWithWebsite: 1,
    matchedRowsWithEmail: 1,
    potentialWebsiteAdds: 1,
    potentialEmailAdds: 1,
    confirmedPersistedEnrichments: 0,
    samples: [{
      sponsorLicenceId: "1",
      sponsorName: "Example",
      matchedSourceName: "Example",
      matchMethod: "exact_name",
      confidence: "high",
      sourceEvidenceUrl: "https://source.example/record/1",
      websiteAvailable: true,
      emailAvailable: true,
    }],
  }], 1));
  assert.throws(() => validateSourceCoverage([{
    source: "Test",
    sourceFile: "fixture.csv",
    sourceSnapshotDate: "2026-09-25",
    sourceVersionEvidence: "test fixture",
    sourceRecordCount: 1,
    sourceRecordsWithWebsite: 0,
    sourceRecordsWithEmail: 0,
    sourceRecordMatches: 1,
    sponsorRowsMatched: 1,
    matchedRowsWithWebsite: 0,
    matchedRowsWithEmail: 0,
    potentialWebsiteAdds: 1,
    potentialEmailAdds: 0,
    confirmedPersistedEnrichments: 0,
    samples: [],
  }], 1), /coverage counts do not reconcile/);

  assert.equal(vacancyUrlHost("https://www.jobs.example.test/role/1"), "jobs.example.test");
  const sources = aggregateVacancySources([
    {
      organisation_name: "Example Employer",
      source_type: "company_site",
      board_name: "Ashby",
      url: "https://www.jobs.example.test/role/a",
      application_url: "https://jobs.example.test/apply/a",
      check_date: "2026-09-20",
      last_verified_at: "2026-09-21T10:00:00.000Z",
      liveness: "live",
      row_id: 1,
    },
    {
      organisation_name: "Example Employer",
      source_type: "company_site",
      board_name: "Ashby",
      url: "https://jobs.example.test/role/b",
      application_url: "https://jobs.example.test/apply/b",
      check_date: "2026-09-22",
      last_verified_at: "2026-09-23T10:00:00.000Z",
      liveness: "dead",
      row_id: 2,
    },
  ]);
  assert.equal(sources.length, 1);
  assert.equal(sources[0]?.vacancy_count, 2);
  assert.equal(sources[0]?.latest_check_date, "2026-09-22");
  assert.equal(sources[0]?.latest_verification_status, "dead");

  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  assert.throws(() => assertDevelopmentTarget(["--confirm-development-db"]), /development-only/);
  process.env.NODE_ENV = originalNodeEnv;

  const directory = await mkdtemp(join(tmpdir(), "sponsor-export-test-"));
  try {
    await writeCsvFile(
      join(directory, "jobsage-sponsor-base-export.csv"),
      [{ sponsor_licence_id: 1, organisation_name: 'Employer, "North"' }],
      SPONSOR_EXPORT_COLUMNS,
    );
    await writeCsvFile(join(directory, "jobsage-company-site-existing.csv"), [], COMPANY_SITE_EXPORT_COLUMNS);
    await writeCsvFile(join(directory, "jobsage-existing-vacancy-sources.csv"), [], VACANCY_SOURCE_EXPORT_COLUMNS);
    await writeCsvFile(
      join(directory, "jobsage-website-enrichment-import-template.csv"),
      [],
      IMPORT_TEMPLATE_COLUMNS,
    );
    await validateExportArtifacts(directory, {
      sponsorRows: 1,
      companySiteRows: 0,
      vacancySourceRows: 0,
    });
    const csv = parseCsv(await readFile(
      join(directory, "jobsage-sponsor-base-export.csv"),
      "utf8",
    ));
    assert.equal(csv[1]?.[1], 'Employer, "North"', "CSV values must be escaped and round-trip");
    const template = parseCsv(await readFile(
      join(directory, "jobsage-website-enrichment-import-template.csv"),
      "utf8",
    ));
    assert.deepEqual(template, [[...IMPORT_TEMPLATE_COLUMNS]]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  console.log("Sponsor enrichment export self-test passed.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});