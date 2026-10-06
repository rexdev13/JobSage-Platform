import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  sponsorRows: [] as Array<{ organisationName: string }>,
  vacancyRows: [] as Array<Record<string, unknown>>,
  upsert: vi.fn(),
  transaction: vi.fn(),
  updatedEvidenceValues: [] as Array<Record<string, unknown>>,
  vacancyTable: {
    id: "vacancy-id",
    url: "vacancy-url",
    organisationName: "vacancy-employer",
    title: "vacancy-title",
    sourceType: "vacancy-source-type",
    applicationUrl: "vacancy-application-url",
    createdAt: "vacancy-created-at",
    lastVerifiedAt: "vacancy-last-verified-at",
    liveness: "vacancy-liveness",
    companyVacancyEvidence: "vacancy-evidence",
  },
}));

vi.mock("@workspace/db", () => ({
  db: { select: mocks.select, transaction: mocks.transaction },
  sponsorLicencesTable: { organisationName: "sponsor-name-column" },
  sponsorLicenceVacanciesTable: mocks.vacancyTable,
}));
vi.mock("drizzle-orm", () => ({
  inArray: (column: unknown, values: unknown[]) => ({ column, values }),
  and: (...clauses: unknown[]) => ({ clauses }),
  eq: (column: unknown, value: unknown) => ({ column, value, operator: "eq" }),
  gte: (column: unknown, value: unknown) => ({ column, value, operator: "gte" }),
  lte: (column: unknown, value: unknown) => ({ column, value, operator: "lte" }),
}));
vi.mock("../../lib/boardVacancyPipeline", () => ({
  boardVacancyFingerprint: (advert: { organisationName: string; title: string; location: string | null }) =>
    `${advert.organisationName}|${advert.title}|${advert.location ?? ""}`.toLowerCase(),
  normaliseAndDedupeBoardAdverts: (adverts: unknown[]) => adverts,
  upsertSharedBoardVacancies: mocks.upsert,
}));
vi.mock("../../lib/sponsorWebsiteCrossEnvIdentity", () => ({
  normalizeSponsorLegalNameValue: (value: string | null | undefined) =>
    (value ?? "").trim().toLowerCase().replace(/\bltd\.?$/, "limited"),
}));
vi.mock("../../lib/vacancySource", () => ({
  canonicalVacancyUrl: (value: string) => {
    try {
      const parsed = new URL(value);
      parsed.hash = "";
      if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
      return parsed.toString();
    } catch {
      return null;
    }
  },
}));
vi.mock("../../lib/vacancyUrlPolicy", () => ({
  isBlockedVacancyUrl: () => false,
  isValidVacancyUrlForSource: (value: string | null | undefined, source: string) => {
    try {
      const parsed = new URL(value ?? "");
      return source === "company_site" && parsed.protocol === "https:" && parsed.pathname.length > 8;
    } catch {
      return false;
    }
  },
}));
vi.mock("../../lib/healthcareRoleEvidence", () => ({
  buildStrictHealthcareRoleEvidence: (input: {
    title: string;
    listingUrl: string;
    detailUrl: string;
    applicationUrl?: string | null;
  }) => /\b(?:nurse|care assistant)\b/i.test(input.title)
    ? {
        kind: "strict_role_page",
        sector: "healthcare",
        listingUrl: input.listingUrl,
        detailUrl: input.detailUrl,
        applicationUrl: input.applicationUrl,
        trustedSource: "manual_review",
        roleEligibilityReview: {
          status: "approved",
          socCode: "2231",
          evidenceUrl: input.detailUrl,
        },
      }
    : null,
}));

const importer = await import("../../lib/reviewedCompanySiteImport");

const headers = [
  "source_row",
  "source_employer",
  "source_title",
  "source_location",
  "source_careers_page",
  "listing_url",
  "source_type",
  "listing_fetch_status",
  "listing_http_status",
  "listing_final_url",
  "page_employer_match",
  "page_title",
  "page_title_match",
  "closing_date",
  "explicit_closed_phrase",
  "current_status",
  "application_url",
  "application_final_url",
  "application_http_status",
  "application_status",
  "application_job_specific",
  "decision",
  "checked_at_utc",
  "sponsor_ids",
  "database_match_status",
  "database_match_ids",
];

function sourceRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    source_row: "1",
    source_employer: "Example Healthcare Ltd",
    source_title: "Registered Nurse",
    source_location: "London",
    source_careers_page: "https://example.org/careers",
    listing_url: "https://example.org/jobs/registered-nurse",
    source_type: "company_site",
    listing_fetch_status: "HTTP_200",
    listing_http_status: "200",
    listing_final_url: "https://example.org/jobs/registered-nurse",
    page_employer_match: "MATCH",
    page_title: "Registered Nurse",
    page_title_match: "MATCH",
    closing_date: "",
    explicit_closed_phrase: "false",
    current_status: "CURRENT",
    application_url: "https://example.org/jobs/registered-nurse",
    application_final_url: "https://example.org/jobs/registered-nurse",
    application_http_status: "200",
    application_status: "REACHABLE_JOB_SPECIFIC_SAME_PAGE",
    application_job_specific: "true",
    decision: "READY",
    checked_at_utc: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    sponsor_ids: "dev-sponsor-id-must-not-be-used",
    database_match_status: "NO_MATCH",
    database_match_ids: "dev-vacancy-id-must-not-be-used",
    ...overrides,
  };
}

function csv(rows: Array<Record<string, string>>): Buffer {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return Buffer.from([
    headers.map(quote).join(","),
    ...rows.map((row) => headers.map((header) => quote(row[header] ?? "")).join(",")),
  ].join("\n"), "utf8");
}

