import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  executeMock,
  selectMock,
  insertMock,
  scheduleMock,
  discoverCompanySiteVacanciesMock,
  persistCompanySiteVacanciesMock,
  runCompanySiteProbeBatchMock,
  sqlMock,
  sqlParamMock,
} = vi.hoisted(() => {
  const sqlParamMock = vi.fn((value: unknown) => ({ parameter: value }));
  const sqlMock = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      sqlText: strings.reduce((text, part, index) => {
        const value = values[index];
        const nested = value && typeof value === "object" &&
          "sqlText" in value
          ? String((value as { sqlText: string }).sqlText)
          : "?";
        return text + part + (index < values.length ? nested : "");
      }, ""),
    })),
    { param: sqlParamMock },
  );
  return {
    executeMock: vi.fn(),
    selectMock: vi.fn(),
    insertMock: vi.fn(),
    scheduleMock: vi.fn(),
    discoverCompanySiteVacanciesMock: vi.fn(),
    persistCompanySiteVacanciesMock: vi.fn(),
    runCompanySiteProbeBatchMock: vi.fn(),
    sqlMock,
    sqlParamMock,
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    execute: executeMock,
    select: selectMock,
    insert: insertMock,
  },
  sponsorLicenceCompanySiteChecksTable: {
    organisationName: "organisationName",
  },
  vacancySyncLogTable: "vacancySyncLogTable",
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  sql: sqlMock,
}));

vi.mock("node-cron", () => ({ default: { schedule: scheduleMock } }));

vi.mock("../../lib/companySiteDiscovery", () => ({
  discoverCompanySiteVacancies: discoverCompanySiteVacanciesMock,
  persistCompanySiteVacancies: persistCompanySiteVacanciesMock,
}));
vi.mock("../../lib/companySiteProbe", () => ({
  COMPANY_SITE_PROBE_BATCH_SIZE: 60,
  COMPANY_SITE_PROBE_OK_RECHECK_MS: 6 * 60 * 60 * 1000,
  runCompanySiteProbeBatch: runCompanySiteProbeBatchMock,
}));

const {
  COMPANY_SITE_DISCOVERY_BATCH_SIZE,
  COMPANY_SITE_FAILED_RETRY_MS,
  COMPANY_SITE_PERMANENT_RETRY_MS,
  COMPANY_SITE_HEALTHCARE_EVIDENCE_RESERVE,
  COMPANY_SITE_PARTIAL_RETRY_MS,
  COMPANY_SITE_BATCH_WRITE_RESERVE_MS,
  COMPANY_SITE_DISCOVERY_CONCURRENCY,
  COMPANY_SITE_DISCOVERY_CRON,
  COMPANY_SITE_SECTOR_COUNT,
  runCompanySiteCheck,
  isCircleDirectFeedPersistenceAllowed,
  runCompanySiteDiscoveryBatch,
  runCompanySiteProbeDiscoveryBatch,
  selectCompanySiteBatch,
  startCompanySiteDiscoveryScheduler,
} = await import("../../lib/companySiteScheduler");

