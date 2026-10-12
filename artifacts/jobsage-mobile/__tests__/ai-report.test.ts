import { describe, expect, it } from "@jest/globals";
import { buildAIReportMessage } from "@workspace/mobile-core";

const options = {
  reason: "privacy" as const,
  detail: "The answer included details I did not ask to share.",
  context: "Smart Apply fixture",
  includeContent: false,
  content: "Private draft fixture text.",
};
describe("AI report evidence consent", () => {
  it("does not include draft text without an explicit choice", () => {
    expect(buildAIReportMessage(options)).not.toContain(options.content);
  });
  it("includes a bounded excerpt only when chosen", () => {
    const content = "a".repeat(3000);
    const message = buildAIReportMessage({ ...options, includeContent: true, content });
    expect(message.endsWith("a".repeat(2000))).toBe(true);
    expect(message).not.toContain("a".repeat(2001));
  });
  it("rejects empty or excessively long descriptions", () => {
    expect(() => buildAIReportMessage({ ...options, detail: " " })).toThrow();
    expect(() => buildAIReportMessage({ ...options, detail: "a".repeat(1001) })).toThrow();
  });
  it("rejects unknown and prototype-property reasons", () => {
    expect(() => buildAIReportMessage({ ...options, reason: "__proto__" as never })).toThrow();
  });
});
