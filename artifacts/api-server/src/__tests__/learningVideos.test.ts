import { describe, expect, it } from "vitest";
import {
  learningVideoMatchesProfession,
  normalizeExternalVideoUrl,
  normalizeExamPrepProfession,
  officialExamPrepResourcesForProfession,
  parseByteRange,
  validApplicability,
  validReviewWindow,
} from "../routes/learningVideos";

describe("learning video URL validation", () => {
  it("normalizes YouTube watch and short links to privacy-enhanced embeds", () => {
    expect(normalizeExternalVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(normalizeExternalVideoUrl("https://youtu.be/dQw4w9WgXcQ?t=42")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });

  it("normalizes Vimeo links and retains the privacy hash", () => {
    expect(normalizeExternalVideoUrl("https://vimeo.com/123456789?h=abcdef")).toBe(
      "https://player.vimeo.com/video/123456789?h=abcdef",
    );
  });

  it("rejects unsupported hosts, insecure links, and credentials", () => {
    expect(normalizeExternalVideoUrl("http://youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(normalizeExternalVideoUrl("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(normalizeExternalVideoUrl("https://user:pass@vimeo.com/123456789")).toBeNull();
    expect(normalizeExternalVideoUrl("https://example.com/video.mp4")).toBeNull();
  });
});

describe("learning video review rules", () => {
  it("requires applicability for sponsorship, clinical, registration, and relocation guidance", () => {
    expect(validApplicability("medical", null)).toBe(false);
    expect(validApplicability("sponsorship", "   ")).toBe(false);
    expect(validApplicability("professional_registration", "Nurses applying to the UK")).toBe(true);
    expect(validApplicability("application", null)).toBe(true);
  });

  it("rejects invalid review periods and expired published videos", () => {
    expect(validReviewWindow("2025-01-01", "2025-02-01", "draft")).toBe(true);
    expect(validReviewWindow("2025-02-01", "2025-01-01", "draft")).toBe(false);
    expect(validReviewWindow("2025-01-01", "2025-02-01", "published")).toBe(false);
  });
});

describe("professional exam-prep access", () => {
  it.each([
    ["Doctor", "doctor"],
    ["Registered Nurse", "nurse"],
    ["Dentist", "dentist"],
  ] as const)("normalizes eligible profession %s", (value, expected) => {
    expect(normalizeExamPrepProfession(value)).toBe(expected);
  });

  it.each(["Midwife", "Pharmacist", "", null])("rejects unsupported profession %s", (value) => {
    expect(normalizeExamPrepProfession(value)).toBeNull();
  });

  it("matches only professional registration resources for the saved profession", () => {
    expect(learningVideoMatchesProfession("Nurses preparing for CBT and OSCE", "nurse")).toBe(true);
    expect(learningVideoMatchesProfession("Dentists preparing for ORE", "nurse")).toBe(false);
    expect(learningVideoMatchesProfession(null, "doctor")).toBe(false);
  });

  it.each([
    ["doctor", ["PLAB 1", "PLAB 2"]],
    ["nurse", ["CBT", "OSCE"]],
    ["dentist", ["ORE overview", "ORE Part 1", "ORE Part 2"]],
  ] as const)("provides current official resources for %s", (profession, stages) => {
    const resources = officialExamPrepResourcesForProfession(profession, new Date("2026-10-10T00:00:00.000Z"));
    expect(resources.map((resource) => resource.stage)).toEqual(stages);

    for (const resource of resources) {
      expect(resource.status).toBe("published");
      expect(resource.category).toBe("professional_registration");
      expect(resource.applicability?.toLowerCase()).toContain(profession);
      expect(resource.sourceUrl).toMatch(/^https:\/\/(www\.)?(gmc-uk\.org|nmc\.org\.uk|gdc-uk\.org)\//);
      expect(resource.reviewedAt.toISOString().slice(0, 10)).toBe("2026-10-10");
      expect(resource.reviewDueAt.getTime()).toBeGreaterThan(resource.reviewedAt.getTime());
      expect(resource.reviewedBy).toBeTruthy();
    }

    expect(officialExamPrepResourcesForProfession(profession, new Date("2027-04-11T00:00:00.000Z"))).toEqual([]);
  });
});

describe("video byte ranges", () => {
  it("parses bounded, open-ended, and suffix byte ranges", () => {
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=0-999", 100)).toEqual({ start: 0, end: 99 });
  });

  it("rejects malformed and unsatisfiable ranges", () => {
    expect(parseByteRange("bytes=100-", 100)).toBe(false);
    expect(parseByteRange("bytes=-0", 100)).toBe(false);
    expect(parseByteRange("bytes=0-10,20-30", 100)).toBe(false);
  });
});
