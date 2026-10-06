import { describe, expect, it } from "vitest";
import {
  planStage1OdsWebsiteUpdates,
  stage1OdsRecordUrl,
  STAGE1_ODS_WEBSITE_TARGETS,
  type Stage1OdsWebsiteRow,
} from "../../tools/stage1OdsWebsiteTargets";

function blankRows(): Stage1OdsWebsiteRow[] {
  return STAGE1_ODS_WEBSITE_TARGETS.map((target) => ({
    organisation_name: target.organisationName,
    website: null,
    website_ods_code: null,
    website_ods_record_url: null,
  }));
}

describe("Stage 1 ODS website update plan", () => {
  it("contains exactly the 18 approved, unique NHS employer targets", () => {
    expect(STAGE1_ODS_WEBSITE_TARGETS).toHaveLength(18);
    expect(new Set(STAGE1_ODS_WEBSITE_TARGETS.map((target) => target.odsCode)).size).toBe(18);
    expect(new Set(
      STAGE1_ODS_WEBSITE_TARGETS.map((target) => target.organisationName.toLocaleLowerCase("en-GB")),
    ).size).toBe(18);
    expect(STAGE1_ODS_WEBSITE_TARGETS.every((target) =>
      new URL(target.website).protocol === "https:"
    )).toBe(true);
  });

  it("plans only blank rows and attaches the direct ODS record URL", () => {
    const updates = planStage1OdsWebsiteUpdates(blankRows());
    expect(updates).toHaveLength(18);
    expect(updates[0]).toMatchObject({
      organisationName: "Manchester University NHS Foundation Trust",
      odsCode: "R0A",
      website: "https://mft.nhs.uk/",
      odsRecordUrl: stage1OdsRecordUrl("R0A"),
    });
  });

  it("rejects a missing or duplicate sponsor row", () => {
    expect(() => planStage1OdsWebsiteUpdates(blankRows().slice(1)))
      .toThrow("Expected exactly one production sponsor row");
    expect(() => planStage1OdsWebsiteUpdates([...blankRows(), blankRows()[0]!]))
      .toThrow("Expected exactly one production sponsor row");
  });

  it("rejects unexpected employers and nonblank website or evidence values", () => {
    expect(() => planStage1OdsWebsiteUpdates([
      ...blankRows(),
      {
        organisation_name: "Not an approved Stage 1 employer",
        website: null,
        website_ods_code: null,
        website_ods_record_url: null,
      },
    ])).toThrow("outside the approved Stage 1 list");

    const withWebsite = blankRows();
    withWebsite[0]!.website = "https://already-set.example/";
    expect(() => planStage1OdsWebsiteUpdates(withWebsite))
      .toThrow("Refusing to overwrite a nonblank website");

    const withEvidence = blankRows();
    withEvidence[0]!.website_ods_code = "OTHER";
    expect(() => planStage1OdsWebsiteUpdates(withEvidence))
      .toThrow("Refusing to overwrite existing website evidence");
  });
});
