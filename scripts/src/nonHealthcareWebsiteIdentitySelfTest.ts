import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runNonHealthcareCompanyWebsiteDiscovery,
  selectNonHealthcareSectors,
} from "./nonHealthcareCompanyWebsiteDiscovery";
import {
  extractBingWebsiteLeads,
  sponsorListWebsiteLead,
  verifyOfficialWebsiteIdentity,
  websiteCandidateFromEmail,
  websiteCandidateFromValue,
} from "./nonHealthcareWebsiteIdentity";

function sourceRow(
  sponsor_licence_id: string,
  organisation_name: string,
  industry: string,
  town_city = "Leeds",
): Record<string, string> {
  return { sponsor_licence_id, organisation_name, industry, town_city };
}

function testSelectionScopeAndCaps(): void {
  const rows = [
    sourceRow("1", "B One Ltd", "Sector B"),
    sourceRow("2", "Exact Healthcare Ltd", "Healthcare"),
    sourceRow("3", "Blank Sector Ltd", ""),
    sourceRow("4", "Almost Healthcare Ltd", "Healthcare "),
    sourceRow("5", "A One Ltd", "Sector A"),
    sourceRow("6", "A Two Ltd", "Sector A"),
    sourceRow("7", "A Three Ltd", "Sector A"),
    sourceRow("8", "B Two Ltd", "Sector B"),
    sourceRow("5", "Duplicate A One Ltd", "Sector C"),
  ];
  const result = selectNonHealthcareSectors(rows, 2);

  assert.equal(result.healthcareRowsExcluded, 1);
  assert.equal(result.duplicateRowsSkipped, 1);
  assert.deepEqual(
    result.sectors.map(({ label }) => label),
    ["", "Healthcare ", "Sector A", "Sector B"],
  );
  assert.equal(result.sectors[0]?.slug, "missing-industry");
  const sectorA = result.sectors.find(({ label }) => label === "Sector A");
  assert.equal(sectorA?.sourceCount, 3);
  assert.equal(sectorA?.rows.length, 2);
  assert.equal(sectorA?.capApplied, true);
  assert.deepEqual(
    sectorA?.rows.map(({ sponsor_licence_id }) => sponsor_licence_id),
    ["5", "6"],
  );
}

function testWebsiteCandidateFilters(): void {
  assert.equal(
    websiteCandidateFromValue("https://www.linkedin.com/company/acme", "test"),
    null,
  );
  assert.equal(websiteCandidateFromValue("https://jobs.lever.co/acme", "test"), null);
  assert.equal(websiteCandidateFromEmail("recruiting@gmail.com"), null);
  assert.equal(
    websiteCandidateFromEmail("recruiting@acme-example.co.uk")?.domain,
    "acme-example.co.uk",
  );
}

function testFirstPartyIdentityEvidence(): void {
  const source = {
    organisation_name: "Acme Equipment Ltd",
    town_city: "Bristol",
    county: "Somerset",
    region: "South West",
  };
  const verified = verifyOfficialWebsiteIdentity(source, {
    url: "https://acme-equipment.co.uk/",
    body: "<title>Acme Equipment</title><p>Our Bristol team serves the South West.</p>",
    contentType: "text/html",
  });
  assert.equal(verified.accepted, true);
  assert.equal(verified.confidence, "high");

  const weak = verifyOfficialWebsiteIdentity(source, {
    url: "https://unrelated-example.org/",
    body: "<title>Acme</title><p>Contact our Bristol team.</p>",
    contentType: "text/html",
  });
  assert.equal(weak.accepted, false);
  assert.equal(weak.potential, true);

  const unrelated = verifyOfficialWebsiteIdentity(source, {
    url: "https://another-example.org/",
    body: "<title>Example Services</title><p>Welcome.</p>",
    contentType: "text/html",
  });
  assert.equal(unrelated.accepted, false);
  assert.equal(unrelated.potential, false);
}

