import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  runProductionSponsorUrlResolver,
  type CsvRecord,
  type ProductionApplyAudit,
  type ProductionCareersTarget,
  type ProductionIdentityMapping,
  type ProductionSponsorTarget,
} from "./productionSponsorUrlResolverCore";
import { normalizeSponsorIdentityValue } from "./sponsorUrlResolverNormalization";

function source(overrides: Partial<CsvRecord> = {}): CsvRecord {
  return {
    source_ref: "source:1:website",
    field: "website",
    confidence: "high",
    development_confidence: "high",
    organisation_name: "Acme Health Ltd",
    town_city: "Bristol",
    county: "Avon",
    region: "South West",
    industry: "Healthcare",
    route: "Worker",
    sub_route: "Skilled Worker",
    candidate_url: "https://acme.example/",
    evidence_url: "https://acme.example/about",
    development_current_value: "https://acme.example",
    development_action: "update_blank",
    verification_status: "",
    verification_evidence: "",
    ...overrides,
  };
}

function sponsor(overrides: Partial<ProductionSponsorTarget> = {}): ProductionSponsorTarget {
  return {
    production_sponsor_id: "81",
    organisation_name: "Acme Health Ltd",
    town_city: "Bristol",
    county: "Avon",
    region: "South West",
    industry: "Healthcare",
    route: "Worker",
    sub_route: "Skilled Worker",
    website: "",
    ...overrides,
  };
}

function careersTarget(overrides: Partial<ProductionCareersTarget> = {}): ProductionCareersTarget {
  return {
    production_company_site_check_id: "901",
    organisation_name: "Acme Health Ltd",
    careers_url: "",
    ...overrides,
  };
}

function audit(rowCount: number, websiteUpdates = rowCount): ProductionApplyAudit {
  return {
    createdAt: "2026-09-27T18:52:04.939521+00:00",
    action: "sponsor_website_import_applied",
    target: "plan:" + "a".repeat(64),
    details: {
      rowCount,
      websiteUpdates,
      careersUpdates: 0,
      safeTargetWrites: websiteUpdates,
      mappingsStored: 0,
      counts: { safe_to_import: rowCount },
    },
  };
}

function run(
  rows: CsvRecord[],
  sponsors: ProductionSponsorTarget[] = [sponsor()],
  careers: ProductionCareersTarget[] = [],
  mappings: ProductionIdentityMapping[] = [],
  websiteUpdates = rows.length,
) {
  return runProductionSponsorUrlResolver({
    audit: audit(rows.length, websiteUpdates),
    reconciliationRows: rows,
    sponsors,
    careersTargets: careers,
    mappings,
  });
}

function manualMapping(sourceRow: CsvRecord, targetId: string): ProductionIdentityMapping {
  const identitySnapshot = {
    organisationName: normalizeSponsorIdentityValue(sourceRow.organisation_name),
    townCity: normalizeSponsorIdentityValue(sourceRow.town_city),
    county: normalizeSponsorIdentityValue(sourceRow.county),
    region: normalizeSponsorIdentityValue(sourceRow.region),
    industry: normalizeSponsorIdentityValue(sourceRow.industry),
    route: normalizeSponsorIdentityValue(sourceRow.route),
    subRoute: normalizeSponsorIdentityValue(sourceRow.sub_route),
  };
  return {
    identity_key: createHash("sha256").update(JSON.stringify(identitySnapshot), "utf8").digest("hex"),
    identity_snapshot: JSON.stringify(identitySnapshot),
    target_sponsor_licence_id: targetId,
    resolution_method: "manual_review",
  };
}

function classification(rows: CsvRecord[], sponsors?: ProductionSponsorTarget[], careers?: ProductionCareersTarget[]) {
  return run(rows, sponsors, careers).results.map((item) => item.classification);
}

const identityCandidate = source({
  field: "careers",
  candidate_url: "https://acme.example/careers",
  evidence_url: "https://acme.example/",
  development_current_value: "https://acme.example/careers",
});

