import { describe, expect, it } from "vitest";
import {
  CAREER_PROFILE_MAKER_DESCRIPTION,
  CAREER_PROFILE_MAKER_LABEL,
  CAREER_PROFILE_MAKER_REVIEW_WARNING,
  CV_ENHANCEMENT_LABEL,
} from "./careerProfileMakerCopy";

describe("CV maker and enhancer UI distinction", () => {
  it("uses separate labels and explains the factual review gate", () => {
    expect(CAREER_PROFILE_MAKER_LABEL).toBe("AI CV Maker");
    expect(CV_ENHANCEMENT_LABEL).toBe("AI CV Enhancement");
    expect(CAREER_PROFILE_MAKER_LABEL).not.toBe(CV_ENHANCEMENT_LABEL);
    expect(CAREER_PROFILE_MAKER_DESCRIPTION).toContain("new factual draft");
    expect(CAREER_PROFILE_MAKER_DESCRIPTION).toContain("never evidence");
    expect(CAREER_PROFILE_MAKER_REVIEW_WARNING).toContain("verify every statement");
  });
});