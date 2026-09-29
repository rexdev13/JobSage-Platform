import assert from "node:assert/strict";
import { buildWebsiteVerificationQueue } from "./nonHealthcareWebsiteVerificationDryRun";

function row(
  sponsorId: string,
  confidence: string,
  officialUrl: string,
  evidenceUrl: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    sponsor_licence_id: sponsorId,
    organisation_name: `Example Employer ${sponsorId} Ltd`,
    industry: "Education",
    town_city: "Leeds",
    county: "West Yorkshire",
    region: "Yorkshire and the Humber",
    website_confidence: confidence,
    official_website_url: officialUrl,
    website_evidence_url: evidenceUrl,
    source: "existing_website",
    notes: "name_tokens_on_page:example+employer",
    ...overrides,
  };
}

function testQueueOnlyMediumAndLowRows(): void {
  const result = buildWebsiteVerificationQueue([
    row("medium-1", "medium", "https://www.medium.test/", "https://medium.test/about"),
    row(
      "low-1",
      "low",
      "",
      "https://low.test/about-us?tracking=discard-me#identity",
    ),
    row("high-1", "high", "https://high.test/", "https://high.test/"),
    row("unverified-1", "unverified", "", ""),
  ]);

  assert.equal(result.inputRowCount, 4);
  assert.equal(result.eligibleRowCount, 2);
  assert.equal(result.queuedRowCount, 2);
  assert.equal(result.rows[0]?.dry_run_status, "ready_for_independent_check");
  assert.equal(result.rows[0]?.candidate_site_root, "https://www.medium.test/");
  assert.equal(result.rows[1]?.candidate_site_root, "https://low.test/");
  assert.equal(result.rows[1]?.evidence_url, "https://low.test/about-us");
  assert.equal(result.rows[1]?.evidence_path, "/about-us");
  assert.equal(result.rows[1]?.current_official_website_url, "");
  assert.ok(result.rows.every((item) => item.network_requests_made === "0"));
  assert.ok(result.rows.every((item) => item.dry_run_status !== "verified"));
}

function testAmbiguousAndInvalidEvidenceIsManualReview(): void {
  const result = buildWebsiteVerificationQueue([
    row("mismatch", "medium", "https://employer.test/", "https://other.test/about"),
    row("blocked", "low", "", "https://linkedin.com/company/example"),
    row("missing-evidence", "medium", "https://employer.test/", ""),
  ]);

  assert.deepEqual(
    result.rows.map((item) => item.dry_run_status),
    [
      "manual_review_evidence_domain_mismatch",
      "manual_review_candidate_host_not_eligible",
      "manual_review_missing_or_invalid_evidence_url",
    ],
  );
  assert.ok(result.rows.every((item) => item.candidate_site_root === "" || item.candidate_site_root === "https://employer.test/"));
}

function testLimitAndDuplicateIds(): void {
  const rows = [
    row("first", "medium", "https://first.test/", "https://first.test/"),
    row("second", "low", "", "https://second.test/"),
  ];
  const limited = buildWebsiteVerificationQueue(rows, 1);
  assert.equal(limited.eligibleRowCount, 2);
  assert.equal(limited.queuedRowCount, 1);
  assert.equal(limited.limitApplied, 1);

  assert.throws(
    () =>
      buildWebsiteVerificationQueue([
        row("duplicate", "medium", "https://one.test/", "https://one.test/"),
        row("duplicate", "low", "", "https://two.test/"),
      ]),
    /Duplicate sponsor_licence_id/,
  );
}

testQueueOnlyMediumAndLowRows();
testAmbiguousAndInvalidEvidenceIsManualReview();
testLimitAndDuplicateIds();
console.log("Non-healthcare website verification dry-run self-tests passed.");