assert.deepEqual(
  classification(
    [identityCandidate],
    [
      sponsor({ production_sponsor_id: "81", website: "https://acme.example/" }),
      sponsor({ production_sponsor_id: "82", website: "https://different.example/" }),
    ],
    [careersTarget()],
  ),
  ["safe_auto_resolve"],
  "one strong official-domain match resolves an otherwise ambiguous identity",
);

assert.deepEqual(
  classification(
    [identityCandidate],
    [
      sponsor({ production_sponsor_id: "81", website: "https://acme.example/" }),
      sponsor({ production_sponsor_id: "82", website: "https://www.acme.example/" }),
    ],
    [careersTarget()],
  ),
  ["safe_auto_resolve"],
  "identical complete sponsor rows resolve as a group despite sharing the same official host",
);

assert.deepEqual(
  classification(
    [source({ organisation_name: "Acme Health Ltd." })],
    [sponsor({ organisation_name: "Acme Health Limited" })],
  ),
  ["safe_auto_resolve"],
  "a trailing Ltd/Limited variant is a harmless name difference",
);

assert.deepEqual(
  classification(
    [source({ town_city: "Leeds" })],
    [sponsor()],
  ),
  ["needs_manual_identity_resolution"],
  "a real location conflict is not normalized away",
);

assert.deepEqual(
  classification(
    [source({ candidate_url: "https://new.example/", evidence_url: "https://new.example/about", development_current_value: "https://new.example/" })],
    [sponsor({ website: "https://existing.example/" })],
  ),
  ["needs_manual_url_conflict_review"],
  "a different existing production URL is never overwritten",
);

assert.deepEqual(
  classification(
    [source({ confidence: "low", development_confidence: "low", development_action: "review_low" })],
    [sponsor()],
  ),
  ["needs_manual_low_confidence_review"],
  "low-confidence website URLs are not upgraded without independent first-party evidence",
);

assert.deepEqual(
  classification(
    [identityCandidate],
    [sponsor({ website: "https://acme.example/" })],
    [careersTarget()],
  ),
  ["safe_auto_resolve"],
  "a first-party careers page can be upgraded when the current production website owns its host",
);

assert.deepEqual(
  classification(
    [source({
      field: "careers",
      confidence: "low",
      development_confidence: "medium",
      candidate_url: "https://acme.example/careers",
      evidence_url: "https://acme.example/about",
      development_current_value: "https://acme.example/careers",
      development_action: "review_medium",
    })],
    [sponsor({ website: "https://acme.example/" })],
    [careersTarget()],
  ),
  ["safe_auto_resolve"],
  "low-confidence careers evidence is upgraded only when the production sponsor owns the host and the path is explicitly career-related",
);

assert.deepEqual(
  classification(
    [source({
      field: "careers",
      confidence: "low",
      development_confidence: "medium",
      candidate_url: "https://acme.example/treatment/nose-job",
      evidence_url: "https://acme.example/about",
      development_current_value: "https://acme.example/treatment/nose-job",
      development_action: "review_medium",
    })],
    [sponsor({ website: "https://acme.example/" })],
    [careersTarget()],
  ),
  ["needs_manual_low_confidence_review"],
  "a shared official host does not turn an unrelated page into a careers URL",
);

assert.deepEqual(
  classification(
    [source({
      field: "careers",
      candidate_url: "https://acme.example/news/job-vacancies",
      evidence_url: "https://acme.example/about",
      development_current_value: "https://acme.example/news/job-vacancies",
    })],
    [sponsor({ website: "https://acme.example/" })],
    [careersTarget()],
  ),
  ["needs_manual_low_confidence_review"],
  "an editorial/news destination is not accepted as a careers URL solely because its slug says job vacancies",
);

assert.deepEqual(
  classification(
    [source({
      field: "careers",
      candidate_url: "https://jobs.acme.example/openings",
      evidence_url: "https://acme.example/careers",
      development_current_value: "https://jobs.acme.example/openings",
      verification_evidence: "ATS link verified from the official employer careers page: jobs.acme.example",
    })],
    [sponsor({ website: "https://acme.example/" })],
    [careersTarget()],
  ),
  ["safe_auto_resolve"],
  "an external ATS host requires an explicit verified link note",
);

