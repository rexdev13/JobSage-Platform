import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  PUBLIC_BOARD_REVALIDATION_FIELDS,
  publicBoardSourceRowHash,
  signPublicBoardRevalidation,
} from "../../lib/publicBoardRevalidationProof";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  sponsorRows: [] as Array<{ organisationName: string }>,
  upsert: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { select: mocks.select },
  sponsorLicencesTable: { organisationName: "sponsor-name-column" },
}));
vi.mock("drizzle-orm", () => ({
  inArray: (column: unknown, values: unknown[]) => ({ column, values }),
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
      return source === "job_board" && parsed.protocol === "https:" && parsed.pathname.length > 8;
    } catch {
      return false;
    }
  },
}));

const importer = await import("../../lib/reviewedPublicBoardImport");

const sourceHeaders = [
  "sponsor_name",
  "vacancy_category",
  "title",
  "employer",
  "location",
  "apply_url",
  "canonical_url_valid",
  "application_mode",
  "source",
  "external_id",
  "observed_at",
  "closes_at",
  "sponsor_match_status",
  "identity_import_eligible",
  "title_policy_eligible",
  "guarded_import_eligible",
  "sponsorship_status",
  "freshness_status",
  "candidate_visibility_status",
  "blocking_reason",
];
const headers = [...sourceHeaders, ...PUBLIC_BOARD_REVALIDATION_FIELDS];

function sourceRow(overrides: Record<string, string> = {}): Record<string, string> {
  const url = "https://beta.jobs.nhs.uk/candidate/jobadvert/C123";
  return {
    sponsor_name: "Example Healthcare Ltd",
    vacancy_category: "Nursing",
    title: "Registered Nurse",
    employer: "Example Healthcare Ltd",
    location: "London",
    apply_url: url,
    canonical_url_valid: "true",
    application_mode: "job_board",
    source: "NHS Jobs",
    external_id: "C123",
    observed_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    closes_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    sponsor_match_status: "exact-register-name",
    identity_import_eligible: "true",
    title_policy_eligible: "true",
    guarded_import_eligible: "true",
    sponsorship_status: "unknown",
    freshness_status: "current_source_observation",
    candidate_visibility_status: "eligible_after_import_and_persisted_liveness",
    blocking_reason: "",
    ...overrides,
  };
}

function csv(rows: Array<Record<string, string>>): Buffer {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const inputSha256 = createHash("sha256").update("guarded-public-board-source-fixture").digest("hex");
  const records: Array<Record<string, string>> = rows.map((row, index): Record<string, string> => {
    const sourceRecord = Object.fromEntries(sourceHeaders.map((header) => [header, row[header] ?? ""]));
    const status = row.revalidation_status ?? "live";
    const checkedAt = row.revalidated_at ?? new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const finalUrl = row.revalidated_final_url ?? row.apply_url;
    const reason = row.revalidation_reason ?? "";
    const sourceRow = String(index + 2);
    const totalRows = rows.length;
    const rowHash = publicBoardSourceRowHash(sourceRecord);
    const proof = signPublicBoardRevalidation({
      environment: process.env.NODE_ENV || "unknown",
      inputSha256,
      sourceRow,
      totalRows,
      url: row.apply_url ?? "",
      status,
      checkedAt,
      finalUrl,
      reason,
      rowHash,
    }, process.env.VACANCY_JOB_SECRET!);
    return {
      ...sourceRecord,
      revalidation_status: status,
      revalidated_at: checkedAt,
      revalidated_final_url: finalUrl,
      revalidation_reason: reason,
      revalidation_input_sha256: inputSha256,
      revalidation_source_row: sourceRow,
      revalidation_total_rows: String(totalRows),
      revalidation_row_hash: rowHash,
      revalidation_proof: proof,
    };
  });
  return Buffer.from([
    headers.map(quote).join(","),
    ...records.map((row) => headers.map((header) => quote(row[header] ?? "")).join(",")),
  ].join("\n"), "utf8");
}

