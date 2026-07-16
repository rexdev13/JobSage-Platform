import { describe, it, expect } from "vitest";
import { evaluate } from "../lib/rulesEngine";
import type { RulesetRule } from "@workspace/db";
import type { Profile } from "@workspace/db";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 1,
    userId: "user-1",
    profession: "doctor",
    specialty: null,
    qualificationCountry: "United Kingdom",
    qualificationType: "MBBS",
    qualificationYear: 2015,
    experienceYears: 8,
    registrationStatus: "full",
    licenceReady: true,
    residencyStatus: "citizen",
    requiresSponsorship: false,
    currentJobTitle: null,
    currentEmployer: null,
    targetRegion: null,
    targetSector: null,
    bio: null,
    linkedinUrl: null,
    portfolioUrl: null,
    cvDocumentId: null,
    languages: null,
    skills: null,
    visaType: null,
    profileCompleteness: 80,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  } as unknown as Profile;
}

function makeRule(overrides: Partial<RulesetRule> = {}): RulesetRule {
  return {
    id: 1,
    rulesetId: 1,
    ruleKey: "uk_gmc_full",
    outcome: "eligible",
    conditions: [],
    sortOrder: 1,
    reasonCode: "GMC_FULL_REG",
    explanationText: "You are eligible.",
    pathways: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as RulesetRule;
}

describe("rulesEngine.evaluate", () => {
  it("returns not_eligible with review flag when no rules exist", () => {
    const profile = makeProfile();
    const result = evaluate(profile, []);
    expect(result.outcome).toBe("not_eligible");
    expect(result.reviewFlagged).toBe(true);
    expect(result.reasonCodes).toContain("NO_RULE_MATCHED");
  });

  it("returns eligible when a matching rule (no conditions) exists", () => {
    const profile = makeProfile();
    const rule = makeRule({ conditions: [] as unknown as RulesetRule["conditions"] });
    const result = evaluate(profile, [rule]);
    expect(result.outcome).toBe("eligible");
    expect(result.reasonCodes).toContain("GMC_FULL_REG");
  });

  it("returns not_eligible when all conditions fail", () => {
    const profile = makeProfile({ registrationStatus: "provisional" });
    const rule = makeRule({
      conditions: [{ field: "registrationStatus", operator: "eq", value: "full" }] as unknown as RulesetRule["conditions"],
    });
    const result = evaluate(profile, [rule]);
    expect(result.outcome).toBe("not_eligible");
  });

  it("matches rule with eq operator", () => {
    const profile = makeProfile({ registrationStatus: "full" });
    const rule = makeRule({
      conditions: [{ field: "registrationStatus", operator: "eq", value: "full" }] as unknown as RulesetRule["conditions"],
      outcome: "eligible",
    });
    const result = evaluate(profile, [rule]);
    expect(result.outcome).toBe("eligible");
  });

  it("matches rule with neq operator", () => {
    const profile = makeProfile({ requiresSponsorship: false });
    const rule = makeRule({
      conditions: [{ field: "requiresSponsorship", operator: "neq", value: true }] as unknown as RulesetRule["conditions"],
      outcome: "eligible",
    });
    const result = evaluate(profile, [rule]);
    expect(result.outcome).toBe("eligible");
  });

  it("matches rule with in operator", () => {
    const profile = makeProfile({ residencyStatus: "citizen" });
    const rule = makeRule({
      conditions: [{ field: "residencyStatus", operator: "in", value: ["citizen", "settled"] }] as unknown as RulesetRule["conditions"],
      outcome: "eligible",
    });
    const result = evaluate(profile, [rule]);
    expect(result.outcome).toBe("eligible");
  });

  it("rejects rule with not_in operator when value matches exclusion", () => {
    const profile = makeProfile({ residencyStatus: "visitor" });
    const rule = makeRule({
      conditions: [{ field: "residencyStatus", operator: "not_in", value: ["visitor", "tourist"] }] as unknown as RulesetRule["conditions"],
      outcome: "eligible",
    });
    const result = evaluate(profile, [rule]);
    expect(result.outcome).toBe("not_eligible");
  });

  it("matches rule with gte operator", () => {
    const profile = makeProfile({ experienceYears: 5 });
    const rule = makeRule({
      conditions: [{ field: "experienceYears", operator: "gte", value: 5 }] as unknown as RulesetRule["conditions"],
      outcome: "eligible",
    });
    const result = evaluate(profile, [rule]);
    expect(result.outcome).toBe("eligible");
  });

  it("fails rule with gte when value is too low", () => {
    const profile = makeProfile({ experienceYears: 3 });
    const rule = makeRule({
      conditions: [{ field: "experienceYears", operator: "gte", value: 5 }] as unknown as RulesetRule["conditions"],
      outcome: "eligible",
    });
    const result = evaluate(profile, [rule]);
    expect(result.outcome).toBe("not_eligible");
  });

  it("matches rule with lte operator", () => {
    const profile = makeProfile({ experienceYears: 2 });
    const rule = makeRule({
      conditions: [{ field: "experienceYears", operator: "lte", value: 3 }] as unknown as RulesetRule["conditions"],
      outcome: "not_eligible",
      reasonCode: "INSUFFICIENT_EXPERIENCE",
    });
    const result = evaluate(profile, [rule]);
    expect(result.outcome).toBe("not_eligible");
    expect(result.reasonCodes).toContain("INSUFFICIENT_EXPERIENCE");
  });

  it("matches rule with exists operator", () => {
    const profile = makeProfile({ qualificationCountry: "India" });
    const rule = makeRule({
      conditions: [{ field: "qualificationCountry", operator: "exists", value: null }] as unknown as RulesetRule["conditions"],
      outcome: "eligible",
    });
    const result = evaluate(profile, [rule]);
    expect(result.outcome).toBe("eligible");
  });

  it("returns false for exists when field is null", () => {
    const profile = makeProfile({ specialty: null });
    const rule = makeRule({
      conditions: [{ field: "specialty", operator: "exists", value: null }] as unknown as RulesetRule["conditions"],
      outcome: "eligible",
    });
    const result = evaluate(profile, [rule]);
    expect(result.outcome).toBe("not_eligible");
  });

  it("flags review when required fields are missing", () => {
    const profile = makeProfile({
      qualificationCountry: null as unknown as string,
      qualificationType: null as unknown as string,
      registrationStatus: null as unknown as string,
      residencyStatus: null as unknown as string,
    });
    const result = evaluate(profile, []);
    expect(result.reviewFlagged).toBe(true);
    expect(result.reviewNote).toContain("missing required fields");
  });

  it("flags review for unknown qualification country", () => {
    const profile = makeProfile({ qualificationCountry: "Atlantis" });
    const result = evaluate(profile, []);
    expect(result.reviewFlagged).toBe(true);
    expect(result.reviewNote).toContain("Atlantis");
  });

  it("respects sortOrder — lower order rule wins", () => {
    const profile = makeProfile({ registrationStatus: "full" });
    const ruleHigh = makeRule({
      id: 2,
      sortOrder: 1,
      conditions: [{ field: "registrationStatus", operator: "eq", value: "full" }] as unknown as RulesetRule["conditions"],
      outcome: "eligible",
      reasonCode: "FIRST_RULE",
    });
    const ruleLow = makeRule({
      id: 3,
      sortOrder: 2,
      conditions: [{ field: "registrationStatus", operator: "eq", value: "full" }] as unknown as RulesetRule["conditions"],
      outcome: "not_eligible",
      reasonCode: "SECOND_RULE",
    });
    const result = evaluate(profile, [ruleLow, ruleHigh]);
    expect(result.reasonCodes).toContain("FIRST_RULE");
    expect(result.outcome).toBe("eligible");
  });

  it("returns ineligible outcome when rule says so", () => {
    const profile = makeProfile({ residencyStatus: "visitor" });
    const rule = makeRule({
      conditions: [{ field: "residencyStatus", operator: "eq", value: "visitor" }] as unknown as RulesetRule["conditions"],
      outcome: "ineligible",
      reasonCode: "NO_RIGHT_TO_WORK",
      explanationText: "No right to work in UK.",
    });
    const result = evaluate(profile, [rule]);
    expect(result.outcome).toBe("ineligible");
    expect(result.explanationText).toBe("No right to work in UK.");
  });
});
