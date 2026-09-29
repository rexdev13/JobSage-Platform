import assert from "node:assert/strict";
import { stringifyCsv } from "./sponsor-contact-discovery/csv";
import {
  batchRunId,
  HEALTHCARE_SPONSOR_BATCH_COLUMNS,
  isMediumReviewRow,
  parseHealthcareSponsorBatchCsv,
} from "./healthcareSponsorWebsiteImportCore";

function batchRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...Object.fromEntries(HEALTHCARE_SPONSOR_BATCH_COLUMNS.map((column) => [column, ""])),
    sponsor_licence_id: "1001",
    organisation_name: "Sample Medical Centre",
    normalized_organisation_name: "sample medical centre",
    town_city: "Leeds",
    industry: "Healthcare",
    website_confidence: "none",
    careers_confidence: "none",
    ...overrides,
  };
}

const mediumCsv = stringifyCsv([
  batchRow({
    website_url: "https://sample-medical.example/",
    website_confidence: "medium",
    website_evidence_url: "https://sample-medical.example/about/",
  }),
], HEALTHCARE_SPONSOR_BATCH_COLUMNS);
const parsedMedium = parseHealthcareSponsorBatchCsv(mediumCsv);
assert.equal(parsedMedium.length, 1);
assert.equal(isMediumReviewRow(parsedMedium[0]!), true);
assert.match(batchRunId(2, mediumCsv), /^healthcare-sponsor-batch-002-/);
assert.equal(batchRunId(2, mediumCsv), batchRunId(2, mediumCsv));
assert.notEqual(batchRunId(1, mediumCsv), batchRunId(2, mediumCsv));

assert.throws(
  () => parseHealthcareSponsorBatchCsv(stringifyCsv([
    batchRow({ industry: "Medical" }),
  ], HEALTHCARE_SPONSOR_BATCH_COLUMNS)),
  /exact industry=Healthcare/,
);
assert.throws(
  () => parseHealthcareSponsorBatchCsv(stringifyCsv([
    batchRow({
      website_url: "https://sample-medical.example/",
      website_confidence: "high",
      website_evidence_url: "",
    }),
  ], HEALTHCARE_SPONSOR_BATCH_COLUMNS)),
  /website_evidence_url is required/,
);
assert.throws(
  () => parseHealthcareSponsorBatchCsv(stringifyCsv([
    batchRow(),
    batchRow({ organisation_name: "Duplicate ID" }),
  ], HEALTHCARE_SPONSOR_BATCH_COLUMNS)),
  /duplicate sponsor_licence_id/,
);
assert.throws(
  () => parseHealthcareSponsorBatchCsv(stringifyCsv(
    Array.from({ length: 501 }, (_, index) =>
      batchRow({ sponsor_licence_id: String(index + 1) }),
    ),
    HEALTHCARE_SPONSOR_BATCH_COLUMNS,
  )),
  /1–500 rows/,
);

console.log("healthcare sponsor website import self-test passed");