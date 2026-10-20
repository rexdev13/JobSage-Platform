import { describe, expect, it } from "vitest";
import { hasSensitiveValue } from "@workspace/smart-apply-core/privacy";

describe("sensitive-content safeguards", () => {
  it.each(["My bank account number is 12345678", "I have a diagnosis of diabetes.", "I have asthma", "My passport number is 123456789"])("blocks %s", (value) => {
    expect(hasSensitiveValue(value)).toBe(true);
  });
  it("does not mistake healthcare professional work for personal medical history", () => {
    expect(hasSensitiveValue("Cancer nurse with five years of professional experience in diabetes care")).toBe(false);
  });
});
