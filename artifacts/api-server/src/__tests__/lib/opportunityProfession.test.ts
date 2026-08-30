import { describe, expect, it } from "vitest";
import { regulatorForProfession } from "../../lib/opportunityProfession";

describe("opportunity profession mapping", () => {
  it.each([
    ["clinical academic", "GMC"],
    ["allied-health-professional", "HCPC"],
    ["teacher", "EDUCATION"],
    ["teaching", "EDUCATION"],
    ["engineer", "ENGINEERING"],
    ["engineering", "ENGINEERING"],
  ])("maps %s to %s", (profession, expected) => {
    expect(regulatorForProfession(profession)).toBe(expected);
  });
});