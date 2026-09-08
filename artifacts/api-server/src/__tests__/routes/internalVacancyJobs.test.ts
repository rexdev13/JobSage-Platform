import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { runVacancyJobMock } = vi.hoisted(() => ({
  runVacancyJobMock: vi.fn(),
}));

vi.mock("../../lib/vacancyJobRunner", () => ({
  runVacancyJob: runVacancyJobMock,
}));

vi.mock("../../lib/vacancyAiBudget", () => ({
  getVacancyAiWebSearchDailyCap: () => 0,
}));

const { default: router } = await import("../../routes/internalVacancyJobs");

const app = express();
app.use(express.json());
app.use(router);

describe("POST /internal/vacancy-jobs", () => {
  const originalSecret = process.env.VACANCY_JOB_SECRET;
  const originalCompanySiteBatchSize = process.env.COMPANY_SITE_BATCH_SIZE;

  beforeEach(() => {
    process.env.VACANCY_JOB_SECRET = "test-job-secret";
    delete process.env.COMPANY_SITE_BATCH_SIZE;
    runVacancyJobMock.mockReset();
    runVacancyJobMock.mockResolvedValue({
      selected: 2,
      upserted: 1,
      live: 0,
      dead: 0,
      inconclusive: 0,
      errors: 0,
      done: true,
    });
  });

  afterEach(() => {
    if (originalSecret == null) delete process.env.VACANCY_JOB_SECRET;
    else process.env.VACANCY_JOB_SECRET = originalSecret;
    if (originalCompanySiteBatchSize == null) delete process.env.COMPANY_SITE_BATCH_SIZE;
    else process.env.COMPANY_SITE_BATCH_SIZE = originalCompanySiteBatchSize;
  });

  it("fails closed when the production secret is unset", async () => {
    delete process.env.VACANCY_JOB_SECRET;

    const response = await request(app)
      .post("/internal/vacancy-jobs")
      .send({ kind: "job_board" });

    expect(response.status).toBe(503);
    expect(runVacancyJobMock).not.toHaveBeenCalled();
  });

  it("rejects a missing or incorrect header", async () => {
    const response = await request(app)
      .post("/internal/vacancy-jobs")
      .send({ kind: "job_board" });

    expect(response.status).toBe(401);
    expect(runVacancyJobMock).not.toHaveBeenCalled();
  });

  it("awaits the worker and returns its final summary", async () => {
    const response = await request(app)
      .post("/internal/vacancy-jobs")
      .set("x-jobsage-job-secret", "test-job-secret")
      .send({ kind: "job_board" });

    expect(runVacancyJobMock).toHaveBeenCalledWith("job_board", 50);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      selected: 2,
      upserted: 1,
      live: 0,
      dead: 0,
      inconclusive: 0,
      errors: 0,
      done: true,
    });
  });

  it.each([
    ["job_board", 999, 50],
    ["company_site", 999, 5],
    ["liveness", 999, 50],
    ["contact", 999, 5],
  ] as const)("caps %s HTTP batches", async (kind, requested, expected) => {
    const response = await request(app)
      .post("/internal/vacancy-jobs")
      .set("x-jobsage-job-secret", "test-job-secret")
      .send({ kind, limit: requested });

    expect(response.status).toBe(200);
    expect(runVacancyJobMock).toHaveBeenCalledWith(kind, expected);
  });

  it("uses the timeout-safe company-site default and respects a smaller configured size", async () => {
    process.env.COMPANY_SITE_BATCH_SIZE = "3";

    const response = await request(app)
      .post("/internal/vacancy-jobs")
      .set("x-jobsage-job-secret", "test-job-secret")
      .send({ kind: "company_site" });

    expect(response.status).toBe(200);
    expect(runVacancyJobMock).toHaveBeenCalledWith("company_site", 3);
  });

  it("returns 409 immediately when the shared writer is busy", async () => {
    runVacancyJobMock.mockResolvedValue(null);

    const response = await request(app)
      .post("/internal/vacancy-jobs")
      .set("x-jobsage-job-secret", "test-job-secret")
      .send({ kind: "company_site" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Another vacancy pipeline batch is already running." });
  });
});