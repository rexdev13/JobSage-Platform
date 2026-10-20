// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { detectQuestions, isQuestionAnswered } from "../lib/questionDetector";

describe("candidate-only field privacy", () => {
  it.each(["Medical history", "Bank account number", "Credit card number", "Disability details"])(
    "does not read the value of %s for completion", (label) => {
      document.body.innerHTML = `<label for="private">${label}</label><textarea id="private"></textarea>`;
      const [question] = detectQuestions();
      expect(question.bucket).toBe("confirmation");
      Object.defineProperty(document.getElementById("private"), "value", {
        get() { throw new Error("Sensitive value was read"); }, configurable: true,
      });
      expect(isQuestionAnswered(question.id)).toBe(false);
    },
  );
});
