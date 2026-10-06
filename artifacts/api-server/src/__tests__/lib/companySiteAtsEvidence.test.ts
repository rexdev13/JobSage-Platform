import { describe, expect, it, vi } from "vitest";
import { fetchCompanySiteEvidencePages } from "../../lib/companySiteAtsEvidence";
import { classifyOperatorEvidenceOutcome } from "../../tools/companySiteAtsScope";

describe("read-only alternative company-site evidence", () => {
  it("keeps robots-blocked employer pages blocked while trying an operator-supplied first-party alternative", async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        kind: "robots",
        reason: "robots.txt disallows this path",
      })
      .mockResolvedValueOnce({
        ok: true,
        url: "https://careers.example.org/open-roles",
        status: 200,
        contentType: "text/html",
        body: '<a href="https://jobs.lever.co/example">Careers</a>',
      });

    const result = await fetchCompanySiteEvidencePages({
      scheduled: [
        { url: "https://example.org/", source: "employer_site" },
        {
          url: "https://careers.example.org/open-roles",
          source: "operator_supplied_first_party_evidence",
        },
      ],
      originHostname: "example.org",
      deadlineMs: Date.now() + 10_000,
      noHostState: true,
      fetchPage,
    });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(
      1,
      "https://example.org/",
      "example.org",
      expect.any(Number),
      1_000_000,
      { readOnly: true, noHostState: true },
    );
    expect(result.attempts[0]).toMatchObject({
      source: "employer_site",
      fetched: false,
      failureKind: "robots",
    });
    expect(result.pages).toEqual([
      expect.objectContaining({
        source: "operator_supplied_first_party_evidence",
        url: "https://careers.example.org/open-roles",
      }),
    ]);
    expect(classifyOperatorEvidenceOutcome({
      provided: true,
      verified: false,
      attempts: result.attempts.filter(
        (attempt) => attempt.source === "operator_supplied_first_party_evidence",
      ),
    })).toBe("fetched_no_verified_ats_feed");
  });

  it("does not retry a rate-limited host but can continue to a separate first-party host", async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        kind: "rate_limited",
        status: 429,
        reason: "HTTP 429",
      })
      .mockResolvedValueOnce({
        ok: true,
        url: "https://careers.example.org/jobs",
        status: 200,
        contentType: "text/html",
        body: "<h1>Vacancies</h1>",
      });

    const result = await fetchCompanySiteEvidencePages({
      scheduled: [
        { url: "https://example.org/", source: "employer_site" },
        {
          url: "https://example.org/careers",
          source: "operator_supplied_first_party_evidence",
        },
        {
          url: "https://careers.example.org/jobs",
          source: "operator_supplied_first_party_evidence",
        },
      ],
      originHostname: "example.org",
      deadlineMs: Date.now() + 10_000,
      noHostState: true,
      fetchPage,
    });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls.map(([url]) => url)).toEqual([
      "https://example.org/",
      "https://careers.example.org/jobs",
    ]);
    expect(result.attempts[1]).toMatchObject({
      source: "operator_supplied_first_party_evidence",
      fetched: false,
      failureKind: "rate_limited",
      notAttemptedAfterRateLimit: true,
    });
    expect(result.attempts[2]).toMatchObject({
      source: "operator_supplied_first_party_evidence",
      fetched: true,
    });
    expect(classifyOperatorEvidenceOutcome({
      provided: true,
      verified: false,
      attempts: result.attempts.filter(
        (attempt) => attempt.source === "operator_supplied_first_party_evidence",
      ),
    })).toBe("fetched_no_verified_ats_feed");
    expect(classifyOperatorEvidenceOutcome({
      provided: true,
      verified: false,
      attempts: [{
        fetched: false,
        failureKind: result.attempts[1]?.failureKind,
        status: 429,
      }],
    })).toBe("rate_limited");
  });
});
