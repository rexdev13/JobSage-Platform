import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  existingRows: [] as Array<Record<string, unknown>>,
  insertValues: vi.fn(),
  updateSet: vi.fn(),
  enrichContacts: vi.fn(),
  queueCompanyVerification: vi.fn(),
  queueBoardVerification: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const table = {
    id: "id",
    organisationName: "organisationName",
    checkDate: "checkDate",
    title: "title",
    location: "location",
    salary: "salary",
    url: "url",
    applicationUrl: "applicationUrl",
    description: "description",
    postedDate: "postedDate",
    targetRegions: "targetRegions",
    sourceType: "sourceType",
    boardName: "boardName",
    externalListingId: "externalListingId",
    closesAt: "closesAt",
    expiresAt: "expiresAt",
    closedReason: "closedReason",
    companyVacancyEvidence: "companyVacancyEvidence",
    companyEvidenceLegacyUntil: "companyEvidenceLegacyUntil",
    liveness: "liveness",
    lastVerifiedAt: "lastVerifiedAt",
    livenessReason: "livenessReason",
    lastDiscoveredAt: "lastDiscoveredAt",
    sourceMissingSince: "sourceMissingSince",
    sourceMissingObservations: "sourceMissingObservations",
  };
  return {
    sponsorLicenceVacanciesTable: table,
    db: { transaction: mocks.transaction },
  };
});

vi.mock("drizzle-orm", () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values });
  return {
    and: (...values: unknown[]) => ({ and: values }),
    eq: (...values: unknown[]) => ({ eq: values }),
    inArray: (...values: unknown[]) => ({ inArray: values }),
    or: (...values: unknown[]) => ({ or: values }),
    sql,
  };
});
vi.mock("../../lib/vacancyAdvertContact", () => ({
  enrichAdvertContacts: mocks.enrichContacts,
}));
vi.mock("../../lib/companySiteVerification", () => ({
  queueCompanySiteVerificationBatch: mocks.queueCompanyVerification,
}));
vi.mock("../../lib/linkVerification", () => ({
  queueLinkVerificationBatch: mocks.queueBoardVerification,
}));

const pipeline = await import("../../lib/boardVacancyPipeline");

function advert(overrides: Record<string, unknown> = {}) {
  return {
    organisationName: "Example Healthcare Ltd",
    employer: "Example Healthcare Ltd",
    title: "Registered Nurse",
    location: "London",
    salary: null,
    url: "https://careers.example.org/jobs/registered-nurse",
    applicationUrl: "https://careers.example.org/jobs/registered-nurse",
    description: null,
    postedDate: null,
    targetRegions: null,
    boardName: null,
    externalId: null,
    sourceType: "company_site" as const,
    companyVacancyEvidence: {
      kind: "strict_role_page" as const,
      listingUrl: "https://example.org/careers",
      detailUrl: "https://careers.example.org/jobs/registered-nurse",
      applicationUrl: "https://careers.example.org/jobs/registered-nurse",
    },
    reviewedSourceRow: "1",
    ...overrides,
  };
}

function existingVacancy() {
  return {
    id: 44,
    organisationName: "Example Healthcare Ltd",
    sourceType: "company_site",
    externalListingId: null,
    boardName: null,
    url: "https://careers.example.org/jobs/registered-nurse",
    title: "Registered Nurse",
    location: "London",
    applicationUrl: "https://careers.example.org/jobs/registered-nurse",
    companyVacancyEvidence: { kind: "strict_role_page" },
    liveness: "unverified",
    targetRegions: [],
  };
}

function makeTransaction() {
  const tx = {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(mocks.existingRows),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => {
        mocks.updateSet(values);
        return {
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([]),
          })),
        };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: unknown) => {
        mocks.insertValues(values);
        return {
          returning: vi.fn().mockResolvedValue([{ id: 45, url: "https://careers.example.org/jobs/registered-nurse", applicationUrl: null, liveness: "unverified" }]),
        };
      }),
    })),
  };
  return tx;
}

describe("shared vacancy writer reviewed-import options", () => {
  let tx: ReturnType<typeof makeTransaction>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existingRows = [];
    tx = makeTransaction();
    mocks.transaction.mockImplementation(async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
    );
    mocks.enrichContacts.mockImplementation(async (adverts: unknown[]) => adverts);
  });

  it("skips a canonical existing match without updates, inserts, or contact writes", async () => {
    mocks.existingRows = [existingVacancy()];
    tx = makeTransaction();
    mocks.transaction.mockImplementation(async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
    );

    const result = await pipeline.upsertSharedBoardVacancies([advert()], {
      skipExisting: true,
      enrichContacts: false,
      includeOutcomes: true,
      queueVerifications: false,
    });

    expect(result).toMatchObject({
      inserted: 0,
      updated: 0,
      revived: 0,
      outcomes: [{
        sourceRow: "1",
        status: "already_present",
        matchedBy: "canonical_url",
      }],
    });
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.execute).toHaveBeenCalledTimes(1); // Advisory locks only; no contact SQL.
    expect(mocks.enrichContacts).not.toHaveBeenCalled();
  });

  it("dry-runs an explicit new row without writing or triggering enrichment", async () => {
    const result = await pipeline.upsertSharedBoardVacancies([advert()], {
      dryRun: true,
      skipExisting: true,
      enrichContacts: false,
      includeOutcomes: true,
      queueVerifications: false,
    });

    expect(result).toMatchObject({
      inserted: 0,
      updated: 0,
      revived: 0,
      outcomes: [{ sourceRow: "1", status: "would_insert" }],
    });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(mocks.enrichContacts).not.toHaveBeenCalled();
  });
});
