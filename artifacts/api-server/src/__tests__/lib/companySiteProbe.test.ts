import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchCompanySitePageMock, insertMock, persistedValues } = vi.hoisted(() => ({
  fetchCompanySitePageMock: vi.fn(),
  insertMock: vi.fn(),
  persistedValues: [] as Array<Record<string, unknown>>,
}));

vi.mock("@workspace/db", () => ({
  db: { insert: insertMock },
  sponsorLicenceCompanySiteChecksTable: { organisationName: "organisationName" },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("../../lib/companySiteDiscovery", () => ({
  normaliseSponsorWebsite: (value: string) =>
    value.trim().startsWith("https://") ? value.trim() : `https://${value.trim()}`,
  inspectCompanySiteProbePage: (_pageUrl: string, body: string) => ({
    hasCareersSignal: /\bcareers?\b/i.test(body),
    careersUrl: "https://example.test/careers",
    atsProvider: null,
  }),
}));
vi.mock("../../lib/companySiteHttp", () => ({
  fetchCompanySitePage: fetchCompanySitePageMock,
  classifyCompanySiteFailure: () => "temporary",
}));
vi.mock("../../lib/companySitePersistence", () => ({
  withCompanySiteDatabaseRetry: vi.fn((_label: string, operation: () => unknown) => operation()),
}));

const {
  runCompanySiteProbe,
  runCompanySiteProbeBatch,
  COMPANY_SITE_PROBE_MAX_ROOT_BYTES,
  COMPANY_SITE_PROBE_WRITE_RESERVE_MS,
} = await import("../../lib/companySiteProbe");

describe("company-site health probe", () => {
  beforeEach(() => {
    fetchCompanySitePageMock.mockReset();
    insertMock.mockReset();
    persistedValues.length = 0;
    insertMock.mockReturnValue({
      values: (values: Record<string, unknown>) => {
        persistedValues.push(values);
        return {
          onConflictDoUpdate: () => Promise.resolve(),
        };
      },
    });
  });

  it("persists ok_for_crawl without changing full-crawl timestamps", async () => {
    fetchCompanySitePageMock.mockResolvedValue({
      ok: true,
      url: "https://example.test/",
      status: 200,
      body: "<html><a href='/careers'>Careers</a></html>",
      contentType: "text/html",
    });

    const result = await runCompanySiteProbe({
      organisationName: "Example Ltd",
      website: "example.test",
    });

    expect(result).toEqual({
      status: "checked",
      classification: "ok_for_crawl",
      failureClass: null,
    });
    expect(fetchCompanySitePageMock).toHaveBeenCalledOnce();
    expect(fetchCompanySitePageMock).toHaveBeenCalledWith(
      "https://example.test/",
      "example.test",
      expect.any(Number),
      COMPANY_SITE_PROBE_MAX_ROOT_BYTES,
    );
    expect(persistedValues[0]).toEqual(expect.objectContaining({
      organisationName: "Example Ltd",
      retryAfter: null,
      lastError: null,
      lastOutcome: "ok_for_crawl",
      probeStatus: "ok_for_crawl",
      lastProbedAt: expect.any(Date),
      probeReason: "root fetch and careers/ATS signal succeeded",
      updatedAt: expect.any(Date),
    }));
    expect(persistedValues[0]).not.toHaveProperty("lastAttemptedAt");
    expect(persistedValues[0]).not.toHaveProperty("genericCheckedAt");
    expect(persistedValues[0]).not.toHaveProperty("atsCheckedAt");
    expect(persistedValues[0]).not.toHaveProperty("lastCompletedAt");
  });

  it("classifies unsafe fetches as permanent_bad with the quarantine floor", async () => {
    fetchCompanySitePageMock.mockResolvedValue({
      ok: false,
      kind: "unsafe",
      reason: "redirect outside employer or approved ATS",
      failureClass: "permanent",
    });

    const result = await runCompanySiteProbe({
      organisationName: "Unsafe Ltd",
      website: "https://unsafe.test",
    });

    expect(result).toEqual({
      status: "checked",
      classification: "permanent_bad",
      failureClass: "permanent",
    });
    expect(persistedValues[0]).toEqual(expect.objectContaining({
      lastOutcome: "permanent_bad",
      probeStatus: "bad",
      lastProbedAt: expect.any(Date),
      probeReason: "[permanent] redirect outside employer or approved ATS",
      lastError: "[permanent] redirect outside employer or approved ATS",
      retryAfter: expect.any(Date),
    }));
  });

  it("keeps a successful fetch successful when persistence fails", async () => {
    fetchCompanySitePageMock.mockResolvedValue({
      ok: true,
      url: "https://healthy.test/",
      status: 200,
      body: "<html><a href='/careers'>Careers</a></html>",
      contentType: "text/html",
    });
    insertMock.mockReturnValue({
      values: () => ({
        onConflictDoUpdate: () => Promise.reject(new Error("database unavailable")),
      }),
    });

    await expect(runCompanySiteProbe({
      organisationName: "Healthy Ltd",
      website: "healthy.test",
    })).rejects.toThrow("database unavailable");

    expect(fetchCompanySitePageMock).toHaveBeenCalledOnce();
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it("honours a later server retry time for temporary failures", async () => {
    const retryAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    fetchCompanySitePageMock.mockResolvedValue({
      ok: false,
      kind: "rate_limited",
      reason: "HTTP 429",
      retryAt,
      failureClass: "temporary",
    });

    await runCompanySiteProbe({
      organisationName: "Busy Ltd",
      website: "busy.test",
    });

    expect(persistedValues[0]).toEqual(expect.objectContaining({
      lastOutcome: "temporary_bad",
      lastError: "[temporary] HTTP 429",
      retryAfter: retryAt,
    }));
  });

  it("defers all network work once the write-reserve deadline is reached", async () => {
    const summary = await runCompanySiteProbeBatch(
      Array.from({ length: 3 }, (_, index) => ({
        organisationName: `Employer ${index}`,
        website: `https://employer-${index}.test`,
      })),
      { deadlineMs: Date.now() + COMPANY_SITE_PROBE_WRITE_RESERVE_MS },
    );

    expect(summary).toEqual(expect.objectContaining({
      selected: 3,
      checked: 0,
      deferred: 3,
      errors: 0,
      done: false,
    }));
    expect(fetchCompanySitePageMock).not.toHaveBeenCalled();
  });

  it("counts newly approved and newly bad probe marks", async () => {
    fetchCompanySitePageMock
      .mockResolvedValueOnce({
        ok: true,
        url: "https://healthy.test/",
        status: 200,
      body: "<html><a href='/careers'>Careers</a></html>",
        contentType: "text/html",
      })
      .mockResolvedValueOnce({
        ok: false,
        kind: "network",
        reason: "connection failed",
        failureClass: "temporary",
      });

    const summary = await runCompanySiteProbeBatch([
      {
        organisationName: "Newly Healthy Ltd",
        website: "healthy.test",
        previousProbeStatus: "unknown",
      },
      {
        organisationName: "Still Bad Ltd",
        website: "bad.test",
        previousProbeStatus: "bad",
      },
    ]);

    expect(summary).toEqual(expect.objectContaining({
      checked: 2,
      okForCrawl: 1,
      okForCrawlNew: 1,
      badNew: 0,
      temporaryBad: 1,
    }));
  });
});