assert.deepEqual(
  classification(
    [identityCandidate],
    [sponsor({ website: "https://acme.example/" })],
    [],
  ),
  ["unresolved_due_to_missing_data"],
  "a careers URL is not written when no production careers-site target exists",
);

assert.deepEqual(
  classification(
    [identityCandidate],
    [
      sponsor({ production_sponsor_id: "81" }),
      sponsor({ production_sponsor_id: "82" }),
    ],
    [careersTarget()],
  ),
  ["safe_auto_resolve"],
  "an identical complete sponsor group can share one unique careers-site target",
);
const identicalCareerGroup = run(
  [identityCandidate],
  [sponsor({ production_sponsor_id: "81" }), sponsor({ production_sponsor_id: "82" })],
  [careersTarget()],
);
assert.deepEqual(identicalCareerGroup.results[0]?.resolvedSponsorIds, ["81", "82"]);
assert.equal(identicalCareerGroup.results[0]?.resolvedCareersId, "901");

assert.equal(
  classification(
    [source({
      field: "careers",
      candidate_url: "https://acme.example/careers",
      evidence_url: "https://acme.example/",
      development_current_value: "https://acme.example/careers",
      county: "",
    })],
    [
      sponsor({ production_sponsor_id: "81" }),
      sponsor({ production_sponsor_id: "82", county: "Somerset" }),
    ],
    [careersTarget()],
  )[0],
  "needs_manual_identity_resolution",
  "non-identical ambiguous sponsor identities remain held",
);

const groupWithExistingMatch = run(
  [source()],
  [
    sponsor({ production_sponsor_id: "81" }),
    sponsor({ production_sponsor_id: "82", website: "https://acme.example" }),
  ],
  [],
  [],
  1,
);
assert.equal(groupWithExistingMatch.results[0]?.classification, "safe_auto_resolve");
assert.deepEqual(groupWithExistingMatch.results[0]?.resolvedSponsorIds, ["81", "82"]);

const groupWithConflict = run(
  [source()],
  [
    sponsor({ production_sponsor_id: "81" }),
    sponsor({ production_sponsor_id: "82", website: "https://old.example" }),
  ],
);
assert.equal(groupWithConflict.results[0]?.classification, "needs_manual_url_conflict_review");

const mappedSource = source({ source_ref: "mapped:1" });
const selectedMapping = manualMapping(mappedSource, "82");
const mappedGroup = run(
  [mappedSource],
  [sponsor({ production_sponsor_id: "81" }), sponsor({ production_sponsor_id: "82" })],
  [],
  [selectedMapping],
);
assert.equal(mappedGroup.results[0]?.classification, "safe_auto_resolve");
assert.deepEqual(mappedGroup.results[0]?.resolvedSponsorIds, ["82"]);

const incompatibleMapping = run(
  [mappedSource],
  [sponsor({ production_sponsor_id: "82", town_city: "Leeds" })],
  [],
  [selectedMapping],
);
assert.equal(incompatibleMapping.results[0]?.classification, "needs_manual_identity_resolution");

const currentNoop = run(
  [source({ confidence: "low", development_confidence: "low" })],
  [sponsor({ website: "https://acme.example" })],
);
assert.equal(currentNoop.results[0]?.classification, "safe_noop_already_done");

const whitespaceProductionValue = run(
  [source()],
  [sponsor({ website: "   " })],
);
assert.equal(
  whitespaceProductionValue.results[0]?.classification,
  "needs_manual_url_conflict_review",
  "whitespace-only production values are not considered blank write targets",
);

const duplicateRows = run([
  source({ source_ref: "duplicate:1" }),
  source({ source_ref: "duplicate:2" }),
]);
assert.equal(duplicateRows.counts.safe_auto_resolve, 1);
assert.equal(duplicateRows.counts.safe_noop_already_done, 1);

const invalidAudit = audit(1);
invalidAudit.details.counts = { safe_to_import: 0 };
assert.throws(
  () => runProductionSponsorUrlResolver({
    audit: invalidAudit,
    reconciliationRows: [source()],
    sponsors: [sponsor()],
    careersTargets: [],
  }),
  /reason counts total/,
);

console.log("Production sponsor URL resolver self-tests passed.");