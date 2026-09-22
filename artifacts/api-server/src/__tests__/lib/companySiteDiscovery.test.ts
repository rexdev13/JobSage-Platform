import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchCompanySitePageMock } = vi.hoisted(() => ({
  fetchCompanySitePageMock: vi.fn(),
}));

vi.mock("../../lib/companySiteHttp", () => ({
  COMPANY_SITE_EMPLOYER_BUDGET_MS: 25_000,
  classifyCompanySiteFailure: ({ kind, status }: { kind: string; status?: number }) =>
    kind === "unsafe" || status === 404 || status === 410 ? "permanent" : "temporary",
  fetchCompanySitePage: fetchCompanySitePageMock,
  isAllowedCompanyDestination: () => true,
  knownAtsProvider: (value: string) =>
    value.includes("jobs.lever.co")
      ? "Lever"
      : value.includes("jobs.ashbyhq.com")
        ? "Ashby"
        : value.includes("boards.greenhouse.io")
          ? "Greenhouse"
          : value.includes("bamboohr.com")
            ? "BambooHR"
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

  it("captures a published recruitment email from fetched JobPosting HTML without another request", async () => {
    fetchCompanySitePageMock.mockResolvedValue({
      ok: true,
      url: "https://acme.example/jobs/nurse",
      status: 200,
      contentType: "text/html",
      body: `<script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Registered Nurse",
        url: "https://acme.example/jobs/nurse",
        description: 'Email info@acme.example or <a href="mailto:recruitment@acme.example">Recruitment</a>',
      })}</script>`,
    });

    const result = await discoverCompanySiteVacancies(
      "Acme Care Limited",
      "https://acme.example/jobs/nurse",
    );

    expect(result.pagesFetched).toBe(1);
    expect(fetchCompanySitePageMock).toHaveBeenCalledTimes(1);
    expect(result.adverts[0]).toMatchObject({
      contactEmail: "recruitment@acme.example",
      contactEvidenceUrl: "https://acme.example/jobs/nurse",
    });
  });

  it("falls back to a sitemap when the employer homepage has no careers links", async () => {
    fetchCompanySitePageMock
      .mockResolvedValueOnce({
        ok: true,
        url: "https://acme-care.example/",
        status: 200,
        contentType: "text/html",
        body: "<html><body>Welcome to Acme Care</body></html>",
      })
      .mockResolvedValueOnce({
        ok: true,
        url: "https://acme-care.example/sitemap.xml",
        status: 200,
        contentType: "application/xml",
        body: "<urlset><url><loc>https://acme-care.example/jobs/registered-nurse</loc></url></urlset>",
      })
      .mockResolvedValueOnce({
        ok: true,
        url: "https://acme-care.example/jobs/registered-nurse",
        status: 200,
        contentType: "text/html",
        body: `<script type="application/ld+json">${JSON.stringify({
          "@type": "JobPosting",
          title: "Registered Nurse",
          url: "https://acme-care.example/jobs/registered-nurse",
        })}</script>`,
      });

    const result = await discoverCompanySiteVacancies(
      "Acme Care Limited",
      "https://acme-care.example",
    );

    expect(result.pagesFetched).toBe(3);
    expect(result.adverts).toEqual([
      expect.objectContaining({
        title: "Registered Nurse",
        url: "https://acme-care.example/jobs/registered-nurse",
      }),
    ]);
  });

  it("follows a paginated careers listing", async () => {
    fetchCompanySitePageMock
      .mockResolvedValueOnce({
        ok: true,
        url: "https://acme-care.example/",
        status: 200,
        contentType: "text/html",
        body: '<a href="/careers">Careers</a>',
      })
      .mockResolvedValueOnce({
        ok: true,
        url: "https://acme-care.example/careers",
        status: 200,
        contentType: "text/html",
        body: '<a href="/jobs?page=2">Next</a>',
      })
      .mockResolvedValueOnce({
        ok: true,
        url: "https://acme-care.example/jobs?page=2",
        status: 200,
        contentType: "text/html",
        body: `<script type="application/ld+json">${JSON.stringify({
          "@type": "JobPosting",
          title: "Senior Staff Nurse",
          url: "https://acme-care.example/jobs/senior-staff-nurse",
        })}</script>`,
      });

    const result = await discoverCompanySiteVacancies(
      "Acme Care Limited",
      "https://acme-care.example",
    );

    expect(result.pagesFetched).toBe(3);
    expect(result.adverts[0]).toMatchObject({
      title: "Senior Staff Nurse",
      url: "https://acme-care.example/jobs/senior-staff-nurse",
    });
  });

  it.each([
    ["2H Offshore news is rejected", "2H Offshore News", "/news/company-update", false],
    ["Astorg news is rejected", "Astorg News", "/news/people", false],
    ["A1 generic Apply Online is rejected", "Apply Online", "/apply-online", false],
    ["411 direct listing is accepted", "Freelance Content Creator", "/jobs/freelance-content-creator", true],
    ["A.S. Kooner direct listing is accepted", "Registered Nurse", "/careers/registered-nurse", true],
    ["Aaseya direct listing is accepted", "Senior Consultant", "/opportunities/senior-consultant", true],
  ])("%s", async (_name, text, path, accepted) => {
    fetchCompanySitePageMock.mockResolvedValue({
      ok: true,
      url: "https://fixture.example/careers",
      status: 200,
      contentType: "text/html",
      body: `<a href="${path}">${text}</a>`,
    });
    const result = await discoverCompanySiteVacancies("Fixture Employer", "https://fixture.example");
    expect(result.adverts.length > 0).toBe(accepted);
    if (!accepted) {
      expect(result.advertsRejected).toBeGreaterThan(0);
      expect(Object.values(result.rejectionReasons).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
    }
  });

  it("rejects educational article cards that contain prose instead of a job title", async () => {
    fetchCompanySitePageMock.mockResolvedValue({
      ok: true,
      url: "https://abpi.example/careers",
      status: 200,
      contentType: "text/html",
      body: `<a href="/careers/school-college-studies">School &amp; college studies Most people know what doctors, nurses, dentists and vets do. But many people are not sure what a research chemist does, or what a pharmacologist is.</a>`,
    });

    const result = await discoverCompanySiteVacancies("ABPI", "https://abpi.example/careers");

    expect(result.adverts).toEqual([]);
    expect(result.rejectionReasons.editorial_or_non_vacancy_title).toBeGreaterThan(0);
  });

  it("rejects generic culture content linked from a careers page", async () => {
    fetchCompanySitePageMock.mockResolvedValue({
      ok: true,
      url: "https://fixture.example/careers",
      status: 200,
      contentType: "text/html",
      body: '<a href="/careers/our-culture">Our culture</a>',
    });

    const result = await discoverCompanySiteVacancies("Fixture Employer", "https://fixture.example/careers");

    expect(result.adverts).toEqual([]);
    expect(result.rejectionReasons.generic_careers_content).toBeGreaterThan(0);
  });

  it("reports a complete empty observation", async () => {
    fetchCompanySitePageMock
      .mockResolvedValueOnce({
        ok: true,
        url: "https://empty.example/",
        status: 200,
        contentType: "text/html",
        body: "<p>No vacancies currently listed.</p>",
      })
      .mockResolvedValueOnce({
        ok: true,
        url: "https://empty.example/sitemap.xml",
        status: 200,
        contentType: "application/xml",
        body: "<urlset></urlset>",
      });

    const result = await discoverCompanySiteVacancies("Empty Employer", "https://empty.example");

    expect(result.completion).toBe("complete");
    expect(result.adverts).toEqual([]);
  });

  it("reports a failed observation when an attempted page fails", async () => {
    fetchCompanySitePageMock.mockResolvedValue({
      ok: false,
      kind: "http",
      reason: "HTTP 500",
    });

    const result = await discoverCompanySiteVacancies("Failed Employer", "https://failed.example");

    expect(result.completion).toBe("failed");
    expect(result.pagesAttempted).toBeGreaterThan(0);
  });

  it("reports a partial deadline when queued work remains after the deadline", async () => {
    let clock = 0;
    fetchCompanySitePageMock.mockImplementation(async () => {
      clock = 30_000;
      return {
        ok: true,
        url: "https://deadline.example/",
        status: 200,
        contentType: "text/html",
        body: '<a href="/careers">Careers</a>',
      };
    });

    const result = await discoverCompanySiteVacancies("Deadline Employer", "https://deadline.example", {
      now: () => clock,
      deadlineMs: 20_000,
    });

    expect(result.completion).toBe("partial_deadline");
  });

  it("accepts a structured Greenhouse posting", async () => {
    fetchCompanySitePageMock
      .mockResolvedValueOnce({
        ok: true,
        url: "https://fixture.example/careers",
        status: 200,
        contentType: "text/html",
        body: '<a href="https://boards.greenhouse.io/fixture">Greenhouse</a>',
      })
      .mockResolvedValueOnce({
        ok: true,
        url: "https://boards.greenhouse.io/fixture",
        status: 200,
        contentType: "text/html",
        body: '<a href="https://boards.greenhouse.io/fixture/jobs/123">Content Creator</a>',
      });
    const result = await discoverCompanySiteVacancies("Fixture Employer", "https://fixture.example");
    expect(result.adverts).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Content Creator", url: "https://boards.greenhouse.io/fixture/jobs/123" }),
    ]));
  });

  it("accepts a Hopscotch-style BambooHR posting", async () => {
    fetchCompanySitePageMock
      .mockResolvedValueOnce({
        ok: true,
        url: "https://www.hopscotch.example/",
        status: 200,
        contentType: "text/html",
        body: '<a href="https://hopscotch.bamboohr.com/careers">Careers</a>',
      })
      .mockResolvedValueOnce({
        ok: true,
        url: "https://hopscotch.bamboohr.com/careers",
        status: 200,
        contentType: "text/html",
        body: '<a href="https://hopscotch.bamboohr.com/careers/42">Senior Product Manager</a>',
      });

    const result = await discoverCompanySiteVacancies(
      "Hopscotch Employer",
      "https://www.hopscotch.example",
    );

    expect(result.atsProvider).toBe("BambooHR");
    expect(result.adverts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Senior Product Manager",
        url: "https://hopscotch.bamboohr.com/careers/42",
        companyVacancyEvidence: {
          kind: "known_ats_posting",
          provider: "BambooHR",
        },
      }),
    ]));
  });

  it("rejects a BambooHR talent-pool posting without rejecting real job titles", async () => {
    fetchCompanySitePageMock
      .mockResolvedValueOnce({
        ok: true,
        url: "https://www.bluefield.example/",
        status: 200,
        contentType: "text/html",
        body: '<a href="https://bluefield.bamboohr.com/careers">Careers</a>',
      })
      .mockResolvedValueOnce({
        ok: true,
        url: "https://bluefield.bamboohr.com/careers",
        status: 200,
        contentType: "text/html",
        body: '<a href="https://bluefield.bamboohr.com/careers/60">Join our Talent Pool</a>',
      });

    const result = await discoverCompanySiteVacancies(
      "Bluefield Services Limited",
      "https://www.bluefield.example",
    );

    expect(result.adverts).toEqual([]);
    expect(result.rejectionReasons.non_specific_bamboohr_posting).toBe(1);
  });

  it("normalises bare sponsor domains and rejects non-http schemes", () => {
    expect(normaliseSponsorWebsite("example.org")).toBe("https://example.org/");
    expect(normaliseSponsorWebsite("ftp://example.org")).toBeNull();
  });
});