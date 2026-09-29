import { describe, expect, it } from "vitest";
import {
  matchesHealthcareSelector,
  savedCareersOnlyPageUrls,
} from "../../tools/companySiteAtsScope";

describe("production proof healthcare saved-careers scope", () => {
  it("excludes non-healthcare labels and only allows the explicit Public Services cues", () => {
    expect(matchesHealthcareSelector("Technology", "NHS Digital")).toBe(false);
    expect(matchesHealthcareSelector("Healthcare", "Private Clinic")).toBe(true);
    expect(matchesHealthcareSelector("Social Care", "Care Provider")).toBe(true);
    expect(matchesHealthcareSelector("Public Services", "National Health Service Trust")).toBe(true);
    expect(matchesHealthcareSelector("Public Services", "Local Council")).toBe(false);
  });

  it("requires a nonblank saved careers URL", () => {
    expect(savedCareersOnlyPageUrls({ careers_url: null })).toEqual([]);
    expect(savedCareersOnlyPageUrls({ careers_url: "" })).toEqual([]);
    expect(savedCareersOnlyPageUrls({ careers_url: "https://example.test/careers" }))
      .toEqual(["https://example.test/careers"]);
  });

  it("does not add homepage or evidence URLs in saved-careers-only mode", () => {
    expect(savedCareersOnlyPageUrls({ careers_url: "https://example.test/careers" }))
      .not.toContain("https://example.test/");
    expect(savedCareersOnlyPageUrls({ careers_url: "https://example.test/careers" }))
      .not.toContain("https://ats.example.test/board");
  });
});