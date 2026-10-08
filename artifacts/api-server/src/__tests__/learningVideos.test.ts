import { describe, expect, it } from "vitest";
import {
  normalizeExternalVideoUrl,
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
