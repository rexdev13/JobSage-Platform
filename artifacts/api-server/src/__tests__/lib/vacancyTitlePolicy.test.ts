import { describe, expect, it } from "vitest";
import { isLikelyEditorialTitle, isManualLabourTitle } from "../../lib/vacancyTitlePolicy";

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

  it.each([
    "Accountant",
    "Software Engineer",
    "Construction Engineer",
    "Clinical Research Administrator",
    "Head Chef",
    "Restaurant Manager",
    "Electrician",
    "Bricklayer",
  ])("does not globally reject the professional title %s", (title) => {
    expect(isManualLabourTitle(title)).toBe(false);
  });

  it.each([
    "Warehouse Operative",
    "Hospital Cleaner",
    "Kitchen Porter",
    "Construction Labourer",
  ])("still rejects genuine manual-labour title %s", (title) => {
    expect(isManualLabourTitle(title)).toBe(true);
  });
});

describe("isLikelyEditorialTitle", () => {
  it("rejects an article heading with its explanatory copy appended", () => {
    expect(
      isLikelyEditorialTitle(
        "School & college studies Most people know what doctors, nurses, dentists and vets do. But many people are not sure what a research chemist does, or what a pharmacologist is.",
      ),
    ).toBe(true);
  });

  it("keeps concise legitimate vacancy titles", () => {
    expect(isLikelyEditorialTitle("School Nurse")).toBe(false);
    expect(isLikelyEditorialTitle("Research Pharmacologist")).toBe(false);
    expect(isLikelyEditorialTitle("Senior Clinical Lecturer")).toBe(false);
  });
});
