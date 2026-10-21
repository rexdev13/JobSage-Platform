// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { detectQuestions, isQuestionAnswered, fillStructuredField, getStructuredFieldDescriptors } from "../lib/questionDetector";

describe("candidate-only field privacy", () => {
  it("lists declaration checkboxes and tracks manual completion without ever checking them automatically", () => {
    document.body.innerHTML = '<label for="declare"><input id="declare" type="checkbox" required>I confirm that the information is accurate</label>';
    const [question] = detectQuestions();
    expect(question.bucket).toBe("confirmation");
    expect(isQuestionAnswered(question.id)).toBe(false);
    expect(getStructuredFieldDescriptors([question])).toEqual([]);
    expect(fillStructuredField(question.id, "true")).toBe(false);
    (document.getElementById("declare") as HTMLInputElement).checked = true;
    expect(isQuestionAnswered(question.id)).toBe(true);
  });

  it.each(["Medical history", "Bank account number", "Credit card number", "Disability details"])(
    "keeps %s manual but accurately reports candidate-entered completion", (label) => {
      document.body.innerHTML = `<label for="private">${label}</label><textarea id="private"></textarea>`;
      const [question] = detectQuestions();
      expect(question.bucket).toBe("confirmation");
      expect(isQuestionAnswered(question.id)).toBe(false);
      (document.getElementById("private") as HTMLTextAreaElement).value = "Candidate entered this directly";
      expect(isQuestionAnswered(question.id)).toBe(true);
    },
  );
});
