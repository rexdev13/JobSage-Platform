import { describe, expect, it } from "vitest";
import { assessSafeguarding, safeguardingBlocksEligibility } from "../lib/safeguarding";

const profile = (dbsClearanceLevel: "unknown" | "none" | "basic" | "standard" | "enhanced", safeguardingTrainingLevel: "unknown" | "none" | "level_1" | "level_2") =>
  ({ dbsClearanceLevel, safeguardingTrainingLevel }) as never;

describe("structured safeguarding assessment", () => {
  it("keeps unstated role requirements unknown without blocking eligibility", () => {
    const result = assessSafeguarding(profile("unknown", "unknown"), {
      requiredDbsClearanceLevel: null,
      requiredSafeguardingLevel: null,
    });
    expect(result.dbsStatus).toBe("unknown");
    expect(result.safeguardingStatus).toBe("unknown");
    expect(safeguardingBlocksEligibility(result)).toBe(false);
  });

  it("treats a legacy unknown role requirement as not stated", () => {
    const result = assessSafeguarding(profile("none", "none"), {
      requiredDbsClearanceLevel: "unknown",
      requiredSafeguardingLevel: "unknown",
    });
    expect(result.dbsStatus).toBe("unknown");
    expect(result.safeguardingStatus).toBe("unknown");
    expect(safeguardingBlocksEligibility(result)).toBe(false);
  });

  it("asks for profile data when a stated requirement meets an unknown candidate value", () => {
    const result = assessSafeguarding(profile("unknown", "level_2"), {
      requiredDbsClearanceLevel: "enhanced",
      requiredSafeguardingLevel: "level_2",
    });
    expect(result.dbsStatus).toBe("unknown_needs_profile");
    expect(result.safeguardingStatus).toBe("met");
    expect(safeguardingBlocksEligibility(result)).toBe(true);
  });

  it("uses ordered levels deterministically", () => {
    const result = assessSafeguarding(profile("standard", "level_1"), {
      requiredDbsClearanceLevel: "basic",
      requiredSafeguardingLevel: "level_2",
    });
    expect(result.dbsStatus).toBe("met");
    expect(result.safeguardingStatus).toBe("missing");
  });
});