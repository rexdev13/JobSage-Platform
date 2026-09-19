import { describe, expect, it } from "vitest";
import { extractVacancyClosingDate, parseVacancyClosingDate } from "../../lib/vacancyDates";
import { getCandidateVacancyStatus } from "../../lib/vacancyLiveness";

describe("vacancy expiry rules", () => {
  it("parses UK date-only values as the end of the London calendar day", () => {
    const date = parseVacancyClosingDate("31 December 2026");
    expect(date?.toISOString()).toBe("2026-12-31T23:59:59.999Z");
  });

  it("parses JSON-LD ISO date-only validThrough as London end-of-day", () => {
    expect(parseVacancyClosingDate("2026-12-31")?.toISOString()).toBe("2026-12-31T23:59:59.999Z");
  });

  it("extracts labelled closing dates", () => {
    expect(extractVacancyClosingDate("Apply by: 01/01/2020")).not.toBeNull();
  });

  it("hides an expired vacancy even when its URL is live", () => {
    expect(getCandidateVacancyStatus({
      sourceType: "job_board",
      liveness: "live",
      lastVerifiedAt: new Date(),
      closesAt: new Date("2020-01-01T23:59:59.999Z"),
    })).toBe("expired");
  });

  it("hides evidence-less company rows when the legacy window is omitted", () => {
    expect(getCandidateVacancyStatus({
      sourceType: "company_site",
      liveness: "live",
      lastVerifiedAt: new Date(),
    })).toBe("unverified");
  });
});