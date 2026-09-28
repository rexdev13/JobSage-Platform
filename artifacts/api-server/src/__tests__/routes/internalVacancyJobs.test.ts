import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { runVacancyJobMock } = vi.hoisted(() => ({
  runVacancyJobMock: vi.fn(),
}));

vi.mock("../../lib/vacancyJobRunner", () => ({
  LIVENESS_HTTP_BUDGET_MS: 18_000,
  PROFESSION_BACKFILL_HTTP_BUDGET_MS: 22_000,
  PROFESSION_BACKFILL_HTTP_CATEGORY_LIMIT: 1,
  PROFESSION_BACKFILL_HTTP_MAX_CATEGORY_LIMIT: 2,
  runVacancyJob: runVacancyJobMock,
}));

vi.mock("../../lib/companySiteProbe", () => ({
  COMPANY_SITE_PROBE_BATCH_SIZE: 60,
  COMPANY_SITE_PROBE_HTTP_BUDGET_MS: 20_000,
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

    expect(runVacancyJobMock).toHaveBeenCalledWith("job_board", 50, { deadlineMs: undefined });
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
    ["company_site", 999, 10],
    ["company_site_probe", 999, 60],
    ["liveness", 999, 50],
    ["contact", 999, 5],
  ] as const)("caps %s HTTP batches", async (kind, requested, expected) => {
    const response = await request(app)
      .post("/internal/vacancy-jobs")
      .set("x-jobsage-job-secret", "test-job-secret")
      .send({ kind, limit: requested });

    expect(response.status).toBe(200);
    expect(runVacancyJobMock).toHaveBeenCalledWith(
      kind,
      expected,
      kind === "liveness" || kind === "company_site_probe"
        ? { deadlineMs: expect.any(Number) }
        : { deadlineMs: undefined },
    );
  });

  it("gives health probes their own capped absolute deadline", async () => {
    const before = Date.now();
    const response = await request(app)
      .post("/internal/vacancy-jobs")
      .set("x-jobsage-job-secret", "test-job-secret")
      .send({ kind: "company_site_probe", limit: 999 });

    expect(response.status).toBe(200);
    const call = runVacancyJobMock.mock.calls.at(-1);
    expect(call?.[0]).toBe("company_site_probe");
    expect(call?.[1]).toBe(60);
    expect(call?.[2].deadlineMs).toBeGreaterThanOrEqual(before + 19_900);
    expect(call?.[2].deadlineMs).toBeLessThanOrEqual(Date.now() + 20_000);
  });

  it("uses the timeout-safe company-site default and respects a smaller configured size", async () => {
    process.env.COMPANY_SITE_BATCH_SIZE = "3";

    const response = await request(app)
      .post("/internal/vacancy-jobs")
      .set("x-jobsage-job-secret", "test-job-secret")
      .send({ kind: "company_site" });

    expect(response.status).toBe(200);
    expect(runVacancyJobMock).toHaveBeenCalledWith("company_site", 3, { deadlineMs: undefined });
  });

  it("forwards an exact company-site employer allowlist to the scheduler", async () => {
    const response = await request(app)
      .post("/internal/vacancy-jobs")
      .set("x-jobsage-job-secret", "test-job-secret")
      .send({
        kind: "company_site",
        limit: 1,
        organisationNames: [" Acme Engineering Limited "],
      });

    expect(response.status).toBe(200);
    expect(runVacancyJobMock).toHaveBeenCalledWith(
      "company_site",
      1,
      {
        deadlineMs: undefined,
        organisationNames: ["Acme Engineering Limited"],
      },
    );
  });

  it.each([
    ["empty list", { kind: "company_site", organisationNames: [] }],
    ["blank name", { kind: "company_site", organisationNames: ["  "] }],
    ["duplicate normalized names", {
      kind: "company_site",
      organisationNames: ["Acme Ltd", " acme ltd "],
    }],
    ["allowlist on another job", {
      kind: "job_board",
      organisationNames: ["Acme Ltd"],
    }],
  ])("rejects an invalid employer allowlist: %s", async (_label, body) => {
    const response = await request(app)
      .post("/internal/vacancy-jobs")
      .set("x-jobsage-job-secret", "test-job-secret")
      .send(body);

    expect(response.status).toBe(400);
    expect(runVacancyJobMock).not.toHaveBeenCalled();
  });

  it("accepts resumable Reed profession pages", async () => {
    const response = await request(app)
      .post("/internal/vacancy-jobs")
      .set("x-jobsage-job-secret", "test-job-secret")
      .send({ kind: "reed_professions", cursor: 3, limit: 2 });

    expect(response.status).toBe(200);
    expect(runVacancyJobMock).toHaveBeenCalledWith(
      "reed_professions",
      2,
      {
        deadlineMs: expect.any(Number),
        cursor: 3,
        categoryLimit: 2,
      },
    );
  });

  it("accepts resumable additional-board pages and rejects cursor on other jobs", async () => {
    const response = await request(app)
      .post("/internal/vacancy-jobs")
      .set("x-jobsage-job-secret", "test-job-secret")
      .send({ kind: "additional_boards", cursor: 1 });

    expect(response.status).toBe(200);
    expect(runVacancyJobMock).toHaveBeenCalledWith(
      "additional_boards",
      1,
      {
        deadlineMs: expect.any(Number),
        cursor: 1,
        categoryLimit: 1,
      },
    );

    const invalid = await request(app)
      .post("/internal/vacancy-jobs")
      .set("x-jobsage-job-secret", "test-job-secret")
      .send({ kind: "job_board", cursor: 1 });
    expect(invalid.status).toBe(400);
    expect(runVacancyJobMock).toHaveBeenCalledTimes(1);
  });

  it("returns 409 immediately when the shared writer is busy", async () => {
    runVacancyJobMock.mockResolvedValue(null);

    const response = await request(app)
      .post("/internal/vacancy-jobs")
      .set("x-jobsage-job-secret", "test-job-secret")
      .send({ kind: "company_site" });

    expect(response.status).toBe(409);
    expect(response.headers["retry-after"]).toBe("30");
    expect(response.body).toEqual({ error: "Another vacancy pipeline batch is already running." });
    expect(runVacancyJobMock).toHaveBeenCalledOnce();
  });

  it("returns a bounded retryable timeout while a probe finalizes safely", async () => {
    runVacancyJobMock.mockRejectedValue(new Error("VACANCY_JOB_DEADLINE"));

    const response = await request(app)
      .post("/internal/vacancy-jobs")
      .set("x-jobsage-job-secret", "test-job-secret")
      .send({ kind: "company_site_probe" });

    expect(response.status).toBe(504);
    expect(response.headers["retry-after"]).toBe("30");
    expect(response.body).toEqual(expect.objectContaining({
      error: "Vacancy batch reached its HTTP deadline and is finalizing safely.",
      done: false,
    }));
  });
});