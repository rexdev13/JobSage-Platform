import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseCsv } from "csv-parse/sync";
import {
  publicBoardSourceRowHash,
  verifyPublicBoardRevalidation,
} from "../../lib/publicBoardRevalidationProof";

vi.mock("../../lib/linkHealth", () => ({
  checkDestinationDead: vi.fn(async (url: string) => ({
    verdict: "alive",
    reason: "",
    finalUrl: url,
  })),
}));

const {
  inspectReviewedPublicBoardRevalidationInput,
  REVIEWED_PUBLIC_BOARD_REVALIDATION_MAX_CONCURRENT_HOSTS,
  revalidateReviewedPublicBoardCsv,
  ReviewedPublicBoardRevalidationInputError,
} = await import("../../lib/reviewedPublicBoardRevalidation");

describe("reviewed public-board URL revalidation", () => {
  const oldSecret = process.env.VACANCY_JOB_SECRET;
  const oldNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.VACANCY_JOB_SECRET = "unit-test-public-board-secret";
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    if (oldSecret === undefined) delete process.env.VACANCY_JOB_SECRET;
    else process.env.VACANCY_JOB_SECRET = oldSecret;
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
  });

  it("returns a signed live row that is bound to its source row and environment", async () => {
    const input = Buffer.from([
      "source,apply_url",
      'NHS Jobs,"https://beta.jobs.nhs.uk/candidate/jobadvert/C123"',
    ].join("\n"));
    const result = await revalidateReviewedPublicBoardCsv(input);
    const rows = parseCsv(result.csv, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;
    const row = rows[0]!;

    expect(result.counts).toEqual({ live: 1 });
    expect(result.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(row.revalidation_status).toBe("live");
    expect(row.revalidated_final_url).toBe("https://beta.jobs.nhs.uk/candidate/jobadvert/C123");
    expect(row.revalidation_row_hash).toBe(publicBoardSourceRowHash(row));
    expect(verifyPublicBoardRevalidation(row, {
      environment: "test",
      sourceRow: "2",
      totalRows: 1,
    })).toBe(true);
    expect(verifyPublicBoardRevalidation(row, {
      environment: "production",
      sourceRow: "2",
      totalRows: 1,
    })).toBe(false);
  });

  it("detects changes to source fields and rejects revalidating an already-proven file", async () => {
    const input = Buffer.from([
      "source,apply_url",
      'NHS Jobs,"https://beta.jobs.nhs.uk/candidate/jobadvert/C123"',
    ].join("\n"));
    const result = await revalidateReviewedPublicBoardCsv(input);
    const rows = parseCsv(result.csv, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;
    const row = { ...rows[0]!, source: "Reed" };

    expect(verifyPublicBoardRevalidation(row, {
      environment: "test",
      sourceRow: "2",
      totalRows: 1,
    })).toBe(false);
    expect(() => inspectReviewedPublicBoardRevalidationInput(Buffer.from(result.csv)))
      .toThrow(ReviewedPublicBoardRevalidationInputError);
  });

  it("caps concurrent checks across distinct hosts", async () => {
    const { checkDestinationDead } = await import("../../lib/linkHealth");
    const checkMock = vi.mocked(checkDestinationDead);
    const originalImplementation = checkMock.getMockImplementation();
    let active = 0;
    let maxActive = 0;
    checkMock.mockImplementation(async (url: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { verdict: "alive", reason: "", finalUrl: url };
    });

    try {
      const input = Buffer.from([
        "apply_url",
        ...Array.from({ length: 10 }, (_, index) => `https://host-${index}.example/jobs/${index}`),
      ].join("\n"));
      const result = await revalidateReviewedPublicBoardCsv(input);

      expect(result.rows).toBe(10);
      expect(maxActive).toBe(REVIEWED_PUBLIC_BOARD_REVALIDATION_MAX_CONCURRENT_HOSTS);
    } finally {
      if (originalImplementation) checkMock.mockImplementation(originalImplementation);
    }
  });
});