describe("reviewed public-board vacancy import", () => {
  const oldSecret = process.env.VACANCY_JOB_SECRET;
  const oldNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.VACANCY_JOB_SECRET = "unit-test-public-board-secret";
    process.env.NODE_ENV = "test";
    mocks.sponsorRows = [{ organisationName: "Example Healthcare Ltd" }];
    mocks.upsert.mockReset();
    mocks.upsert.mockImplementation(async (
      adverts: Array<{ reviewedSourceRow?: string; url: string }>,
      options: { dryRun?: boolean },
    ) => ({
      outcomes: adverts.map((advert) => ({
        sourceRow: advert.reviewedSourceRow,
        url: advert.url,
        status: options.dryRun ? "would_insert" : "inserted",
      })),
    }));
    mocks.select.mockImplementation(() => {
      let selectedTable: unknown;
      const query = {
        from: vi.fn((table: unknown) => {
          selectedTable = table;
          return query;
        }),
        where: vi.fn().mockImplementation(async () =>
          selectedTable === "sponsor-licences" ? mocks.sponsorRows : mocks.sponsorRows,
        ),
      };
      return query;
    });
  });

  afterEach(() => {
    if (oldSecret === undefined) delete process.env.VACANCY_JOB_SECRET;
    else process.env.VACANCY_JOB_SECRET = oldSecret;
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
  });

  it("previews only rows passing audit, identity, freshness, and URL revalidation gates", async () => {
    const preview = await importer.previewReviewedPublicBoardCsv(csv([sourceRow()]));

    expect(preview.counts).toMatchObject({ sourceRows: 1, wouldInsert: 1, held: 0 });
    expect(preview.rows[0]).toMatchObject({ source: "NHS Jobs", status: "would_insert" });
    expect(mocks.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({
        organisationName: "Example Healthcare Ltd",
        sourceType: "job_board",
        sourceId: "job_board:nhs jobs",
        externalId: "C123",
        applicationUrl: "https://beta.jobs.nhs.uk/candidate/jobadvert/C123",
        reviewedSourceRow: "2",
      })],
      expect.objectContaining({ dryRun: true, skipExisting: true, enrichContacts: false }),
    );
  });

  it("holds unguarded or transiently revalidated rows without calling the writer", async () => {
    const preview = await importer.previewReviewedPublicBoardCsv(csv([
      sourceRow({ guarded_import_eligible: "false" }),
      sourceRow({
        external_id: "C124",
        apply_url: "https://beta.jobs.nhs.uk/candidate/jobadvert/C124",
        revalidation_status: "inconclusive",
        revalidation_reason: "HTTP 503",
      }),
    ]));

    expect(preview.counts).toMatchObject({ sourceRows: 2, held: 2, wouldInsert: 0 });
    expect(mocks.upsert).toHaveBeenCalledWith([], expect.objectContaining({ dryRun: true }));
  });

  it("holds sponsors that resolve to multiple distinct local register names", async () => {
    mocks.sponsorRows = [
      { organisationName: "Example Healthcare Ltd" },
      { organisationName: "Example Healthcare Limited" },
    ];

    const preview = await importer.previewReviewedPublicBoardCsv(csv([sourceRow()]));

    expect(preview.rows[0]).toMatchObject({
      status: "held",
      reason: "Sponsor name resolves to multiple distinct local register names.",
    });
  });

  it("applies only the exact previewed file and persists verified rows as live through the shared writer", async () => {
    const input = csv([sourceRow()]);
    const preview = await importer.previewReviewedPublicBoardCsv(input);
    mocks.upsert.mockClear();

    const report = await importer.applyReviewedPublicBoardCsv(input, preview.dryRunToken);

    expect(report.counts).toMatchObject({ inserted: 1, held: 0 });
    expect(report.rows[0]).toMatchObject({
      status: "inserted",
      verificationStatus: "verified_live_from_reviewed_revalidation",
    });
    expect(mocks.upsert).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({ reviewedSourceRow: "2" })],
      expect.objectContaining({
        skipExisting: true,
        verifiedLive: true,
        queueVerifications: false,
        enrichContacts: false,
      }),
    );
  });

  it("rejects changed file contents after preview", async () => {
    const original = csv([sourceRow()]);
    const preview = await importer.previewReviewedPublicBoardCsv(original);

    await expect(
      importer.applyReviewedPublicBoardCsv(
        csv([sourceRow({ sponsorship_status: "confirmed" })]),
        preview.dryRunToken,
      ),
    ).rejects.toBeInstanceOf(importer.ReviewedPublicBoardImportTokenError);
  });
});
