import { describe, expect, it } from "vitest";
import { isManualLabourTitle } from "../../lib/vacancyTitlePolicy";

describe("vacancy title professional-scope policy", () => {
  it("rejects food-service roles that must not enter a clinical feed", () => {
    expect(isManualLabourTitle("Pizza Maker")).toBe(true);
    expect(isManualLabourTitle("Assistant Pizza Chef")).toBe(true);
    expect(isManualLabourTitle("Bakery Team Member")).toBe(true);
    expect(isManualLabourTitle("Fast Food Restaurant Worker")).toBe(true);
  });

  it("does not reject genuine clinical titles", () => {
    expect(isManualLabourTitle("Emergency and Critical Care Nurse")).toBe(false);
    expect(isManualLabourTitle("Clinical Engineer")).toBe(false);
    expect(isManualLabourTitle("Dietitian - Food Service Transformation")).toBe(false);
  });
});