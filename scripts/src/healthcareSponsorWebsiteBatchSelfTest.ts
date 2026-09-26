import assert from "node:assert/strict";
import {
  HEALTHCARE_BATCH_COLUMNS,
  selectSponsorListLead,
  selectHealthcareRows,
} from "./healthcareSponsorWebsiteBatch";

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
    normalized_organisation_name: name.toLowerCase(),
    town_city: town,
    industry,
    existing_website: "",
    existing_careers_url: "",
    existing_ats_provider: "",
    existing_ats_board_id: "",
    existing_ats_mapping_status: "",
    existing_ats_mapping_evidence_url: "",
    ...extra,
  };
}

const rows = [
  sponsor("1", "Dental One"),
  sponsor("1", "Dental One duplicate ID"),
  sponsor("2", "Care Ltd", "Social Care"),
  sponsor("3", "Already Has Website", "Healthcare", "York", { existing_website: "https://example.org" }),
  sponsor("", "No ID", "Healthcare", "Leeds"),
  sponsor("", "No ID", "Healthcare", " leeds "),
  sponsor("", "No ID", "Healthcare", "York"),
];

const selected = selectHealthcareRows(rows, 500);
assert.equal(selected.exactHealthcareRows.length, 6);
assert.equal(selected.duplicateIds, 1);
assert.equal(selected.duplicateEntityKeys, 1);
assert.equal(selected.repeatedNameTownPairs, 1);
assert.equal(selected.needsEnrichmentRows.length, 3);
assert.equal(selected.selectedRows.length, 3);
assert.deepEqual(
  selected.selectedRows.map((row) => row.organisation_name),
  ["Dental One", "No ID", "No ID"],
);
assert.equal(HEALTHCARE_BATCH_COLUMNS[0], "sponsor_licence_id");
assert.equal(HEALTHCARE_BATCH_COLUMNS[6], "industry");
assert.equal(HEALTHCARE_BATCH_COLUMNS.at(-1), "notes");
assert.throws(() => selectHealthcareRows(rows, 501), /between 1 and 500/);
assert.throws(() => selectHealthcareRows(rows, 10, -1), /non-negative/);

const priorityRows = [
  sponsor("20", "Blocked Medical Clinic", "Healthcare", "London", {
    notes: "candidate website could not be safely checked: robots.txt disallows this page",
  }),
  sponsor("21", "Cedar Care Home Leeds", "Healthcare", "Leeds"),
  sponsor("22", "York Medical Centre", "Healthcare", "York"),
  sponsor("23", "No Town Nursing Home", "Healthcare", ""),
  sponsor("24", "Duplicate Clinic", "Healthcare", "York"),
  sponsor("25", "Duplicate Clinic", "Healthcare", "Leeds"),
  sponsor("26", "Blocked Medical Clinic", "Healthcare", "York"),
];
const priority = selectHealthcareRows(priorityRows, 4, 0, {
  previousBatchRows: [priorityRows[0]!],
  targetHealthcareLocation: true,
});
const nextSourceSlice = selectHealthcareRows(priorityRows, 2, 0, {
  previousBatchRows: [priorityRows[0]!],
});
assert.equal(priority.selectionMode, "targeted-healthcare-location");
assert.equal(priority.previouslyProcessedRowsExcluded, 1);
assert.equal(priority.targeting?.excludedPriorFailureRows, 1);
assert.equal(priority.targeting?.priorFailureEmployerNames, 1);
assert.deepEqual(
  priority.selectedRows.map((row) => row.organisation_name),
  ["Cedar Care Home Leeds", "York Medical Centre", "No Town Nursing Home", "Duplicate Clinic"],
);
assert.equal(priority.targeting?.selectedMeetingAllFocusCriteria, 2);
assert.deepEqual(
  nextSourceSlice.selectedRows.map((row) => row.sponsor_licence_id),
  ["21", "22"],
);

const sponsorListRecords = [
  {
    name: "Abbey Dale Medical Centre",
    city: "Blackpool",
    county: "Lancashire",
    url: "https://sponsorlist.co.uk/sponsors/abbey-dale-medical-centre/",
    enrichment: { website: "https://www.abbey-dale.co.uk/" },
  },
  {
    name: "Abbey Dale Medical Centre",
    city: "Oxford",
    url: "https://sponsorlist.co.uk/sponsors/abbey-dale-oxford/",
    enrichment: { website: "https://unrelated.example/" },
  },
];
assert.deepEqual(
  selectSponsorListLead(
    sponsor("10", "Abbey Dale Medical Centre", "Healthcare", "Blackpool", { county: "Lancashire" }),
    sponsorListRecords,
  ),
  {
    website: "https://www.abbey-dale.co.uk/",
    evidenceUrl: "https://sponsorlist.co.uk/sponsors/abbey-dale-medical-centre/",
  },
);
assert.equal(
  selectSponsorListLead(
    sponsor("11", "Abbey Dale Medical Centre", "Healthcare", "Bristol"),
    sponsorListRecords,
  ),
  null,
);
assert.equal(
  selectSponsorListLead(
    sponsor("12", "Abbey Dental Centre", "Healthcare", "Blackpool"),
    sponsorListRecords,
  ),
  null,
);
console.log("healthcare sponsor website batch self-test passed");