function testSponsorListAndBingLeadFiltering(): void {
  const sponsorListLead = sponsorListWebsiteLead(
    {
      organisation_name: "Northstar Calibration Ltd",
      town_city: "Leeds",
      county: "West Yorkshire",
      region: "Yorkshire",
    },
    {
      sponsors: [
        {
          name: "Northstar Calibration Ltd",
          city: "Leeds",
          county: "West Yorkshire",
          url: "https://sponsorlist.co.uk/sponsors/northstar-calibration/",
          enrichment: { website: "https://northstarcalibration.co.uk/" },
        },
        {
          name: "Northstar Calibration Ltd",
          city: "Bristol",
          county: "Somerset",
          url: "https://sponsorlist.co.uk/sponsors/northstar-other/",
          enrichment: { website: "https://other-northstar.example/" },
        },
      ],
    },
  );
  assert.equal(sponsorListLead?.domain, "northstarcalibration.co.uk");

  const bingLeads = extractBingWebsiteLeads({
    webPages: {
      value: [
        { url: "https://northstarcalibration.co.uk/about" },
        { url: "https://www.linkedin.com/company/northstar" },
      ],
    },
  });
  assert.deepEqual(
    bingLeads.map(({ domain }) => domain),
    ["northstarcalibration.co.uk"],
  );
}

async function testResumableRunWithoutNetwork(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "non-healthcare-sites-test-"));
  const inputPath = join(directory, "input.csv");
  const companySitesPath = join(directory, "company-sites.csv");
  const vacancySourcesPath = join(directory, "vacancy-sources.csv");
  const outputPath = join(directory, "combined.csv");
  const outputDir = join(directory, "by-sector");
  const reportPath = join(directory, "report.md");
  const progressPath = join(directory, "progress.json");
  const journalPath = join(directory, "progress.jsonl");

  try {
    await Promise.all([
      writeFile(
        inputPath,
        [
          "sponsor_licence_id,organisation_name,industry,existing_website,existing_contact_email,existing_careers_url",
          "A-1,Alpha Example Ltd,Alpha,,,",
          "B-1,Beta Example Ltd,Beta,,,",
          "",
        ].join("\n"),
      ),
      writeFile(companySitesPath, "organisation_name,careers_url\n"),
      writeFile(
        vacancySourcesPath,
        "organisation_name,source_type,latest_verification_status,url_host\n",
      ),
    ]);

    const args = [
      "--input",
      inputPath,
      "--known-sites-file",
      companySitesPath,
      "--known-sources-file",
      vacancySourcesPath,
      "--output",
      outputPath,
      "--output-dir",
      outputDir,
      "--report",
      reportPath,
      "--progress",
      progressPath,
      "--journal",
      journalPath,
      "--max-per-sector",
      "3000",
      "--delay-ms",
      "1000",
      "--max-public-fetch-calls",
      "1",
      "--max-sponsorlist-queries",
      "0",
      "--max-search-queries",
      "0",
    ];

    await runNonHealthcareCompanyWebsiteDiscovery(args);
    const firstProgress = JSON.parse(await readFile(progressPath, "utf8")) as {
      processedCount: number;
      complete: boolean;
    };
    assert.equal(firstProgress.processedCount, 1);
    assert.equal(firstProgress.complete, false);
    assert.equal((await readFile(journalPath, "utf8")).trim().split("\n").length, 1);

    await runNonHealthcareCompanyWebsiteDiscovery([...args, "--resume"]);
    const resumedProgress = JSON.parse(await readFile(progressPath, "utf8")) as {
      processedCount: number;
      complete: boolean;
    };
    assert.equal(resumedProgress.processedCount, 2);
    assert.equal(resumedProgress.complete, true);
    assert.equal((await readFile(journalPath, "utf8")).trim().split("\n").length, 2);
    assert.equal((await readFile(outputPath, "utf8")).trim().split("\n").length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  testSelectionScopeAndCaps();
  testWebsiteCandidateFilters();
  testFirstPartyIdentityEvidence();
  testSponsorListAndBingLeadFiltering();
  await testResumableRunWithoutNetwork();
  console.log("Non-Healthcare website discovery self-tests passed.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});