import assert from "node:assert/strict";
import { stringifyCsv } from "./sponsor-contact-discovery/csv";
import {
  decideWebsiteImportAction,
  NON_HEALTHCARE_WEBSITE_IMPORT_COLUMNS,
  parseNonHealthcareWebsiteCsv,
  type NonHealthcareWebsiteRow,
} from "./nonHealthcareSponsorWebsiteImportCore";

function sourceRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    sponsor_licence_id: "1001",
    organisation_name: "Sample Engineering Ltd",
    normalized_organisation_name: "sample engineering ltd",
    town_city: "Leeds",
    county: "West Yorkshire",
    region: "Yorkshire and the Humber",
    industry: "Engineering",
    route: "Worker",
    sub_route: "Skilled Worker",
    existing_website: "",
    existing_contact_email: "",
    existing_careers_url: "",
    official_website_url: "https://sample-engineering.example/",
    website_confidence: "high",
    website_evidence_url: "https://sample-engineering.example/about",
    source: "SponsorList",
    notes: "identity verified",
    ...overrides,
  };
}

function csvFor(...rows: Record<string, string>[]): string {
  return stringifyCsv(rows, NON_HEALTHCARE_WEBSITE_IMPORT_COLUMNS);
}

const parsedHigh = parseNonHealthcareWebsiteCsv(csvFor(sourceRow()))[0]!;
assert.equal(parsedHigh.website_confidence, "high");
assert.equal(decideWebsiteImportAction(parsedHigh, ""), "promote_high_blank");
assert.equal(
  decideWebsiteImportAction(parsedHigh, "https://sample-engineering.example"),
  "preserve_existing_same",
);
assert.equal(
  decideWebsiteImportAction(parsedHigh, "https://other.example/"),
  "preserve_existing_different",
);

const parsedMedium = parseNonHealthcareWebsiteCsv(csvFor(sourceRow({
  website_confidence: "medium",
})))[0]!;
assert.equal(decideWebsiteImportAction(parsedMedium, ""), "review_medium");

const parsedLow = parseNonHealthcareWebsiteCsv(csvFor(sourceRow({
  website_confidence: "low",
  official_website_url: "",
})))[0]!;
assert.equal(decideWebsiteImportAction(parsedLow, ""), "review_low");

const parsedUnverified = parseNonHealthcareWebsiteCsv(csvFor(sourceRow({
  website_confidence: "unverified",
  official_website_url: "",
  website_evidence_url: "",
})))[0]!;
assert.equal(decideWebsiteImportAction(parsedUnverified, ""), "unverified");

assert.throws(
  () => parseNonHealthcareWebsiteCsv(csvFor(sourceRow({ industry: "Healthcare" }))),
  /Healthcare rows are not allowed/,
);
assert.throws(
  () => parseNonHealthcareWebsiteCsv(csvFor(
    sourceRow(),
    sourceRow({ organisation_name: "Duplicate ID" }),
  )),
  /duplicate sponsor_licence_id/,
);
assert.throws(
  () => parseNonHealthcareWebsiteCsv(csvFor(sourceRow({ website_evidence_url: "" }))),
  /require an official URL and evidence URL/,
);
assert.throws(
  () => parseNonHealthcareWebsiteCsv(csvFor(sourceRow({
    website_confidence: "low",
    official_website_url: "https://sample-engineering.example/",
  }))),
  /low\/unverified results cannot contain an official website URL/,
);

console.log("non-Healthcare sponsor website import self-test passed");