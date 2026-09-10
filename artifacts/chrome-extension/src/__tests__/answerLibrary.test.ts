import { describe, expect, it } from "vitest";
import {
  findBestRememberedAnswer,
  normalizeRememberedQuestion,
  questionSimilarity,
  type RememberedAnswer,
} from "../lib/answerLibrary";

function answer(overrides: Partial<RememberedAnswer> = {}): RememberedAnswer {
  return {
    id: "answer-1",
    version: 1,
    value: "I want this role because I can improve patient outcomes.",
    normalizedQuestion: normalizeRememberedQuestion("Why do you want this role?"),
    questionSignature: "motivation|textarea|0",
    labelVariants: ["Why do you want this role?"],
    controlType: "textarea",
    category: "safe_free_text",
    source: "candidate",
    scope: "global",
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
    useCount: 0,
    explicitSave: false,
    ...overrides,
  };
}

describe("answer library matching", () => {
  it("normalizes punctuation, case, whitespace, and duplicate ordinals", () => {
    expect(normalizeRememberedQuestion("  Why do you want THIS role? (2) ")).toBe("why do you want this role");
  });

  it("matches common question synonyms above the autofill threshold", () => {
    expect(questionSimilarity(
      "Why do you want this role?",
      "What motivates you to apply for this position?",
    )).toBeGreaterThanOrEqual(0.86);
    expect(findBestRememberedAnswer(
      { question: "What motivates you to apply for this position?", signature: "other" },
      "textarea",
      [answer()],
    )?.answer.id).toBe("answer-1");
  });

  it("does not autofill low-confidence questions", () => {
    expect(findBestRememberedAnswer(
      { question: "Describe your approach to stock inventory reconciliation", signature: "inventory" },
      "textarea",
      [answer()],
    )).toBeNull();
  });

  it("skips close collisions with different candidate answers", () => {
    const first = answer({ id: "first", value: "First answer", updatedAt: 5 });
    const second = answer({ id: "second", value: "Different answer", updatedAt: 4 });
    expect(findBestRememberedAnswer(
      { question: "Why do you want this role?", signature: "new" },
      "textarea",
      [first, second],
    )).toBeNull();
  });

  it("keeps employer-scoped answers inside the matching employer", () => {
    const scoped = answer({ scope: "employer", employerKey: "example trust" });
    expect(findBestRememberedAnswer(
      { question: "Why do you want this role?", signature: "new" },
      "textarea",
      [scoped],
      { employerKey: "another trust" },
    )).toBeNull();
    expect(findBestRememberedAnswer(
      { question: "Why do you want this role?", signature: "new" },
      "textarea",
      [scoped],
      { employerKey: "example trust" },
    )?.answer.id).toBe("answer-1");
  });
});