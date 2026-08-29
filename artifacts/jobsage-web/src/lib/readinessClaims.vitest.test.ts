import { describe, expect, it } from "vitest";
import {
  normalizeReadinessClaim,
  requiresStructuredProfileUpdate,
  unresolvedReadinessGaps,
} from "./readinessClaims";

describe("readiness claim UI rules", () => {
  it("normalizes equivalent display text into one stable claim key", () => {
    expect(normalizeReadinessClaim("  Paediatric  First-Aid! ")).toBe("pediatric first aid");
    expect(normalizeReadinessClaim("Paediatric first aid")).toBe("pediatric first aid");
  });

  it.each([
    ["No evidence of venepuncture experience", "Venipuncture experience is not shown"],
    ["Experience with manual handling", "Manual handling experience"],
    ["Relevant medication administration skills required", "Medication administration"],
    ["Paediatric first aid and manual handling", "Manual handling and pediatric first-aid"],
  ])("canonicalizes safe wording variants: %s / %s", (first, second) => {
    expect(normalizeReadinessClaim(first)).toBe(normalizeReadinessClaim(second));
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

  it("matches legacy stored keys while keeping distinct capabilities visible", () => {
    const gaps = [
      "Manual handling experience is not shown",
      "Medication administration experience",
    ];
    expect(unresolvedReadinessGaps(gaps, new Set(["No evidence of manual handling experience"]))).toEqual([
      "Medication administration experience",
    ]);
  });

  it("does not collapse alternative and cumulative requirements", () => {
    expect(normalizeReadinessClaim("Manual handling or medication administration"))
      .not.toBe(normalizeReadinessClaim("Manual handling and medication administration"));
  });

  it("never suppresses structured gaps even if a legacy claim has the same wording", () => {
    expect(unresolvedReadinessGaps(
      ["NMC registration is missing", "Enhanced DBS is not shown"],
      new Set(["No evidence of NMC registration", "Enhanced DBS"]),
    )).toEqual(["NMC registration is missing", "Enhanced DBS is not shown"]);
  });
});