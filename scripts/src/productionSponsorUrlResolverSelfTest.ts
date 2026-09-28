import assert from "node:assert/strict";
import {
  runProductionSponsorUrlResolver,
  type CsvRecord,
  type ProductionApplyAudit,
  type ProductionCareersTarget,
  type ProductionSponsorTarget,
} from "./productionSponsorUrlResolverCore";

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

function audit(rowCount: number): ProductionApplyAudit {
  return {
    createdAt: "2026-09-27T18:52:04.939521+00:00",
    action: "sponsor_website_import_applied",
    target: "plan:" + "a".repeat(64),
    details: {
      rowCount,
      websiteUpdates: rowCount,
      careersUpdates: 0,
      mappingsStored: 0,
      counts: { safe_to_import: rowCount },
    },
  };
}

function run(
  rows: CsvRecord[],
  sponsors: ProductionSponsorTarget[] = [sponsor()],
  careers: ProductionCareersTarget[] = [],
) {
  return runProductionSponsorUrlResolver({
    audit: audit(rows.length),
    reconciliationRows: rows,
    sponsors,
    careersTargets: careers,
  });
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
  ["needs_manual_identity_resolution"],
  "multiple equally strong official-domain matches remain manual",
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
  ["needs_manual_identity_resolution"],
  "a careers target is not used while sponsor identity remains unresolved",
);

const currentNoop = run(
  [source({ confidence: "low", development_confidence: "low" })],
  [sponsor({ website: "https://acme.example" })],
);
assert.equal(currentNoop.results[0]?.classification, "safe_noop_already_done");

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