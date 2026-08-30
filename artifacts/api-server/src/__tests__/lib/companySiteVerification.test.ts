import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchCompanySitePageMock, setMock, whereMock } = vi.hoisted(() => ({
  fetchCompanySitePageMock: vi.fn(),
  setMock: vi.fn(),
  whereMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    update: () => ({
      set: setMock.mockImplementation(() => ({
        where: whereMock.mockResolvedValue(undefined),
      })),
    }),
  },
  sponsorLicenceVacanciesTable: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

vi.mock("../../lib/companySiteHttp", () => ({
  COMPANY_SITE_EMPLOYER_BUDGET_MS: 25_000,
  fetchCompanySitePage: fetchCompanySitePageMock,
}));

const { verifyCompanySiteStoredLink } = await import("../../lib/companySiteVerification");

describe("company-site initial verification", () => {
  beforeEach(() => {
    fetchCompanySitePageMock.mockReset();
    setMock.mockClear();
    whereMock.mockClear();
  });

  it("marks a controlled employer deep-link response live", async () => {
    fetchCompanySitePageMock.mockResolvedValue({
      ok: true,
      url: "https://careers.example.org/jobs/registered-nurse-1",
      status: 200,
      body: "<html>Registered Nurse</html>",
      contentType: "text/html",
    });

    await expect(
      verifyCompanySiteStoredLink(1, "https://careers.example.org/jobs/registered-nurse-1"),
    ).resolves.toBe("live");
    expect(setMock).toHaveBeenLastCalledWith(expect.objectContaining({ liveness: "live" }));
  });

  it("marks redirects to blocked boards dead", async () => {
    fetchCompanySitePageMock.mockResolvedValue({
      ok: true,
      url: "https://www.indeed.com/viewjob?jk=123",
      status: 200,
      body: "<html>Job</html>",
      contentType: "text/html",
    });

    await expect(
      verifyCompanySiteStoredLink(2, "https://careers.example.org/jobs/registered-nurse-2"),
    ).resolves.toBe("dead");
    expect(setMock).toHaveBeenLastCalledWith(expect.objectContaining({ liveness: "dead" }));
  });

  it("keeps robots and rate-limit failures inconclusive", async () => {
    fetchCompanySitePageMock.mockResolvedValue({
      ok: false,
      kind: "robots",
      reason: "robots.txt disallows this path",
    });

    await expect(
      verifyCompanySiteStoredLink(3, "https://careers.example.org/jobs/registered-nurse-3"),
    ).resolves.toBe("inconclusive");
    expect(setMock).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ liveness: "live" }),
    );
  });
});