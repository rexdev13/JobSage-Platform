import { describe, expect, it } from "vitest";
import {
  normalizeSponsorIdentityValue,
  resolveSponsorIdentity,
  sponsorIdentityKey,
  type SponsorIdentity,
  type SponsorIdentityTarget,
} from "../../lib/sponsorWebsiteCrossEnvIdentity";
import {
  buildSponsorWebsiteImportPlan,
  sponsorLicenceIdsForImportWrites,
  type SponsorWebsiteImportCandidate,
  type SponsorWebsiteProductionTarget,
} from "../../lib/sponsorWebsiteImportPlan";

const identity: SponsorIdentity = {
  organisationName: "St. Mary's & Sons Ltd",
  townCity: "Bristol",
  county: "Avon",
  region: "South West",
  industry: "Care",
  route: "Worker",
  subRoute: "Skilled Worker",
};

function sponsor(
  overrides: Partial<SponsorIdentityTarget & { website: string | null }> = {},
): SponsorWebsiteProductionTarget {
  return {
    id: 81,
    ...identity,
    website: null,
    ...overrides,
  };
}

function candidate(
  overrides: Partial<SponsorWebsiteImportCandidate> = {},
): SponsorWebsiteImportCandidate {
  return {
    sourceRef: "source:1",
    field: "website",
    ...identity,
    confidence: "high",
    developmentConfidence: "high",
    candidateUrl: "https://example.org/",
    evidenceUrl: "https://example.org/about",
    developmentCurrentValue: "https://example.org",
    developmentAction: "preserve_existing_same",
    verificationStatus: "",
    ...overrides,
  };
}

function makePlan(
  candidates: SponsorWebsiteImportCandidate[],
  sponsors: SponsorWebsiteProductionTarget[] = [sponsor()],
  options: {
    careersTargets?: Array<{ id: number; organisationName: string; careersUrl: string | null }>;
    mappings?: Array<{
      identityKey: string;
      targetSponsorLicenceId: number;
      resolutionMethod: "exact_unique" | "manual_review";
    }>;
  } = {},
) {
  return buildSponsorWebsiteImportPlan({
    candidates,
    sponsors,
    careersTargets: options.careersTargets ?? [],
    mappings: options.mappings ?? [],
    inputHash: "test-input",
  });
}