describe("reviewed company-site vacancy import", () => {
  const oldSecret = process.env.VACANCY_JOB_SECRET;
  const oldNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.VACANCY_JOB_SECRET = "unit-test-import-secret";
    process.env.NODE_ENV = "test";
    mocks.sponsorRows = [{ organisationName: "Example Healthcare Ltd" }];
    mocks.vacancyRows = [];
    mocks.updatedEvidenceValues = [];
    mocks.select.mockImplementation(() => {
      let selectedTable: unknown;
      const query = {
        from: vi.fn((table: unknown) => {
          selectedTable = table;
          return query;
        }),
        where: vi.fn().mockImplementation(async () =>
          selectedTable === mocks.vacancyTable ? mocks.vacancyRows : mocks.sponsorRows,
        ),
      };
      return query;
    });
    mocks.transaction.mockImplementation(async (run: (transaction: unknown) => Promise<unknown>) => {
      const transaction = {
        update: vi.fn(() => ({
          set: vi.fn((values: Record<string, unknown>) => {
            mocks.updatedEvidenceValues.push(values);
            return {
              where: vi.fn(() => ({
                returning: vi.fn().mockResolvedValue([{ id: mocks.updatedEvidenceValues.length }]),
              })),
            };
          }),
        })),
      };
      return run(transaction);
    });
    mocks.upsert.mockImplementation(async (
      adverts: Array<{ reviewedSourceRow?: string; url: string }>,
      options: { dryRun?: boolean },
    ) => ({
      inserted: options.dryRun ? 0 : adverts.length,
      updated: 0,
      revived: 0,
      outcomes: adverts.map((advert) => ({
        sourceRow: advert.reviewedSourceRow ?? null,
        url: advert.url,
        status: options.dryRun ? "would_insert" : "inserted",
      })),
    }));
  });

  afterEach(() => {
    if (oldSecret == null) delete process.env.VACANCY_JOB_SECRET;
    else process.env.VACANCY_JOB_SECRET = oldSecret;
    if (oldNodeEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
    vi.clearAllMocks();
  });

  it("ignores source database IDs and resolves the employer by name in the active environment", async () => {
    const file = csv([sourceRow({
      application_status: "REACHABLE_JOB_SPECIFIC",
      closing_date: "2099-12-31T23:59:59.000Z",
    })]);
    const preview = await importer.previewReviewedCompanySiteCsv(file);

    expect(preview.counts).toMatchObject({ sourceRows: 1, wouldInsert: 1, held: 0 });
    expect(mocks.select).toHaveBeenCalledWith({ organisationName: "sponsor-name-column" });
    expect(mocks.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({
        organisationName: "Example Healthcare Ltd",
        sourceType: "company_site",
        reviewedSourceRow: "1",
      })],
      expect.objectContaining({
        dryRun: true,
        skipExisting: true,
        enrichContacts: false,
        queueVerifications: false,
      }),
    );
    const passedAdvert = mocks.upsert.mock.calls[0]?.[0]?.[0] as Record<string, unknown>;
    expect(passedAdvert).not.toHaveProperty("sponsor_ids");
    expect(passedAdvert).not.toHaveProperty("database_match_ids");
    expect(passedAdvert).not.toHaveProperty("sponsorLicenceId");
    expect(passedAdvert).not.toHaveProperty("closesAt");
  });

  it("rejects a CSV without the reviewed validation columns", async () => {
    await expect(
      importer.previewReviewedCompanySiteCsv(Buffer.from("source_row,title\n1,Nurse\n")),
    ).rejects.toThrow("missing required columns");
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("holds non-READY, stale, and duplicate rows without passing them to the writer", async () => {
    const rows = [
      sourceRow({ source_row: "1", decision: "HOLD" }),
      sourceRow({
        source_row: "2",
        checked_at_utc: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
      }),
      sourceRow({ source_row: "3" }),
      sourceRow({ source_row: "4" }),
    ];
    const preview = await importer.previewReviewedCompanySiteCsv(csv(rows));

    expect(preview.counts).toMatchObject({ sourceRows: 4, wouldInsert: 1, held: 3 });
    expect(preview.rows.find((row) => row.sourceRow === "1")).toMatchObject({
      status: "held",
      reason: "Source validation did not mark this row READY.",
    });
    expect(preview.rows.find((row) => row.sourceRow === "2")?.reason).toContain("older than 48 hours");
    expect(preview.rows.find((row) => row.sourceRow === "4")?.reason).toContain("Duplicate canonical listing URL");
    expect(mocks.upsert.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("does not import rows whose employer cannot be resolved locally", async () => {
    mocks.sponsorRows = [];
    const preview = await importer.previewReviewedCompanySiteCsv(csv([sourceRow()]));

    expect(preview.counts).toMatchObject({ wouldInsert: 0, held: 1 });
    expect(preview.rows[0]).toMatchObject({
      status: "held",
      reason: "Employer name does not resolve in the target environment's sponsor register.",
    });
    expect(mocks.upsert.mock.calls[0]?.[0]).toEqual([]);
  });

  it("inserts only newly reviewed rows and marks their safe liveness check pending", async () => {
    const file = csv([sourceRow()]);
    const preview = await importer.previewReviewedCompanySiteCsv(file);

    const applied = await importer.applyReviewedCompanySiteCsv(file, preview.dryRunToken);

    expect(applied.counts).toMatchObject({ inserted: 1, alreadyPresent: 0, held: 0 });
    expect(applied.rows[0]).toMatchObject({
      status: "inserted",
      verificationStatus: "queued_unverified",
    });
    expect(mocks.upsert).toHaveBeenLastCalledWith(
      [expect.objectContaining({ reviewedSourceRow: "1" })],
      expect.objectContaining({
        skipExisting: true,
        enrichContacts: false,
        queueVerifications: true,
      }),
    );
  });

  it("uses skip-existing/no-enrichment options on apply and reports a raced duplicate without overwriting it", async () => {
    const file = csv([sourceRow()]);
    const preview = await importer.previewReviewedCompanySiteCsv(file);
    mocks.upsert.mockImplementation(async (
      adverts: Array<{ reviewedSourceRow?: string; url: string }>,
      options: { dryRun?: boolean },
    ) => ({
      inserted: 0,
      updated: 0,
      revived: 0,
      outcomes: adverts.map((advert) => ({
        sourceRow: advert.reviewedSourceRow ?? null,
        url: advert.url,
        status: options.dryRun ? "would_insert" : "already_present",
        ...(options.dryRun ? {} : { matchedBy: "canonical_url" }),
      })),
    }));

    const applied = await importer.applyReviewedCompanySiteCsv(file, preview.dryRunToken);

    expect(applied.counts).toMatchObject({ inserted: 0, alreadyPresent: 1, held: 0 });
    expect(applied.rows[0]).toMatchObject({ status: "already_present", matchedBy: "canonical_url" });
    expect(mocks.upsert).toHaveBeenLastCalledWith(
      [expect.objectContaining({ reviewedSourceRow: "1" })],
      expect.objectContaining({
        skipExisting: true,
        enrichContacts: false,
        queueVerifications: true,
      }),
    );
  });

  it("rejects a changed file or environment before another writer call", async () => {
    const file = csv([sourceRow()]);
    const preview = await importer.previewReviewedCompanySiteCsv(file);
    const callsAfterPreview = mocks.upsert.mock.calls.length;

    await expect(
      importer.applyReviewedCompanySiteCsv(Buffer.concat([file, Buffer.from("\n")]), preview.dryRunToken),
    ).rejects.toThrow("Preview token expired or no longer matches");
    process.env.NODE_ENV = "production";
    await expect(
      importer.applyReviewedCompanySiteCsv(file, preview.dryRunToken),
    ).rejects.toThrow("Preview token expired or no longer matches");
    expect(mocks.upsert).toHaveBeenCalledTimes(callsAfterPreview);
  });

  it("repairs only the exact inserted production cohort and leaves unsupported roles hidden", async () => {
    const rows = Array.from({ length: 158 }, (_, index) => {
      const sourceIndex = index + 1;
      const url = `https://example.org/jobs/role-${sourceIndex}`;
      return sourceRow({
        source_row: String(sourceIndex),
        source_title: sourceIndex % 2 === 1 ? "Registered Nurse" : "Housekeeper",
        source_location: `Location ${sourceIndex}`,
        listing_url: url,
        listing_final_url: url,
        application_url: url,
        application_final_url: url,
      });
    });
    const file = csv(rows);
    const applyReportId = "54cd3a9d-f189-4dc2-ac16-e91f2e8afcb0";
    const generatedAt = new Date().toISOString();
    const createdAt = new Date(Date.now() - 60_000);
    const legacyEvidence = (row: Record<string, string>) => ({
      kind: "strict_role_page",
      listingUrl: row.source_careers_page,
      detailUrl: row.listing_final_url,
      applicationUrl: row.application_final_url || row.application_url,
    });
    const applicationRows = rows.map((row) => ({
      sourceRow: row.source_row,
      employer: row.source_employer,
      title: row.source_title,
      listingUrl: row.listing_url,
      applicationUrl: row.application_final_url,
      status: "inserted",
    }));
    const appliedReport = {
      reportId: applyReportId,
      reportKind: "apply",
      workflow: "reviewed_explicit_company_site_vacancy_import",
      mode: "apply",
      environment: "production",
      generatedAt,
      inputSha256: (await importer.previewReviewedCompanySiteCsv(file)).inputSha256,
      counts: { inserted: 158 },
      rows: applicationRows,
    };
    mocks.upsert.mockImplementation(async (
      adverts: Array<{ reviewedSourceRow?: string; url: string }>,
    ) => ({
      inserted: 0,
      updated: 0,
      revived: 0,
      outcomes: adverts.map((advert) => ({
        sourceRow: advert.reviewedSourceRow ?? null,
        url: advert.url,
        status: "already_present",
        matchedBy: "canonical_url",
      })),
    }));
    mocks.vacancyRows = rows.map((row, index) => ({
      id: index + 1,
      url: row.listing_url,
      organisationName: row.source_employer,
      title: row.source_title,
      sourceType: "company_site",
      applicationUrl: row.application_final_url,
      createdAt,
      lastVerifiedAt: createdAt,
      liveness: index < 17 ? "unverified" : "live",
      companyVacancyEvidence: legacyEvidence(row),
    }));
    process.env.NODE_ENV = "production";

    const result = await importer.repairReviewedCompanySiteEvidence(file, applyReportId, appliedReport);

    expect(result.counts).toEqual({
      insertedRows: 158,
      evidenceUpdated: 158,
      alreadyCorrect: 0,
      candidateEvidenceSupported: 79,
      unsupportedRoleEvidence: 79,
      verificationQueued: 17,
    });
    expect(result.rows[0]).toMatchObject({ candidateEvidenceSupported: true, evidenceStatus: "updated" });
    expect(result.rows[1]).toMatchObject({ candidateEvidenceSupported: false, evidenceStatus: "updated" });
    expect(result.verificationQueue).toHaveLength(17);
    expect(mocks.updatedEvidenceValues).toHaveLength(158);
    expect(mocks.updatedEvidenceValues.every((value) =>
      Object.keys(value).join(",") === "companyVacancyEvidence",
    )).toBe(true);
    expect(mocks.updatedEvidenceValues[0]?.companyVacancyEvidence).toMatchObject({
      sector: "healthcare",
      trustedSource: "manual_review",
    });
    expect(mocks.updatedEvidenceValues[1]?.companyVacancyEvidence).toBeNull();
  });

  it("rejects any repair report other than the fixed production import before planning or writing", async () => {
    process.env.NODE_ENV = "production";
    await expect(
      importer.repairReviewedCompanySiteEvidence(
        csv([sourceRow()]),
        "different-report-id",
        {},
      ),
    ).rejects.toThrow("not the authorized repair cohort");
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
