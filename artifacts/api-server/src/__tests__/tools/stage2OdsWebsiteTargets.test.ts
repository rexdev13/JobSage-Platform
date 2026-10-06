import { describe, expect, it } from "vitest";
import {
  buildStage2OdsWritePlan,
  classifyStage2OdsCandidates,
  normalizeOdsExactName,
  planStage2OdsWebsiteUpdates,
  type OdsDetailSnapshotEntry,
  type OdsTrustSummary,
  type Stage2OdsCandidate,
  type Stage2OdsWritePlan,
} from "../../tools/stage2OdsWebsiteTargets";

const recordName = "King's Community NHS Trust";

function candidate(overrides: Partial<Stage2OdsCandidate> = {}): Stage2OdsCandidate {
  return {
    id: "42",
    organisation_name: recordName,
    town_city: "London",
    county: "London",
    region: "London",
    industry: "Healthcare",
    website: "",
    website_ods_code: "",
    website_ods_record_url: "",
    ...overrides,
  };
}

function summary(overrides: Partial<OdsTrustSummary> = {}): OdsTrustSummary {
  return {
    Name: recordName,
    OrgId: "R42",
    Status: "Active",
    PrimaryRoleId: "RO197",
    PrimaryRoleDescription: "NHS TRUST",
    OrgLink: "https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/R42",
    ...overrides,
  };
}

function detail(overrides: Partial<OdsDetailSnapshotEntry["record"]> = {}): OdsDetailSnapshotEntry {
  return {
    code: "R42",
    record: {
      Name: recordName,
      Status: "Active",
      OrgId: { extension: "R42" },
      Roles: { Role: { id: "RO197", Status: "Active" } },
      GeoLoc: { Location: { Town: "London" } },
      Contacts: { Contact: { type: "http", value: "https://kingstrust.nhs.uk/" } },
      ...overrides,
    },
  };
}

describe("Stage 2 NHS ODS candidate assessment", () => {
  it("accepts punctuation-equivalent exact names but preserves suffix differences", () => {
    expect(normalizeOdsExactName("Kings Community NHS Trust"))
      .toBe(normalizeOdsExactName("King’s Community NHS Trust"));
    const clean = classifyStage2OdsCandidates(
      [candidate({ organisation_name: "Kings Community NHS Trust" })],
      [summary()],
      [detail()],
    );
    expect(clean[0]?.classification).toBe("CLEAN");

    const noMatch = classifyStage2OdsCandidates(
      [candidate({ organisation_name: "Oxford University Hospitals NHS Trust" })],
      [summary({ Name: "Oxford University Hospitals NHS Foundation Trust" })],
      [detail({ Name: "Oxford University Hospitals NHS Foundation Trust" })],
    );
    expect(noMatch[0]?.classification).toBe("NO_MATCH");
  });

  it("holds HTTP-only ODS websites and reports town conflicts", () => {
    const httpOnly = classifyStage2OdsCandidates(
      [candidate()],
      [summary()],
      [detail({
        Contacts: { Contact: { type: "http", value: "http://kingstrust.nhs.uk/" } },
      })],
    );
    expect(httpOnly[0]?.classification).toBe("HELD");
    expect(httpOnly[0]?.reason).toContain("no valid HTTPS website");

    const locationConflict = classifyStage2OdsCandidates(
      [candidate({ town_city: "Newcastle upon Tyne" })],
      [summary()],
      [detail()],
    );
    expect(locationConflict[0]?.classification).toBe("CONFLICT");
    expect(locationConflict[0]?.reason).toContain("Location mismatch");
  });

  it("retains explicitly named non-write examples outside the clean set", () => {
    const held = classifyStage2OdsCandidates(
      [candidate()],
      [summary()],
      [detail()],
      ["King’s Community NHS Trust"],
    );
    expect(held[0]?.classification).toBe("HELD");
    expect(held[0]?.explicitNonWriteHold).toBe(true);

    const explicitNoMatch = classifyStage2OdsCandidates(
      [candidate({ organisation_name: "Oxford University Hospitals NHS Trust" })],
      [summary()],
      [detail()],
      ["Oxford University Hospitals NHS Trust"],
    );
    expect(explicitNoMatch[0]?.classification).toBe("NO_MATCH");
    expect(explicitNoMatch[0]?.reason).toContain("explicitly named");
  });

  it("builds a plan only when the audited rows match the writer snapshot and all three fields are blank", () => {
    const assessments = classifyStage2OdsCandidates(
      [candidate()],
      [summary()],
      [detail()],
    );
    const built = buildStage2OdsWritePlan(
      assessments,
      [{
        id: "42",
        organisation_name: recordName,
        website: "",
        website_ods_code: "",
        website_ods_record_url: "",
      }],
      "2026-10-06T12:00:00.000Z",
    );
    expect(built.plan.targets).toHaveLength(1);
    expect(built.plan.targets[0]).toMatchObject({
      odsCode: "R42",
      expectedRowCount: 1,
    });
  });
});

describe("Stage 2 guarded production selection", () => {
  const validPlan: Stage2OdsWritePlan = {
    version: 1,
    generatedAt: "2026-10-06T12:00:00.000Z",
    targets: [{
      organisationName: recordName,
      odsName: recordName,
      odsCode: "R42",
      website: "https://kingstrust.nhs.uk/",
      odsRecordUrl: "https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/R42",
      expectedRowCount: 2,
    }],
  };
  const blankRows = [
    { organisation_name: recordName, website: null, website_ods_code: null, website_ods_record_url: null },
    { organisation_name: recordName, website: null, website_ods_code: null, website_ods_record_url: null },
  ];

  it("allows exactly the planned duplicate rows when all evidence fields are blank", () => {
    expect(planStage2OdsWebsiteUpdates(validPlan, blankRows)).toEqual(validPlan.targets);
  });

  it("rejects missing, extra, or nonblank target rows", () => {
    expect(() => planStage2OdsWebsiteUpdates(validPlan, blankRows.slice(0, 1)))
      .toThrow("Expected 2 production sponsor rows");
    expect(() => planStage2OdsWebsiteUpdates(validPlan, [
      ...blankRows,
      { organisation_name: "Unapproved Trust", website: null, website_ods_code: null, website_ods_record_url: null },
    ])).toThrow("outside the approved Stage 2 list");
    expect(() => planStage2OdsWebsiteUpdates(validPlan, [
      { ...blankRows[0]!, website_ods_code: "EXISTING" },
      blankRows[1]!,
    ])).toThrow("Refusing to overwrite");
  });

  it("rejects an ODS target whose legal name or official URL does not agree", () => {
    expect(() => planStage2OdsWebsiteUpdates({
      ...validPlan,
      targets: [{ ...validPlan.targets[0]!, odsName: "King's Community NHS Foundation Trust" }],
    }, blankRows)).toThrow("not an exact normalized match");
    expect(() => planStage2OdsWebsiteUpdates({
      ...validPlan,
      targets: [{ ...validPlan.targets[0]!, odsRecordUrl: "https://example.com/R42" }],
    }, blankRows)).toThrow("unexpected ODS record URL");
  });
});
