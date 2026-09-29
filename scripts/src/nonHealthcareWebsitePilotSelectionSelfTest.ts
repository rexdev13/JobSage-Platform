import assert from "node:assert/strict";
import {
  buildWebsiteVerificationPilot,
  parseWebsiteFailureHistory,
} from "./nonHealthcareWebsitePilotSelection";

function row(
  id: string,
  confidence: "medium" | "low",
  domain: string,
  options: {
    source?: string;
    emailDomain?: string;
    website?: string;
    careers?: string;
    locationFields?: number;
  } = {},
): Record<string, string> {
  const source = options.source ?? "existing_website";
  const emailDomain = options.emailDomain ?? domain;
  const website = options.website ?? `https://${domain}/`;
  const locationFields = options.locationFields ?? 1;
  return {
    sponsor_licence_id: id,
    organisation_name: `Example Employer ${id} Ltd`,
    industry: "Education",
    town_city: locationFields >= 1 ? "Leeds" : "",
    county: locationFields >= 2 ? "West Yorkshire" : "",
    region: locationFields >= 3 ? "Yorkshire" : "",
    existing_contact_email: `info@${emailDomain}`,
    existing_website: website,
    existing_careers_url: options.careers ?? "",
    official_website_url: confidence === "medium" ? `https://${domain}/` : "",
    website_evidence_url:
      confidence === "low" ? `https://${domain}/about` : `https://${domain}/`,
    website_confidence: confidence,
    source,
    notes: "test row",
  };
}

function testFailureJournalParsing(): void {
  const history = parseWebsiteFailureHistory(
    [
      JSON.stringify({ sponsorKey: "id:1", failureCodes: ["robots_or_policy_block"] }),
      JSON.stringify({ sponsorKey: "id:1", failureCodes: ["website_timeout"] }),
      JSON.stringify({ sponsorKey: "id:2", failureCodes: [] }),
    ].join("\n"),
  );
  assert.deepEqual(history.get("1"), [
    "robots_or_policy_block",
    "website_timeout",
  ]);
  assert.deepEqual(history.get("2"), []);
  assert.throws(() => parseWebsiteFailureHistory("{bad json"), /line 1/);
}

function testStrongMediumFirstAndUniqueDomains(): void {
  const rows = [
    row("medium-a", "medium", "alpha.test", { locationFields: 3 }),
    row("medium-b", "medium", "beta.test", { locationFields: 1 }),
    row("medium-a2", "medium", "alpha.test", { locationFields: 2 }),
    row("low-a", "low", "low.test", { source: "SponsorList" }),
  ];
  const history = new Map([
    ["medium-a", []],
    ["medium-a2", []],
    ["medium-b", []],
    ["low-a", []],
  ]);
  const result = buildWebsiteVerificationPilot(rows, history, 2);

  assert.equal(result.strongMediumCount, 3);
  assert.equal(result.strongMediumDomainCount, 2);
  assert.equal(result.selected.length, 2);
  assert.deepEqual(
    result.selected.map((item) => item.sponsor_licence_id),
    ["medium-a", "medium-b"],
  );
  assert.equal(result.selectedLowCount, 0);
  assert.ok(result.selected.every((item) => item.current_confidence === "medium"));
}

function testLowOnlyAfterStrongAndOtherMediumCandidates(): void {
  const rows = [
    row("strong", "medium", "strong.test", { locationFields: 3 }),
    row("weak-medium", "medium", "weak.test", {
      emailDomain: "different.test",
      source: "SponsorList",
    }),
    row("low", "low", "low.test", { source: "SponsorList" }),
  ];
  const history = new Map([
    ["strong", []],
    ["weak-medium", []],
    ["low", []],
  ]);
  const result = buildWebsiteVerificationPilot(rows, history, 3);

  assert.equal(result.strongMediumCount, 1);
  assert.deepEqual(
    result.selected.map((item) => item.selection_group),
    ["strong_medium", "medium_fallback", "low_fallback"],
  );
  assert.equal(result.selectedLowCount, 1);
}

function testBlockingHistoryPreventsStrongMediumStatus(): void {
  const candidate = row("blocked-medium", "medium", "blocked.test");
  const history = new Map([["blocked-medium", ["robots_or_policy_block"]]]);
  const result = buildWebsiteVerificationPilot([candidate], history, 1);

  assert.equal(result.strongMediumCount, 0);
  assert.equal(result.selectedMediumFallbackCount, 1);
  assert.equal(
    result.selected[0]?.prior_blocking_failure_codes,
    "robots_or_policy_block",
  );
  assert.ok(result.selected[0]?.selection_reason.includes("prior blocking errors"));
}

testFailureJournalParsing();
testStrongMediumFirstAndUniqueDomains();
testLowOnlyAfterStrongAndOtherMediumCandidates();
testBlockingHistoryPreventsStrongMediumStatus();
console.log("Non-healthcare website pilot-selection self-tests passed.");