import { describe, expect, it } from "vitest";
import { assistantErrorMessageFor, SENSITIVE_QUESTION_BLOCK_MESSAGE } from "../lib/assistantErrors";

describe("assistant error messages", () => {
  it("shows the specific policy explanation when a question is blocked", () => {
    expect(assistantErrorMessageFor({
      kind: "server",
      status: 422,
      message: "JOBSAGE can't generate an answer because this question asks you to confirm sensitive or personal information. Please review it and answer it yourself.",
    })).toBe(SENSITIVE_QUESTION_BLOCK_MESSAGE);
  });

  it("uses a clear fallback if a blocked-question response has no message", () => {
    expect(assistantErrorMessageFor({ kind: "server", status: 422 })).toBe(SENSITIVE_QUESTION_BLOCK_MESSAGE);
  });

  it("keeps the retry message for actual server failures", () => {
    expect(assistantErrorMessageFor({ kind: "server", status: 500 })).toBe(
      "JOBSAGE couldn't generate an answer right now. Please try again in a moment.",
    );
  });
});