describe("company-site scheduler", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    executeMock.mockReset();
    selectMock.mockReset();
    insertMock.mockReset();
    scheduleMock.mockReset();
    discoverCompanySiteVacanciesMock.mockReset();
    persistCompanySiteVacanciesMock.mockReset();
    runCompanySiteProbeBatchMock.mockReset();
    sqlParamMock.mockClear();
    sqlMock.mockClear();
    selectMock.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    });
    insertMock.mockReturnValue({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve(),
      }),
    });
    persistCompanySiteVacanciesMock.mockResolvedValue({
      inserted: 0,
      updated: 0,
      revived: 0,
    });
  });

  it("blocks Circle generic fallback adverts after a failed Workday feed", () => {
    const row = {
      organisationName: "BMI Healthcare Limited trading as Circle Health Group Limited",
      careersUrl: "https://circlehealth.wd103.myworkdayjobs.com/chgcareers",
      atsProvider: "Workday",
      atsBoardId: "chgcareers",
      atsMappingEvidenceUrl:
        "http://careers.circlehealthgroup.co.uk/jobs/sister-charge-nurse-critical-care-jr110643",
      atsMappingStatus: "verified" as const,
    };
    expect(isCircleDirectFeedPersistenceAllowed(row, {
      careersUrl: "https://circlehealth.wd103.myworkdayjobs.com/chgcareers",
      atsProvider: "Workday",
      atsCompleted: false,
      completion: "complete",
      snapshotScope: undefined,
      diagnostics: { directSourceKind: null },
      adverts: [{ sourceType: "company_site" } as never],
    })).toBe(false);
  });

  it("allows only a complete validated Circle Workday snapshot", () => {
    const row = {
      organisationName: "BMI Healthcare Limited trading as Circle Health Group Limited",
      careersUrl: "https://circlehealth.wd103.myworkdayjobs.com/chgcareers",
      atsProvider: "Workday",
      atsBoardId: "chgcareers",
      atsMappingEvidenceUrl:
        "http://careers.circlehealthgroup.co.uk/jobs/sister-charge-nurse-critical-care-jr110643",
      atsMappingStatus: "verified" as const,
    };
    expect(isCircleDirectFeedPersistenceAllowed(row, {
      careersUrl: row.careersUrl,
      atsProvider: "Workday",
      atsCompleted: true,
      completion: "complete",
      snapshotScope: { provider: "Workday", boardId: "chgcareers" },
      diagnostics: { directSourceKind: "ats_feed" },
      adverts: [{
        url: "https://circlehealth.wd103.myworkdayjobs.com/en-GB/chgcareers/job/london/sister-charge-nurse-critical-care_JR110643-1",
        externalId: "JR110643",
        sourceType: "company_site",
        companyVacancyEvidence: {
          kind: "known_ats_posting",
          provider: "Workday",
          listingUrl: row.careersUrl,
        },
      }] as never,
    })).toBe(true);
  });

  it("rejects Circle Workday evidence when the detail URL is not an exact Workday posting", () => {
    const row = {
      organisationName: "BMI Healthcare Limited trading as Circle Health Group Limited",
      careersUrl: "https://circlehealth.wd103.myworkdayjobs.com/chgcareers",
      atsProvider: "Workday",
      atsBoardId: "chgcareers",
      atsMappingEvidenceUrl:
        "http://careers.circlehealthgroup.co.uk/jobs/sister-charge-nurse-critical-care-jr110643",
      atsMappingStatus: "verified" as const,
    };
    expect(isCircleDirectFeedPersistenceAllowed(row, {
      careersUrl: row.careersUrl,
      atsProvider: "Workday",
      atsCompleted: true,
      completion: "complete",
      snapshotScope: { provider: "Workday", boardId: "chgcareers" },
      diagnostics: { directSourceKind: "ats_feed" },
      adverts: [{
        url: "https://circlehealth.wd103.myworkdayjobs.com/en-GB/chgcareers/job/london/fake-role_JR110644-1",
        externalId: "JR110643",
        sourceType: "company_site",
        companyVacancyEvidence: {
          kind: "known_ats_posting",
          provider: "Workday",
          listingUrl: row.careersUrl,
        },
      }] as never,
    })).toBe(false);
  });

  it("fails closed for Circle employer-name casing and whitespace variants", () => {
    const result = {
      careersUrl: "https://circlehealth.wd103.myworkdayjobs.com/chgcareers",
      atsProvider: "Workday",
      atsCompleted: false,
      completion: "complete" as const,
      snapshotScope: undefined,
      diagnostics: { directSourceKind: null },
      adverts: [{ sourceType: "company_site" }] as never,
    };
    expect(isCircleDirectFeedPersistenceAllowed({
      organisationName: "  bmi healthcare limited trading as circle health group limited  ",
      careersUrl: null,
      atsProvider: null,
      atsBoardId: null,
      atsMappingEvidenceUrl: null,
      atsMappingStatus: "unverified",
    }, result)).toBe(false);
  });

  it("leaves other employers outside the Circle persistence gate", () => {
    expect(isCircleDirectFeedPersistenceAllowed({
      organisationName: "Other Employer",
      careersUrl: null,
      atsProvider: null,
      atsBoardId: null,
      atsMappingEvidenceUrl: null,
      atsMappingStatus: "unverified",
    }, {
      careersUrl: null,
      atsProvider: null,
      atsCompleted: false,
      completion: "complete",
      snapshotScope: undefined,
      diagnostics: {},
      adverts: [{ sourceType: "company_site" } as never],
    })).toBe(true);
  });

  it("uses its own hourly schedule and bounded worker settings", () => {
    expect(COMPANY_SITE_DISCOVERY_BATCH_SIZE).toBe(10);
    expect(COMPANY_SITE_HEALTHCARE_EVIDENCE_RESERVE).toBe(2);
    expect(COMPANY_SITE_DISCOVERY_CONCURRENCY).toBe(8);
    expect(COMPANY_SITE_SECTOR_COUNT).toBe(8);
    expect(COMPANY_SITE_BATCH_WRITE_RESERVE_MS).toBe(3_000);
    startCompanySiteDiscoveryScheduler();
    expect(scheduleMock).toHaveBeenCalledWith(
      COMPANY_SITE_DISCOVERY_CRON,
      expect.any(Function),
      { timezone: "Europe/London" },
    );
  });

  it("accepts a stale non-health sponsor selected by the all-industry website queue", async () => {
    executeMock.mockResolvedValue({
      rows: [{
        id: 7,
        organisation_name: "Acme Engineering Limited",
        website: "https://acme.example",
        generic_checked_at: null,
        ats_checked_at: null,
        careers_url: null,
        ats_provider: null,
        bookmarked: false,
        healthcare_evidence_backfill: false,
      }],
    });

    const rows = await selectCompanySiteBatch(10);

    expect(rows).toEqual([
      expect.objectContaining({
        organisationName: "Acme Engineering Limited",
        bookmarked: false,
        healthcareEvidenceBackfill: false,
      }),
    ]);
  });

  it("keeps crawl state in the sector-rotated UNION projection", async () => {
    executeMock.mockResolvedValue({ rows: [] });

    await selectCompanySiteBatch(10);

    const query = executeMock.mock.calls[0]?.[0] as { sqlText?: string } | undefined;
    expect(query?.sqlText).toMatch(
      /rotated_unbookmarked AS \(\s*SELECT[\s\S]*?probe_reason,\s*crawl_state,\s*bookmarked,/,
    );
  });

  it("filters the company-site queue by the normalized allowlist before selection", async () => {
    executeMock.mockResolvedValue({ rows: [] });

    const rows = await selectCompanySiteBatch(1, [
      " Acme Engineering Limited ",
      "Other Employer Ltd",
    ]);

    expect(rows).toEqual([]);
    expect(sqlParamMock).toHaveBeenCalled();
    expect(sqlParamMock).toHaveBeenCalledWith([
      "acme engineering limited",
      "other employer ltd",
    ]);
    for (const [query] of executeMock.mock.calls) {
      const sqlText = (query as { sqlText?: string }).sqlText ?? "";
      expect(sqlText).toContain("lower(btrim(sl.organisation_name)) = ANY");
      expect(sqlText.indexOf("lower(btrim(sl.organisation_name)) = ANY"))
        .toBeLessThan(sqlText.indexOf("ORDER BY"));
    }
  });

  it("mixes approved refreshes with never-probed employers when the approved queue is short", async () => {
    const row = (id: number, probeStatus: "ok_for_crawl" | null) => ({
      id,
      organisation_name: `Employer ${id}`,
      website: `https://employer-${id}.example`,
      generic_checked_at: null,
      ats_checked_at: null,
      careers_url: null,
      ats_provider: null,
      last_outcome: null,
      probe_status: probeStatus,
      last_probed_at: probeStatus ? new Date() : null,
      probe_reason: null,
      bookmarked: false,
      healthcare_evidence_backfill: false,
    });
    executeMock
      .mockResolvedValueOnce({ rows: [1, 2, 3, 4].map((id) => row(id, "ok_for_crawl")) })
      .mockResolvedValueOnce({ rows: [5, 6, 7, 8, 9, 10].map((id) => row(id, null)) });

    const rows = await selectCompanySiteBatch(10);

    expect(rows).toHaveLength(10);
    expect(rows.filter((item) => item.probeStatus === "ok_for_crawl")).toHaveLength(4);
    expect(rows.filter((item) => item.probeStatus === "unknown" && item.lastProbedAt === null)).toHaveLength(6);
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it("skips sponsors without a website before any discovery request", async () => {
    await expect(runCompanySiteCheck({
      organisationName: "No Website Ltd",
      website: " ",
      genericCheckedAt: null,
      atsCheckedAt: null,
      careersUrl: null,
      atsProvider: null,
    })).resolves.toEqual({ status: "skipped", reason: "no website" });
    expect(discoverCompanySiteVacanciesMock).not.toHaveBeenCalled();
  });

  it("backs off a failed employer for a full day without stamping it complete", async () => {
    const before = Date.now();
    let persisted: Record<string, unknown> | undefined;
    insertMock.mockReturnValue({
      values: (values: Record<string, unknown>) => {
        persisted = values;
        return {
          onConflictDoUpdate: () => Promise.resolve(),
        };
      },
    });
    discoverCompanySiteVacanciesMock.mockResolvedValue({
      adverts: [],
      pagesFetched: 0,
      genericCompleted: false,
      atsCompleted: false,
      transientFailure: false,
      completion: "failed",
      error: "robots.txt could not be checked: non-public hostname: dead.example",
      advertsExtracted: 0,
      advertsRejected: 0,
    });

    await runCompanySiteCheck({
      organisationName: "Dead Employer",
      website: "https://dead.example",
      genericCheckedAt: null,
      atsCheckedAt: null,
      careersUrl: null,
      atsProvider: null,
    });

    expect(persisted?.lastOutcome).toBe("failed");
    expect(persisted?.genericCheckedAt).toBeNull();
    expect((persisted?.retryAfter as Date).getTime()).toBeGreaterThanOrEqual(
      before + COMPANY_SITE_FAILED_RETRY_MS,
    );
  });

  it("does not verify a parseable ATS URL without first-party mapping evidence", async () => {
    let persisted: Record<string, unknown> | undefined;
    insertMock.mockReturnValue({
      values: (values: Record<string, unknown>) => {
        persisted = values;
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    });
    discoverCompanySiteVacanciesMock.mockResolvedValue({
      adverts: [],
      sourceUrl: "https://example.test/",
      careersUrl: "https://jobs.ashbyhq.com/example",
      atsProvider: "Ashby",
      atsMappingVerified: false,
      genericCompleted: true,
      atsCompleted: true,
      transientFailure: false,
      completion: "complete",
      pagesFetched: 1,
      advertsExtracted: 0,
      advertsRejected: 0,
    });

    await runCompanySiteCheck({
      organisationName: "Example Ltd",
      website: "https://example.test",
      genericCheckedAt: null,
      atsCheckedAt: null,
      careersUrl: "https://jobs.ashbyhq.com/example",
      atsProvider: "Ashby",
      atsMappingStatus: "unverified",
    });

    expect(discoverCompanySiteVacanciesMock).toHaveBeenCalledWith(
      "Example Ltd",
      "https://example.test",
      expect.objectContaining({ knownCareersMappingVerified: false }),
    );
    expect(persisted).toEqual(expect.objectContaining({
      atsBoardId: null,
      atsMappingStatus: "unverified",
    }));
  });

  it("skips direct-feeds-only checks before discovery without a verified mapping", async () => {
    const outcome = await runCompanySiteCheck({
      organisationName: "Unmapped Employer",
      website: "https://unmapped.example",
      genericCheckedAt: null,
      atsCheckedAt: null,
      careersUrl: null,
      atsProvider: null,
      atsMappingStatus: "unverified",
    }, { directFeedsOnly: true });

    expect(outcome).toEqual({ status: "skipped", reason: "no_direct_feed_source" });
    expect(discoverCompanySiteVacanciesMock).not.toHaveBeenCalled();
    expect(persistCompanySiteVacanciesMock).not.toHaveBeenCalled();
  });

  it("blocks non-ATS and non-schema adverts before direct-mode persistence", async () => {
    discoverCompanySiteVacanciesMock.mockResolvedValue({
      adverts: [{
        organisationName: "Example Ltd",
        employer: "Example Ltd",
        title: "Care Assistant",
        location: "London",
        salary: null,
        url: "https://example.test/jobs/1",
        description: null,
        postedDate: null,
        targetRegions: null,
        boardName: null,
        externalId: null,
        sourceType: "company_site",
        companyVacancyEvidence: { kind: "generic_link" },
      }],
      sourceUrl: "https://example.test/",
      pagesFetched: 1,
      genericCompleted: false,
      atsCompleted: true,
      transientFailure: false,
      completion: "complete",
      advertsExtracted: 1,
      advertsRejected: 0,
      diagnostics: { directFeedsOnly: true },
    });

    await expect(runCompanySiteCheck({
      organisationName: "Example Ltd",
      website: "https://example.test",
      genericCheckedAt: null,
      atsCheckedAt: null,
      careersUrl: "https://jobs.ashbyhq.com/example",
      atsProvider: "Ashby",
      atsBoardId: "example",
      atsMappingStatus: "verified",
    }, { directFeedsOnly: true })).rejects.toThrow("Direct-feeds-only invariant failed before persistence");

    expect(persistCompanySiteVacanciesMock).not.toHaveBeenCalled();
  });

  it("rejects ATS evidence that points to a different verified board", async () => {
    discoverCompanySiteVacanciesMock.mockResolvedValue({
      adverts: [{
        organisationName: "Example Ltd",
        employer: "Example Ltd",
        title: "Care Assistant",
        location: "London",
        salary: null,
        url: "https://jobs.ashbyhq.com/other/job-1",
        description: null,
        postedDate: null,
        targetRegions: null,
        boardName: null,
        externalId: "job-1",
        sourceType: "company_site",
        companyVacancyEvidence: {
          kind: "known_ats_posting",
          provider: "Ashby",
          listingUrl: "https://jobs.ashbyhq.com/other",
        },
      }],
      sourceUrl: "https://example.test/",
      careersUrl: "https://jobs.ashbyhq.com/example",
      atsProvider: "Ashby",
      atsMappingVerified: true,
      pagesFetched: 1,
      genericCompleted: false,
      atsCompleted: true,
      transientFailure: false,
      completion: "complete",
      advertsExtracted: 1,
      advertsRejected: 0,
      diagnostics: { directFeedsOnly: true, directSourceKind: "ats_feed" },
    });

    await expect(runCompanySiteCheck({
      organisationName: "Example Ltd",
      website: "https://example.test",
      genericCheckedAt: null,
      atsCheckedAt: null,
      careersUrl: "https://jobs.ashbyhq.com/example",
      atsMappingEvidenceUrl: "https://careers.example.test/",
      atsProvider: "Ashby",
      atsBoardId: "example",
      atsMappingStatus: "verified",
    }, { directFeedsOnly: true })).rejects.toThrow(
      "does not match the verified ATS mapping",
    );

    expect(persistCompanySiteVacanciesMock).not.toHaveBeenCalled();
  });

  it("passes the no-new-inserts guard through to vacancy persistence", async () => {
    discoverCompanySiteVacanciesMock.mockResolvedValue({
      adverts: [{
        organisationName: "Example Ltd",
        employer: "Example Ltd",
        title: "Care Assistant",
        location: "London",
        salary: null,
        url: "https://jobs.ashbyhq.com/example/job-1",
        description: null,
        postedDate: null,
        targetRegions: null,
        boardName: null,
        externalId: "job-1",
        sourceType: "company_site",
        companyVacancyEvidence: {
          kind: "known_ats_posting",
          provider: "Ashby",
          listingUrl: "https://jobs.ashbyhq.com/example",
        },
      }],
      sourceUrl: "https://example.test/",
      careersUrl: "https://jobs.ashbyhq.com/example",
      atsProvider: "Ashby",
      atsMappingVerified: true,
      pagesFetched: 1,
      genericCompleted: false,
      atsCompleted: true,
      transientFailure: false,
      completion: "complete",
      advertsExtracted: 1,
      advertsRejected: 0,
      diagnostics: { directFeedsOnly: true, directSourceKind: "ats_feed" },
    });

    await runCompanySiteCheck({
      organisationName: "Example Ltd",
      website: "https://example.test",
      genericCheckedAt: null,
      atsCheckedAt: null,
      careersUrl: "https://jobs.ashbyhq.com/example",
      atsMappingEvidenceUrl: "https://careers.example.test/",
      atsProvider: "Ashby",
      atsBoardId: "example",
      atsMappingStatus: "verified",
    }, {
      directFeedsOnly: true,
      expectNoInserts: true,
      queueVerifications: false,
    });

    expect(persistCompanySiteVacanciesMock).toHaveBeenCalledWith(
      expect.any(Array),
      { queueVerifications: false, requireExisting: true },
    );
    expect(discoverCompanySiteVacanciesMock).toHaveBeenCalledWith(
      "Example Ltd",
      "https://example.test",
      expect.objectContaining({
        knownCareersEvidenceUrl: "https://careers.example.test/",
      }),
    );
  });

  it("keeps verified ATS imports available when generic company-site imports are disabled", async () => {
    const previous = process.env["COMPANY_SITE_GENERIC_IMPORT_ENABLED"];
    process.env["COMPANY_SITE_GENERIC_IMPORT_ENABLED"] = "false";
    discoverCompanySiteVacanciesMock.mockResolvedValue({
      adverts: [
        {
          organisationName: "Example Ltd",
          employer: "Example Ltd",
          title: "Support Engineer",
          location: "London",
          salary: null,
          url: "https://jobs.ashbyhq.com/example/job-1",
          description: null,
          postedDate: null,
          targetRegions: null,
          boardName: null,
          externalId: "job-1",
          sourceType: "company_site",
          companyVacancyEvidence: {
            kind: "known_ats_posting",
            provider: "Ashby",
            listingUrl: "https://jobs.ashbyhq.com/example",
          },
        },
        {
          organisationName: "Example Ltd",
          employer: "Example Ltd",
          title: "Unverified role",
          location: "London",
          salary: null,
          url: "https://example.test/jobs/unverified",
          description: null,
          postedDate: null,
          targetRegions: null,
          boardName: null,
          externalId: null,
          sourceType: "company_site",
          companyVacancyEvidence: { kind: "generic_link" },
        },
      ],
      sourceUrl: "https://example.test/",
      careersUrl: "https://jobs.ashbyhq.com/example",
      atsProvider: "Ashby",
      atsMappingVerified: true,
      genericCompleted: true,
      atsCompleted: true,
      transientFailure: false,
      completion: "complete",
      pagesFetched: 1,
      advertsExtracted: 2,
      advertsRejected: 0,
      diagnostics: { directSourceKind: "ats_feed" },
    } as never);

    try {
      await runCompanySiteCheck({
        organisationName: "Example Ltd",
        website: "https://example.test",
        genericCheckedAt: null,
        atsCheckedAt: null,
        careersUrl: "https://jobs.ashbyhq.com/example",
        atsProvider: "Ashby",
        atsBoardId: "example",
        atsMappingStatus: "verified",
      });

      expect(persistCompanySiteVacanciesMock).toHaveBeenCalledTimes(1);
      expect(persistCompanySiteVacanciesMock.mock.calls[0]?.[0]).toEqual([
        expect.objectContaining({
          externalId: "job-1",
          companyVacancyEvidence: expect.objectContaining({ kind: "known_ats_posting" }),
        }),
      ]);
    } finally {
      if (previous === undefined) delete process.env["COMPANY_SITE_GENERIC_IMPORT_ENABLED"];
      else process.env["COMPANY_SITE_GENERIC_IMPORT_ENABLED"] = previous;
    }
  });

  it("does not persist generic-only company-site adverts while generic imports are disabled", async () => {
    const previous = process.env["COMPANY_SITE_GENERIC_IMPORT_ENABLED"];
    process.env["COMPANY_SITE_GENERIC_IMPORT_ENABLED"] = "false";
    discoverCompanySiteVacanciesMock.mockResolvedValue({
      adverts: [{
        organisationName: "Example Ltd",
        employer: "Example Ltd",
        title: "Unverified role",
        location: "London",
        salary: null,
        url: "https://example.test/jobs/unverified",
        description: null,
        postedDate: null,
        targetRegions: null,
        boardName: null,
        externalId: null,
        sourceType: "company_site",
        companyVacancyEvidence: { kind: "generic_link" },
      }],
      sourceUrl: "https://example.test/",
      careersUrl: null,
      atsProvider: null,
      genericCompleted: true,
      atsCompleted: false,
      transientFailure: false,
      completion: "complete",
      pagesFetched: 1,
      advertsExtracted: 1,
      advertsRejected: 0,
    } as never);

    try {
      await runCompanySiteCheck({
        organisationName: "Example Ltd",
        website: "https://example.test",
        genericCheckedAt: null,
        atsCheckedAt: null,
        careersUrl: null,
        atsProvider: null,
        atsBoardId: null,
        atsMappingStatus: "unverified",
      });

      expect(persistCompanySiteVacanciesMock).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env["COMPANY_SITE_GENERIC_IMPORT_ENABLED"];
      else process.env["COMPANY_SITE_GENERIC_IMPORT_ENABLED"] = previous;
    }
  });

  it("verifies a parseable ATS mapping only after first-party evidence is observed", async () => {
    let persisted: Record<string, unknown> | undefined;
    insertMock.mockReturnValue({
      values: (values: Record<string, unknown>) => {
        persisted = values;
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    });
    discoverCompanySiteVacanciesMock.mockResolvedValue({
      adverts: [],
      sourceUrl: "https://example.test/",
      careersUrl: "https://jobs.ashbyhq.com/example",
      atsProvider: "Ashby",
      atsMappingVerified: true,
      atsMappingEvidenceUrl: "https://example.test/careers",
      genericCompleted: true,
      atsCompleted: true,
      transientFailure: false,
      completion: "complete",
      pagesFetched: 1,
      advertsExtracted: 0,
      advertsRejected: 0,
    });

    await runCompanySiteCheck({
      organisationName: "Example Ltd",
      website: "https://example.test",
      genericCheckedAt: null,
      atsCheckedAt: null,
      careersUrl: null,
      atsProvider: null,
      atsMappingStatus: "unverified",
    });

    expect(persisted).toEqual(expect.objectContaining({
      atsBoardId: "example",
      atsMappingEvidenceUrl: "https://example.test/careers",
      atsMappingStatus: "verified",
    }));
  });

  it("preserves an existing verified careers and ATS mapping during targeted discovery", async () => {
    let persisted: Record<string, unknown> | undefined;
    selectMock.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{
            careersUrl: "https://jobs.ashbyhq.com/old",
            atsProvider: "Ashby",
            atsBoardId: "old",
            atsMappingEvidenceUrl: "https://example.test/careers-old",
            atsMappingStatus: "verified",
          }]),
        }),
      }),
    });
    insertMock.mockReturnValue({
      values: (values: Record<string, unknown>) => {
        persisted = values;
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    });
    discoverCompanySiteVacanciesMock.mockResolvedValue({
      adverts: [],
      sourceUrl: "https://example.test/",
      careersUrl: "https://jobs.ashbyhq.com/new",
      atsProvider: "Ashby",
      atsMappingVerified: true,
      atsMappingEvidenceUrl: "https://example.test/new-careers",
      genericCompleted: true,
      atsCompleted: true,
      transientFailure: false,
      completion: "complete",
      pagesFetched: 1,
      advertsExtracted: 0,
      advertsRejected: 0,
    });

    await runCompanySiteCheck({
      organisationName: "Example Ltd",
      website: "https://example.test",
      genericCheckedAt: null,
      atsCheckedAt: null,
      careersUrl: "https://jobs.ashbyhq.com/old",
      atsProvider: "Ashby",
      atsMappingStatus: "verified",
    }, { preserveExistingSiteMetadata: true, queueVerifications: false });

    expect(persisted).toEqual(expect.objectContaining({
      careersUrl: "https://jobs.ashbyhq.com/old",
      atsProvider: "Ashby",
      atsBoardId: "old",
      atsMappingEvidenceUrl: "https://example.test/careers-old",
      atsMappingStatus: "verified",
    }));
  });

  it("repeats the same vacancy upsert without re-queueing verification", async () => {
    vi.stubEnv("COMPANY_SITE_GENERIC_IMPORT_ENABLED", "true");
    persistCompanySiteVacanciesMock
      .mockResolvedValueOnce({ inserted: 1, updated: 0, revived: 0 })
      .mockResolvedValueOnce({ inserted: 0, updated: 1, revived: 0 });
    discoverCompanySiteVacanciesMock.mockResolvedValue({
      adverts: [{
        organisationName: "Example Ltd",
        title: "Care Assistant",
        employer: "Example Ltd",
        location: "London",
        salary: null,
        url: "https://example.test/jobs/1",
        description: null,
        postedDate: null,
        targetRegions: null,
        boardName: null,
        externalId: null,
      }],
      pagesFetched: 1,
      genericCompleted: true,
      atsCompleted: false,
      transientFailure: false,
      completion: "complete",
      advertsExtracted: 1,
      advertsRejected: 0,
    });

    const outcome = await runCompanySiteCheck({
      organisationName: "Example Ltd",
      website: "https://example.test",
      genericCheckedAt: null,
      atsCheckedAt: null,
      careersUrl: null,
      atsProvider: null,
    }, {
      queueVerifications: false,
      verifyImportIdempotency: true,
    });

    expect(outcome).toEqual(expect.objectContaining({
      inserted: 1,
      repeatImport: { inserted: 0, updated: 1, revived: 0 },
    }));
    expect(persistCompanySiteVacanciesMock).toHaveBeenNthCalledWith(
      1,
      expect.any(Array),
      { queueVerifications: false },
    );
    expect(persistCompanySiteVacanciesMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Array),
      { queueVerifications: false },
    );
  });

  it("quarantines a permanent failure without stamping it complete", async () => {
    const before = Date.now();
    let persisted: Record<string, unknown> | undefined;
    insertMock.mockReturnValue({
      values: (values: Record<string, unknown>) => {
        persisted = values;
        return {
          onConflictDoUpdate: () => Promise.resolve(),
        };
      },
    });
    discoverCompanySiteVacanciesMock.mockResolvedValue({
      adverts: [],
      pagesFetched: 0,
      genericCompleted: false,
      atsCompleted: false,
      transientFailure: false,
      failureClass: "permanent",
      completion: "failed",
      error: "redirect outside employer or approved ATS",
      advertsExtracted: 0,
      advertsRejected: 0,
    });

    const outcome = await runCompanySiteCheck({
      organisationName: "Dead Employer",
      website: "https://dead.example",
      genericCheckedAt: null,
      atsCheckedAt: null,
      careersUrl: null,
      atsProvider: null,
    });

    expect(outcome).toEqual(expect.objectContaining({
      failureClass: "permanent",
      completion: "failed",
    }));
    expect(persisted?.lastOutcome).toBe("failed");
    expect(persisted?.genericCheckedAt).toBeNull();
    expect((persisted?.retryAfter as Date).getTime()).toBeGreaterThanOrEqual(
      before + COMPANY_SITE_PERMANENT_RETRY_MS,
    );
  });

  it("briefly defers a partial employer so frequent batches make queue progress", async () => {
    const before = Date.now();
    let persisted: Record<string, unknown> | undefined;
    insertMock.mockReturnValue({
      values: (values: Record<string, unknown>) => {
        persisted = values;
        return {
          onConflictDoUpdate: () => Promise.resolve(),
        };
      },
    });
    discoverCompanySiteVacanciesMock.mockResolvedValue({
      adverts: [],
      pagesFetched: 6,
      genericCompleted: true,
      atsCompleted: false,
      transientFailure: false,
      completion: "partial_page_limit",
      advertsExtracted: 0,
      advertsRejected: 0,
    });

    await runCompanySiteCheck({
      organisationName: "Partial Employer",
      website: "https://partial.example",
      genericCheckedAt: null,
      atsCheckedAt: null,
      careersUrl: null,
      atsProvider: null,
    });

    expect(persisted?.lastOutcome).toBe("partial_page_limit");
    expect((persisted?.retryAfter as Date).getTime()).toBeGreaterThanOrEqual(
      before + COMPANY_SITE_PARTIAL_RETRY_MS,
    );
  });

  it("finishes a ten-employer HTTP batch while reserving time for final writes", async () => {
    executeMock.mockResolvedValue({
      rows: Array.from({ length: 10 }, (_, index) => ({
        id: index + 1,
        organisation_name: `Employer ${index + 1}`,
        website: `https://employer-${index + 1}.example`,
        generic_checked_at: null,
        ats_checked_at: null,
        careers_url: null,
        ats_provider: null,
        bookmarked: false,
      })),
    });
    discoverCompanySiteVacanciesMock.mockResolvedValue({
      adverts: [],
      pagesFetched: 1,
      genericCompleted: true,
      atsCompleted: false,
      transientFailure: false,
    });
    const deadlineMs = Date.now() + 20_000;

    const summary = await runCompanySiteDiscoveryBatch({ batchSize: 10, deadlineMs });

    expect(summary).toEqual(expect.objectContaining({
      selected: 10,
      checked: 10,
      errors: 0,
      done: true,
      remaining: 0,
    }));
    expect(discoverCompanySiteVacanciesMock).toHaveBeenCalledTimes(10);
    expect(discoverCompanySiteVacanciesMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        deadlineMs: deadlineMs - COMPANY_SITE_BATCH_WRITE_RESERVE_MS,
      }),
    );
  });

  it("records opt-in employer pilot metrics and counts updates as persisted work", async () => {
    vi.stubEnv("COMPANY_SITE_GENERIC_IMPORT_ENABLED", "true");
    executeMock.mockResolvedValue({
      rows: [{
        id: 1,
        organisation_name: "Metric Employer",
        website: "https://metric.example",
        industry: "Technology",
        generic_checked_at: null,
        ats_checked_at: null,
        careers_url: null,
        ats_provider: null,
        bookmarked: false,
        healthcare_evidence_backfill: false,
      }],
    });
    discoverCompanySiteVacanciesMock.mockResolvedValue({
      adverts: [{
        organisationName: "Metric Employer",
        employer: "Metric Employer",
        title: "Technical Support",
        location: "London, UK",
        salary: null,
        url: "https://metric.example/jobs/technical-support",
        description: null,
        postedDate: null,
        targetRegions: null,
        boardName: null,
        externalId: null,
        sourceType: "company_site",
      }],
      sourceUrl: "https://metric.example/",
      careersUrl: "https://metric.example/careers",
      atsProvider: null,
      genericCompleted: true,
      atsCompleted: true,
      transientFailure: false,
      failureClass: null,
      pagesFetched: 2,
      completion: "complete",
      pagesAttempted: 2,
      advertsExtracted: 3,
      advertsRejected: 1,
      rejectionReasons: {},
      discoveredUrls: [],
      observedAdvertUrls: ["https://metric.example/jobs/technical-support"],
      resumeState: null,
    });
    persistCompanySiteVacanciesMock.mockResolvedValue({
      inserted: 0,
      updated: 1,
      revived: 0,
    });
    const previousTelemetry = process.env["COMPANY_SITE_PILOT_TELEMETRY"];
    process.env["COMPANY_SITE_PILOT_TELEMETRY"] = "1";

    try {
      const summary = await runCompanySiteDiscoveryBatch({ batchSize: 1 });

      expect(summary).toEqual(expect.objectContaining({
        updated: 1,
        upserted: 1,
        employerMetrics: [
          expect.objectContaining({
            organisationName: "Metric Employer",
            industry: "Technology",
            sourceUrl: "https://metric.example",
            careersUrl: "https://metric.example/careers",
            status: "checked",
            completion: "complete",
            elapsedMs: expect.any(Number),
            pagesFetched: 2,
            rawAdvertsFound: 3,
            acceptedAdverts: 1,
            updated: 1,
            advertsRejected: 1,
            ukLocationKnown: 1,
            ukLocationUnknown: 0,
          }),
        ],
      }));
    } finally {
      if (previousTelemetry === undefined) {
        delete process.env["COMPANY_SITE_PILOT_TELEMETRY"];
      } else {
        process.env["COMPANY_SITE_PILOT_TELEMETRY"] = previousTelemetry;
      }
    }
  });

  it("defers selected employers when only the database-write reserve remains", async () => {
    executeMock.mockResolvedValue({
      rows: [{
        id: 1,
        organisation_name: "Deferred Employer",
        website: "https://deferred.example",
        generic_checked_at: null,
        ats_checked_at: null,
        careers_url: null,
        ats_provider: null,
        bookmarked: false,
      }],
    });

    const summary = await runCompanySiteDiscoveryBatch({
      batchSize: 1,
      deadlineMs: Date.now() + COMPANY_SITE_BATCH_WRITE_RESERVE_MS,
    });

    expect(summary).toEqual(expect.objectContaining({
      selected: 1,
      checked: 0,
      errors: 0,
      done: false,
      remaining: 1,
      remainingIsLowerBound: false,
    }));
    expect(discoverCompanySiteVacanciesMock).not.toHaveBeenCalled();
  });

  it("contains a terminated employer-state connection after one bounded retry", async () => {
    const driverError = Object.assign(
      new Error("terminating connection due to administrator command"),
      { code: "57P01" },
    );
    const wrappedError = Object.assign(new Error("Failed query"), { cause: driverError });
    executeMock
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          organisation_name: "Connection Test Employer",
          website: "https://connection-test.example",
          generic_checked_at: null,
          ats_checked_at: null,
          careers_url: null,
          ats_provider: null,
          bookmarked: false,
          healthcare_evidence_backfill: false,
        }],
      })
      .mockResolvedValue({ rows: [] });
    discoverCompanySiteVacanciesMock.mockResolvedValue({
      adverts: [],
      pagesFetched: 1,
      genericCompleted: true,
      atsCompleted: false,
      transientFailure: false,
      completion: "complete",
      advertsExtracted: 0,
      advertsRejected: 0,
      observedAdvertUrls: [],
    });
    const write = vi.fn().mockRejectedValue(wrappedError);
    insertMock.mockReturnValue({
      values: () => ({
        onConflictDoUpdate: write,
      }),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const summary = await runCompanySiteDiscoveryBatch({ batchSize: 1 });

    expect(write).toHaveBeenCalledTimes(2);
    expect(summary).toEqual(expect.objectContaining({
      selected: 1,
      checked: 0,
      completed: 0,
      failed: 0,
      errors: 1,
      temporaryFailures: 1,
    }));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("code=57P01"));
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("logs probe classification metrics under the dedicated job kind", async () => {
    executeMock.mockResolvedValue({
      rows: [{
        organisation_name: "Probe Employer",
        website: "https://probe.example",
      }],
    });
    runCompanySiteProbeBatchMock.mockResolvedValue({
      selected: 1,
      checked: 1,
      okForCrawl: 1,
      temporaryBad: 0,
      permanentBad: 0,
      skipped: 0,
      deferred: 0,
      errors: 0,
      done: true,
      remaining: 0,
      remainingIsLowerBound: false,
      durationMs: 25,
    });
    let logged: Record<string, unknown> | undefined;
    insertMock.mockReturnValue({
      values: (values: Record<string, unknown>) => {
        logged = values;
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    });

    await runCompanySiteProbeDiscoveryBatch({ batchSize: 1 });

    expect(logged).toEqual(expect.objectContaining({
      jobKind: "company_site_probe",
      checkedCount: 1,
      metrics: expect.objectContaining({ okForCrawl: 1 }),
    }));
  });
});
