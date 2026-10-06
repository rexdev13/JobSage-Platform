import { describe, expect, it } from "vitest";
import {
  classifyOperatorEvidenceAttempt,
  classifyOperatorEvidenceOutcome,
  isFirstPartyEvidenceHost,
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

  it("reports robots-blocked operator alternatives distinctly without treating them as verified", () => {
    expect(classifyOperatorEvidenceOutcome({
      provided: true,
      verified: false,
      attempts: [{ fetched: false, failureKind: "robots" }],
    })).toBe("robots_blocked");
    expect(classifyOperatorEvidenceOutcome({
      provided: true,
      verified: false,
      attempts: [{ fetched: false, failureKind: "robots" }],
    })).not.toBe("verified_ats_feed");
  });

  it("reports a rate-limited operator alternative distinctly", () => {
    expect(classifyOperatorEvidenceOutcome({
      provided: true,
      verified: false,
      attempts: [{ fetched: false, failureKind: "rate_limited", status: 429 }],
    })).toBe("rate_limited");
    expect(classifyOperatorEvidenceAttempt({
      fetched: false,
      failureKind: "rate_limited",
      status: 429,
    })).toBe("rate_limited");
    expect(classifyOperatorEvidenceAttempt({
      fetched: false,
      failureKind: "rate_limited",
      notAttemptedAfterRateLimit: true,
    })).toBe("not_attempted_after_rate_limit");
    expect(classifyOperatorEvidenceAttempt({
      fetched: false,
      notAttemptedReason: "page_limit",
    })).toBe("not_attempted_page_limit");
  });

  it("accepts only the employer host or its subdomains as first-party evidence", () => {
    expect(isFirstPartyEvidenceHost("careers.example.org", "www.example.org")).toBe(true);
    expect(isFirstPartyEvidenceHost("example.org.attacker.test", "example.org")).toBe(false);
  });
});