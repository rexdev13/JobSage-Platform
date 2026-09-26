import assert from "node:assert/strict";
import {
  atsDetails,
  explicitSampleVacancy,
  normalizeRoutingName,
  selectRoutingRows,
} from "./vacancySourceRoutingBatch";

function sponsor(
  id: string,
  name: string,
  industry = "Healthcare",
  town = "Leeds",
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    sponsor_licence_id: id,
    organisation_name: name,
    normalized_organisation_name: normalizeRoutingName(name),
    town_city: town,
    county: "",
    industry,
    existing_website: "",
    existing_careers_url: "",
    existing_ats_provider: "",
    existing_ats_board_id: "",
    existing_ats_mapping_status: "",
    website_confidence: "",
    careers_confidence: "",
    last_company_site_error: "",
    ...extra,
  };
}

const sourceRows = [
  sponsor("1", "Cedar Care Home"),
  sponsor("1", "Duplicate ID should be ignored"),
  sponsor("2", "Already Sourced Clinic", "Healthcare", "York", {
    existing_website: "https://already-sourced.example",
    existing_careers_url: "https://already-sourced.example/careers",
    existing_ats_provider: "Example ATS",
    existing_ats_board_id: "already-sourced",
  }),
  sponsor("3", "Prior Failure Nursing Home", "Healthcare", "Bristol", {
    last_company_site_error: "robots.txt disallows careers page",
  }),
  sponsor("", "Fallback Medical Centre", "Healthcare", "Bath"),
  sponsor("", " Fallback Medical Centre ", "Healthcare", " bath "),
  sponsor("4", "Social Care Employer", "Social Care"),
];

const previousRows = [sponsor("1", "Cedar Care Home")];
const selection = selectRoutingRows(
  sourceRows,
  "Healthcare",
  2,
  0,
  previousRows,
);

assert.equal(selection.exactSectorRows.length, 6);
assert.equal(selection.uniqueSectorRows.length, 4);
assert.equal(selection.duplicateIds, 1);
assert.equal(selection.duplicateFallbackKeys, 1);
assert.equal(selection.skippedPreviouslyProcessed, 1);
assert.equal(selection.selectedWithPriorSiteError, 1);
assert.deepEqual(
  selection.selectedRows.map((row) => row.sponsor_licence_id || row.organisation_name.trim()),
  ["3", "Fallback Medical Centre"],
);

const override = selectRoutingRows(
  sourceRows,
  "Healthcare",
  3,
  0,
  previousRows,
  true,
);
assert.equal(override.skippedPreviouslyProcessed, 0);
assert.ok(override.selectedRows.some((row) => row.sponsor_licence_id === "1"));

assert.deepEqual(
  atsDetails("https://jobs.ashbyhq.com/cedar-care"),
  { provider: "Ashby", boardId: "cedar-care", platformConfirmed: true },
);
assert.deepEqual(
  atsDetails("https://careers.smartrecruiters.com/cedardental"),
  { provider: "SmartRecruiters", boardId: "cedardental", platformConfirmed: true },
);
assert.deepEqual(
  atsDetails("https://intasaccordcareers.com/accordemena/"),
  {
    provider: "Accord Healthcare careers portal (underlying platform unconfirmed)",
    boardId: "",
    platformConfirmed: false,
  },
);
assert.equal(atsDetails("https://random-careers.example/jobs"), null);
assert.equal(
  atsDetails("http://jobs.ashbyhq.com/cedar-care"),
  null,
  "non-HTTPS board URLs must not be treated as verified ATS routes",
);
assert.equal(explicitSampleVacancy("https://example.org/jobs/"), false);
assert.equal(explicitSampleVacancy("https://example.org/careers"), false);
assert.equal(
  explicitSampleVacancy("https://example.org/jobs/healthcare-assistant-12345"),
  true,
);
assert.equal(
  explicitSampleVacancy("https://www.indeed.com/viewjob?jk=abc1234"),
  true,
);

console.log("vacancy source routing batch self-test passed");