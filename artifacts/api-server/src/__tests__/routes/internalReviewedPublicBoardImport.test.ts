import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inspectRevalidationInput: vi.fn(),
  revalidatePublicBoardCsv: vi.fn(),
}));

vi.mock("../../lib/reviewedPublicBoardImport", () => ({
  applyReviewedPublicBoardCsv: vi.fn(),
  previewReviewedPublicBoardCsv: vi.fn(),
  REVIEWED_PUBLIC_BOARD_IMPORT_CONFIRMATION: "apply-reviewed-public-board-vacancy-import",
  REVIEWED_PUBLIC_BOARD_IMPORT_MAX_BYTES: 3_000_000,
  ReviewedPublicBoardImportInputError: class ReviewedPublicBoardImportInputError extends Error {},
  ReviewedPublicBoardImportTokenError: class ReviewedPublicBoardImportTokenError extends Error {},
}));
vi.mock("../../lib/reviewedPublicBoardRevalidation", () => ({
  inspectReviewedPublicBoardRevalidationInput: mocks.inspectRevalidationInput,
  revalidateReviewedPublicBoardCsv: mocks.revalidatePublicBoardCsv,
  ReviewedPublicBoardRevalidationInputError: class ReviewedPublicBoardRevalidationInputError extends Error {},
}));
vi.mock("../../lib/companySiteWorkflowReports", () => ({
  saveWorkflowReport: vi.fn(),
}));

const { default: router } = await import("../../routes/internalReviewedPublicBoardImport");
const app = express().use(router);

describe("internal reviewed public-board import route", () => {
  const oldSecret = process.env.VACANCY_JOB_SECRET;
  const oldEnabled = process.env.SPONSOR_PUBLIC_BOARD_REVIEWED_IMPORT_ENABLED;

  afterEach(() => {
    if (oldSecret === undefined) delete process.env.VACANCY_JOB_SECRET;
    else process.env.VACANCY_JOB_SECRET = oldSecret;
    if (oldEnabled === undefined) delete process.env.SPONSOR_PUBLIC_BOARD_REVIEWED_IMPORT_ENABLED;
    else process.env.SPONSOR_PUBLIC_BOARD_REVIEWED_IMPORT_ENABLED = oldEnabled;
  });

  it("requires the internal job secret", async () => {
    process.env.VACANCY_JOB_SECRET = "route-test-secret";
    process.env.SPONSOR_PUBLIC_BOARD_REVIEWED_IMPORT_ENABLED = "true";

    const response = await request(app)
      .post("/internal/public-board-vacancies/reviewed-import/dry-run");

    expect(response.status).toBe(401);
  });

  it("keeps the import disabled unless the explicit feature flag is enabled", async () => {
    process.env.VACANCY_JOB_SECRET = "route-test-secret";
    delete process.env.SPONSOR_PUBLIC_BOARD_REVIEWED_IMPORT_ENABLED;

    const response = await request(app)
      .post("/internal/public-board-vacancies/reviewed-import/dry-run")
      .set("x-jobsage-job-secret", "route-test-secret");

    expect(response.status).toBe(503);
    expect(response.body.error).toContain("disabled");
  });

  it("starts a protected read-only revalidation job and exposes its completed result", async () => {
    process.env.VACANCY_JOB_SECRET = "route-test-secret";
    mocks.inspectRevalidationInput.mockReturnValue({ rows: 1 });
    mocks.revalidatePublicBoardCsv.mockImplementation(async (
      _input: Buffer,
      onProgress: (progress: { completed: number; total: number; currentHost: string }) => void,
    ) => {
      onProgress({ completed: 1, total: 1, currentHost: "jobs.example" });
      return {
      inputSha256: "input-sha",
      outputSha256: "output-sha",
      csv: "source,apply_url\nNHS Jobs,https://jobs.example/job/1\n",
      rows: 1,
      hostCount: 1,
      counts: { live: 1 },
      completedAt: "2026-10-10T12:00:00.000Z",
      };
    });

    const start = await request(app)
      .post("/internal/public-board-vacancies/revalidate")
      .set("x-jobsage-job-secret", "route-test-secret")
      .attach("file", Buffer.from("source,apply_url\nNHS Jobs,https://jobs.example/job/1\n"), {
        filename: "urls.csv",
        contentType: "text/csv",
      });

    expect(start.status).toBe(202);
    expect(mocks.revalidatePublicBoardCsv).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const status = await request(app)
      .get(`/internal/public-board-vacancies/revalidate/${start.body.jobId}`)
      .set("x-jobsage-job-secret", "route-test-secret");

    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      status: "complete",
      completed: 1,
      total: 1,
      counts: { live: 1 },
      outputSha256: "output-sha",
    });
  });
});
