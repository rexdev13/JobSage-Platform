import { describe, it, expect } from "vitest";
import { deriveIslandStates, activeStepNumber } from "./journeySteps";

describe("deriveIslandStates", () => {
  it("all false — step 1 active, rest locked", () => {
    const islands = deriveIslandStates({ hasProfile: false, hasCv: false, hasEligibilityDecision: false, hasApplications: false });
    expect(islands.map((i) => i.status)).toEqual(["active", "locked", "locked", "locked", "locked"]);
    expect(activeStepNumber(islands)).toBe(1);
  });

  it("profile only — step 2 active, rest locked", () => {
    const islands = deriveIslandStates({ hasProfile: true, hasCv: false, hasEligibilityDecision: false, hasApplications: false });
    expect(islands.map((i) => i.status)).toEqual(["complete", "active", "locked", "locked", "locked"]);
    expect(activeStepNumber(islands)).toBe(2);
  });

  it("profile + cv — step 3 active", () => {
    const islands = deriveIslandStates({ hasProfile: true, hasCv: true, hasEligibilityDecision: false, hasApplications: false });
    expect(islands.map((i) => i.status)).toEqual(["complete", "complete", "active", "locked", "locked"]);
    expect(activeStepNumber(islands)).toBe(3);
  });

  it("profile + cv + eligibility — step 4 active", () => {
    const islands = deriveIslandStates({ hasProfile: true, hasCv: true, hasEligibilityDecision: true, hasApplications: false });
    expect(islands.map((i) => i.status)).toEqual(["complete", "complete", "complete", "active", "locked"]);
    expect(activeStepNumber(islands)).toBe(4);
  });

  it("all four done — dream island active", () => {
    const islands = deriveIslandStates({ hasProfile: true, hasCv: true, hasEligibilityDecision: true, hasApplications: true });
    expect(islands.map((i) => i.status)).toEqual(["complete", "complete", "complete", "complete", "active"]);
    expect(activeStepNumber(islands)).toBe(5);
  });

  it("cv=true but profile=false — still step 1 active (strict ordering)", () => {
    const islands = deriveIslandStates({ hasProfile: false, hasCv: true, hasEligibilityDecision: false, hasApplications: false });
    expect(islands.map((i) => i.status)).toEqual(["active", "locked", "locked", "locked", "locked"]);
    expect(activeStepNumber(islands)).toBe(1);
  });

  it("eligibility=true but no profile or cv — still step 1 active", () => {
    const islands = deriveIslandStates({ hasProfile: false, hasCv: false, hasEligibilityDecision: true, hasApplications: false });
    expect(islands.map((i) => i.status)).toEqual(["active", "locked", "locked", "locked", "locked"]);
    expect(activeStepNumber(islands)).toBe(1);
  });

  it("applications=true but profile=false — still step 1 active", () => {
    const islands = deriveIslandStates({ hasProfile: false, hasCv: false, hasEligibilityDecision: false, hasApplications: true });
    expect(islands.map((i) => i.status)).toEqual(["active", "locked", "locked", "locked", "locked"]);
    expect(activeStepNumber(islands)).toBe(1);
  });

  it("profile + eligibility=true but cv=false — step 2 active (cv blocks 3+)", () => {
    const islands = deriveIslandStates({ hasProfile: true, hasCv: false, hasEligibilityDecision: true, hasApplications: false });
    expect(islands.map((i) => i.status)).toEqual(["complete", "active", "locked", "locked", "locked"]);
    expect(activeStepNumber(islands)).toBe(2);
  });
});