describe("sponsor cross-environment identity", () => {
  it("normalizes punctuation and ampersands without using database IDs", () => {
    expect(normalizeSponsorIdentityValue("St. Mary's & Sons Ltd"))
      .toBe(normalizeSponsorIdentityValue("St Marys and Sons Ltd"));
    expect(sponsorIdentityKey(identity)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("matches only a unique sponsor with location and record detail", () => {
    expect(resolveSponsorIdentity(identity, [sponsor()]).status).toBe("exact_unique");
    expect(resolveSponsorIdentity(identity, [sponsor(), sponsor({ id: 82 })]).status)
      .toBe("ambiguous");

    const sparse = { ...identity, townCity: "", county: "", region: "" };
    expect(resolveSponsorIdentity(sparse, [sponsor()]).status).toBe("incomplete_identity");
  });

  it("does not accept conflicting same-name sponsor attributes", () => {
    const conflicting = sponsor({ townCity: "Leeds" });
    expect(resolveSponsorIdentity(identity, [conflicting]).status).toBe("identity_conflict");
  });

  it("accepts an explicitly saved manual mapping only when supplied identity fields agree", () => {
    expect(resolveSponsorIdentity(identity, [sponsor()], 81).status).toBe("manual_mapping");
    expect(resolveSponsorIdentity(identity, [sponsor({ townCity: "Leeds" })], 81).status)
      .toBe("identity_conflict");
  });
});

describe("sponsor website import planning", () => {
  it("plans a high-confidence, source-agreed candidate for a blank production field", () => {
    const plan = makePlan([candidate()]);
    expect(plan.counts.safe_to_import).toBe(1);
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]?.targetSponsorLicenceId).toBe(81);
    expect(plan.exactMappings).toHaveLength(1);
  });

  it("recomputes exact matches live and only honors manually reviewed crosswalks", () => {
    const targets = [sponsor(), sponsor({ id: 82 })];
    const identityKey = sponsorIdentityKey(identity);
    const exactMapping = makePlan([candidate()], targets, {
      mappings: [{
        identityKey,
        targetSponsorLicenceId: 81,
        resolutionMethod: "exact_unique",
      }],
    });
    expect(exactMapping.writes).toHaveLength(0);
    expect(exactMapping.counts.manual_review_ambiguous_identity).toBe(1);

    const reviewedMapping = makePlan([candidate()], targets, {
      mappings: [{
        identityKey,
        targetSponsorLicenceId: 81,
        resolutionMethod: "manual_review",
      }],
    });
    expect(reviewedMapping.writes[0]?.targetSponsorLicenceId).toBe(81);
  });

  it("holds low-confidence, unverified, development-conflicting, and pilot-only rows", () => {
    const plan = makePlan([
      candidate({ sourceRef: "medium", confidence: "medium" }),
      candidate({ sourceRef: "evidence", evidenceUrl: "not a URL" }),
      candidate({ sourceRef: "dev-conflict", developmentCurrentValue: "https://other.example" }),
      candidate({
        sourceRef: "pilot",
        developmentConfidence: "medium",
        developmentAction: "review_medium",
        verificationStatus: "upgraded_to_high_in_pilot_not_imported",
      }),
    ]);
    expect(plan.writes).toHaveLength(0);
    expect(plan.counts.rejected_confidence).toBe(1);
    expect(plan.counts.manual_review_invalid_url_or_evidence).toBe(1);
    expect(plan.counts.manual_review_development_value_conflict).toBe(1);
    expect(plan.counts.manual_review_pilot_not_in_development).toBe(1);
  });

  it("never overwrites populated production values", () => {
    const plan = makePlan([candidate()], [sponsor({ website: "https://old.example" })]);
    expect(plan.writes).toHaveLength(0);
    expect(plan.counts.manual_review_existing_production_value).toBe(1);
  });

  it("reports an existing production match as a no-op even when source confidence is lower", () => {
    const plan = makePlan(
      [candidate({ confidence: "medium", developmentConfidence: "medium", developmentAction: "review_medium" })],
      [sponsor({ website: "https://example.org" })],
    );
    expect(plan.writes).toHaveLength(0);
    expect(plan.counts.already_matches_production_noop).toBe(1);
  });

  it("holds competing candidate URLs and coalesces exact duplicates", () => {
    const conflict = makePlan([
      candidate({ sourceRef: "one" }),
      candidate({
        sourceRef: "two",
        candidateUrl: "https://different.example",
        developmentCurrentValue: "https://different.example",
      }),
    ]);
    expect(conflict.writes).toHaveLength(0);
    expect(conflict.counts.manual_review_target_url_collision).toBe(2);

    const duplicate = makePlan([
      candidate({ sourceRef: "one" }),
      candidate({ sourceRef: "two" }),
    ]);
    expect(duplicate.writes).toHaveLength(1);
    expect(duplicate.counts.safe_to_import).toBe(1);
    expect(duplicate.counts.duplicate_candidate_same_target_noop).toBe(1);
  });

  it("does not let a lower-confidence URL silently compete with a safe write", () => {
    const plan = makePlan([
      candidate({ sourceRef: "high" }),
      candidate({
        sourceRef: "medium",
        confidence: "medium",
        developmentConfidence: "medium",
        developmentAction: "review_medium",
        candidateUrl: "https://different.example",
        developmentCurrentValue: "https://different.example",
      }),
    ]);
    expect(plan.writes).toHaveLength(0);
    expect(plan.counts.manual_review_target_url_collision).toBe(2);
  });

  it("matches careers URLs only to a unique employer careers record", () => {
    const careersCandidate = candidate({ field: "careers" });
    const unique = makePlan([careersCandidate], [sponsor()], {
      careersTargets: [{ id: 902, organisationName: "St Marys and Sons Ltd", careersUrl: null }],
    });
    expect(unique.writes[0]?.targetCompanySiteCheckId).toBe(902);
    expect(sponsorLicenceIdsForImportWrites(unique.writes)).toEqual([81]);

    const ambiguous = makePlan([careersCandidate], [sponsor()], {
      careersTargets: [
        { id: 902, organisationName: "St Marys and Sons Ltd", careersUrl: null },
        { id: 903, organisationName: "St. Mary's & Sons Ltd", careersUrl: null },
      ],
    });
    expect(ambiguous.writes).toHaveLength(0);
    expect(ambiguous.counts.manual_review_careers_target).toBe(1);
  });
});