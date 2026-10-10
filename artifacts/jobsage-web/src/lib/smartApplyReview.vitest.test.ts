import { describe, expect, it } from "vitest";
import {
  findFirstMissingRequiredAnswerId,
  findFirstUnreviewedAnswerId,
} from "./smartApplyReview";

const questions = [
  { id: "motivation", required: true },
  { id: "clinical_experience", required: true },
  { id: "availability", required: false },
];

describe("Smart Apply answer review gates", () => {
  it("requires a candidate check for every non-empty AI draft, independent of its model flag", () => {
    const answer = {
      motivation: "I am passionate about this role.",
      clinical_experience: "I have eight years of experience.",
      availability: "",
    };
    const reviewRequired = new Set(["motivation", "clinical_experience"]);

    expect(
      findFirstUnreviewedAnswerId(questions, answer, reviewRequired, new Set()),
    ).toBe("motivation");
    expect(
      findFirstUnreviewedAnswerId(
        questions,
        answer,
        reviewRequired,
        new Set(["motivation"]),
      ),
    ).toBe("clinical_experience");
    expect(
      findFirstUnreviewedAnswerId(
        questions,
        answer,
        reviewRequired,
        new Set(["motivation", "clinical_experience"]),
      ),
    ).toBeNull();
  });

  it("does not treat a blank unsupported draft as reviewed or as a submitted answer", () => {
    const answer = { motivation: "", clinical_experience: "Confirmed facts.", availability: "" };

    expect(
      findFirstUnreviewedAnswerId(
        questions,
        answer,
        new Set(["motivation", "clinical_experience"]),
        new Set(),
      ),
    ).toBe("clinical_experience");
    expect(findFirstMissingRequiredAnswerId(questions, answer)).toBe("motivation");
  });

  it("allows an unanswered optional question but still blocks an unconfirmed draft", () => {
    const answer = {
      motivation: "I am applying for this role.",
      clinical_experience: "Confirmed facts.",
      availability: "I can start next month.",
    };

    expect(findFirstMissingRequiredAnswerId(questions, answer)).toBeNull();
    expect(
      findFirstUnreviewedAnswerId(
        questions,
        answer,
        new Set(["availability"]),
        new Set(),
      ),
    ).toBe("availability");
  });
});
