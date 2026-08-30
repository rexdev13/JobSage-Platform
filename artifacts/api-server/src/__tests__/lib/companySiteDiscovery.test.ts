import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchCompanySitePageMock } = vi.hoisted(() => ({
  fetchCompanySitePageMock: vi.fn(),
}));

vi.mock("../../lib/companySiteHttp", () => ({
  COMPANY_SITE_EMPLOYER_BUDGET_MS: 25_000,
  fetchCompanySitePage: fetchCompanySitePageMock,
  isAllowedCompanyDestination: () => true,
  knownAtsProvider: (value: string) =>
    value.includes("jobs.lever.co")
      ? "Lever"
      : value.includes("jobs.ashbyhq.com")
        ? "Ashby"
        : null,
}));

const {
  discoverCompanySiteVacancies,
  normaliseSponsorWebsite,
} = await import("../../lib/companySiteDiscovery");

describe("company-site vacancy discovery", () => {
  beforeEach(() => {
    fetchCompanySitePageMock.mockReset();
  });

  it("discovers a known ATS from a non-health sponsor website without using AI", async () => {
    fetchCompanySitePageMock
      .mockResolvedValueOnce({
        ok: true,
        url: "https://acme-engineering.example/",
        status: 200,
        contentType: "text/html",
        body: '<a href="https://jobs.lever.co/acme">Careers</a>',
      })
      .mockResolvedValueOnce({
        ok: true,
        url: "https://jobs.lever.co/acme",
        status: 200,
        contentType: "text/html",
        body: '<a href="https://jobs.lever.co/acme/83f7d3a2-5510-4e1a-a9ab-998172c4a001">Senior Lecturer</a>',
      });

    const result = await discoverCompanySiteVacancies(
      "Acme Engineering Limited",
      "acme-engineering.example",
    );

    expect(result.transientFailure).toBe(false);
    expect(result.atsProvider).toBe("Lever");
    expect(result.pagesFetched).toBe(2);
    expect(result.adverts).toEqual([
      expect.objectContaining({
        organisationName: "Acme Engineering Limited",
        title: "Senior Lecturer",
        sourceType: "company_site",
        boardName: null,
        url: "https://jobs.lever.co/acme/83f7d3a2-5510-4e1a-a9ab-998172c4a001",
      }),
    ]);
  });

  it("accepts opaque Ashby posting links from an Ashby listing page", async () => {
    fetchCompanySitePageMock
      .mockResolvedValueOnce({
        ok: true,
        url: "https://research.example/",
        status: 200,
        contentType: "text/html",
        body: '<a href="https://jobs.ashbyhq.com/research">Join our team</a>',
      })
      .mockResolvedValueOnce({
        ok: true,
        url: "https://jobs.ashbyhq.com/research",
        status: 200,
        contentType: "text/html",
        body: '<a href="https://jobs.ashbyhq.com/research/17f05108-a80b-4a92-b882-a30d11830af5">Principal Research Scientist</a>',
      });

    const result = await discoverCompanySiteVacancies(
      "Research Systems Limited",
      "https://research.example",
    );

    expect(result.adverts).toEqual([
      expect.objectContaining({
        title: "Principal Research Scientist",
        url: "https://jobs.ashbyhq.com/research/17f05108-a80b-4a92-b882-a30d11830af5",
      }),
    ]);
  });

  it("normalises bare sponsor domains and rejects non-http schemes", () => {
    expect(normaliseSponsorWebsite("example.org")).toBe("https://example.org/");
    expect(normaliseSponsorWebsite("ftp://example.org")).toBeNull();
  });
});