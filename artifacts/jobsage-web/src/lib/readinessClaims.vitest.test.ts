import { describe, expect, it } from "vitest";
import {
  normalizeReadinessClaim,
  requiresStructuredProfileUpdate,
  unresolvedReadinessGaps,
} from "./readinessClaims";

describe("readiness claim UI rules", () => {
  it("normalizes equivalent display text into one stable claim key", () => {
    expect(normalizeReadinessClaim("  Paediatric  First-Aid! ")).toBe("paediatric first aid");
    expect(normalizeReadinessClaim("Paediatric first aid")).toBe("paediatric first aid");
  });

  it.each([
    "NMC registration is missing",
    "GMC PIN is missing",
    "Professional licensure is unclear",
    "Enhanced DBS required",
    "Background check not supplied",
    "Safeguarding level 2 is not shown",
    "Right to work status is unclear",
    "Indefinite leave to remain is not shown",
    "Work authorization is unclear",
    "Requires Skilled Worker visa sponsorship",
  ])("routes regulated gap to the profile instead of self-declaring: %s", (gap) => {
    expect(requiresStructuredProfileUpdate(gap)).toBe(true);
  });

  it("keeps ordinary capabilities eligible for self-declaration", () => {
    expect(requiresStructuredProfileUpdate("No evidence of venepuncture experience")).toBe(false);
  });

  it("removes acknowledged claims without mutating the original readiness result", () => {
    const gaps = ["Venepuncture experience", "Ward management experience"];
    const result = unresolvedReadinessGaps(gaps, new Set(["venepuncture experience"]));
    expect(result).toEqual(["Ward management experience"]);
    expect(gaps).toHaveLength(2);
  });
});