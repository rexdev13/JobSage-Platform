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
  inspectCompanySiteProbePage,
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
    expect(result.diagnostics.atsLinksSeen).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "Lever",
        url: "https://jobs.lever.co/acme",
        supportedForImport: true,
        linkedFromFirstParty: true,
        followed: true,
      }),
    ]));
  });

  it("does not fetch a stored ATS URL until first-party ownership is confirmed", async () => {
    fetchCompanySitePageMock.mockImplementation(async (url: string) => ({
      ok: true,
      url,
      status: 200,
      contentType: "text/html",
      body: "<p>No current vacancies are listed.</p>",
    }));

    const result = await discoverCompanySiteVacancies(
      "Fixture Employer",
      "https://fixture.example/",
      {
        knownCareersUrl: "https://jobs.ashbyhq.com/fixture",
        knownCareersMappingVerified: false,
      },
    );

    expect(fetchCompanySitePageMock.mock.calls.map(([url]) => url)).not.toContain(
      "https://jobs.ashbyhq.com/fixture",
    );
    expect(result.atsMappingVerified).toBe(false);
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

  it("follows a generic current-vacancies page and extracts its specific role", async () => {
    const home = "https://fixture.example/";
    const listing = "https://fixture.example/careers/current-vacancies";
    const role = "https://fixture.example/careers/current-vacancies/senior-engineer";
    fetchCompanySitePageMock.mockImplementation(async (url: string) => ({
      ok: true,
      url,
      status: 200,
      contentType: "text/html",
      body: url === home
        ? '<a href="/careers/current-vacancies">Current vacancies</a>'
        : url === listing
          ? `<h1>Current vacancies</h1><main><a href="${role}">Senior Software Engineer</a></main>`
          : "<h1>Job description</h1>",
    }));

    const result = await discoverCompanySiteVacancies("Fixture Employer", home);

    expect(fetchCompanySitePageMock.mock.calls.map(([url]) => url)).toContain(listing);
    expect(result.adverts).toEqual([
      expect.objectContaining({
        title: "Senior Software Engineer",
        url: role,
      }),
    ]);
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

  it("does not count career-section navigation as vacancies when the page mentions vacancies", async () => {
    const body = `<html>
      <title>Careers</title><h1>Careers</h1>
      <p>Explore vacancies across our divisions and find out how to apply.</p>
      <div class="sticky">
        <a href="/Careers/UK-Poultry"><div class="bfa-nav">UK POULTRY</div></a>
        <a href="/Careers/Meal-Solutions"><div class="bfa-nav">MEALS</div></a>
        <a href="/Careers/Head-Office"><div class="bfa-nav">HEAD OFFICE</div></a>
        <a href="/Careers/Early-Careers"><div class="bfa-nav">EARLY CAREERS</div></a>
      </div>
      <main><a href="/Careers/Jobs/senior-engineer">Senior Software Engineer</a></main>
    </html>`;
    fetchCompanySitePageMock.mockImplementation(async (url: string) => ({
      ok: true,
      url,
      status: 200,
      contentType: "text/html",
      body,
    }));

    const result = await discoverCompanySiteVacancies(
      "Fixture Employer",
      "https://fixture.example/careers",
    );

    expect(result.adverts).toHaveLength(1);
    expect(result.adverts[0]).toMatchObject({
      title: "Senior Software Engineer",
      url: "https://fixture.example/Careers/Jobs/senior-engineer",
    });
    expect(result.rejectionReasons.navigation_link_not_vacancy).toBeGreaterThan(0);
  });

  it("rejects BMC-style department and country filters while retaining a specific job ID", async () => {
    const filterUrl =
      "https://jobs.bmc.com/Careers/SearchJobs?1273=2616669&1273_format=1340&listFilterMode=1";
    const countryUrl =
      "https://jobs.bmc.com/Careers/SearchJobs?1274=9435&1274_format=1347&intcmp=JobsByCountry&listFilterMode=1";
    const body = `<html><h1>Careers</h1>
      <nav class="menu">
        <a href="${filterUrl}">Corporate Development</a>
        <a href="${countryUrl}">United Kingdom</a>
        <a href="https://jobs.bmc.com/Careers/RecommendationMethods">Get recommendations</a>
        <a href="https://jobs.bmc.com/Careers/TalentCommunity">Join our talent community</a>
      </nav>
      <main><section class="job-card">
        <a href="https://jobs.bmc.com/Careers/SearchJobs?jobId=12345">Senior Software Engineer</a>
      </section></main></html>`;
    fetchCompanySitePageMock.mockImplementation(async (url: string) => ({
      ok: true,
      url,
      status: 200,
      contentType: url.endsWith("sitemap.xml") ? "application/xml" : "text/html",
      body: url.endsWith("sitemap.xml") ? "<urlset></urlset>" : body,
    }));

    const result = await discoverCompanySiteVacancies(
      "BMC Software",
      "https://www.bmc.com/careers/careers.html",
    );

    expect(result.adverts).toHaveLength(1);
    expect(result.adverts[0]).toMatchObject({
      title: "Senior Software Engineer",
      url: "https://jobs.bmc.com/Careers/SearchJobs?jobId=12345",
    });
    expect(result.adverts.some((advert) =>
      advert.url === filterUrl || advert.url === countryUrl
    )).toBe(false);
    expect(fetchCompanySitePageMock.mock.calls.map(([url]) => url)).not.toContain(filterUrl);
    expect(fetchCompanySitePageMock.mock.calls.map(([url]) => url)).not.toContain(countryUrl);
    expect(result.rejectionReasons.invalid_deep_link).toBeGreaterThan(0);
  });

  it("does not treat careers-related prose on an ordinary page as a recruitment signal", () => {
    const result = inspectCompanySiteProbePage(
      "https://fixture.example/",
      "<html><title>Our history</title><h1>About the company</h1><p>We discuss careers, jobs, open positions and workplace opportunities in this article.</p></html>",
    );

    expect(result.hasCareersSignal).toBe(false);
    expect(result.careersUrl).toBeNull();
    expect(result.atsMappingVerified).toBe(false);
  });

  it("recognizes a first-party ATS link and prefers it over a generic careers page", () => {
    const result = inspectCompanySiteProbePage(
      "https://fixture.example/",
      '<nav><a href="/careers">Careers</a><a href="https://jobs.ashbyhq.com/fixture">Apply for roles</a></nav>',
    );

    expect(result.hasCareersSignal).toBe(true);
    expect(result.careersUrl).toBe("https://jobs.ashbyhq.com/fixture");
    expect(result.atsProvider).toBe("Ashby");
    expect(result.atsMappingVerified).toBe(true);
    expect(result.atsMappingEvidenceUrl).toBe("https://fixture.example/");
  });

  it.each([
    ["culture", '<a href="/careers/our-culture">Our culture</a>'],
    ["team", '<a href="/careers/meet-the-team">Meet our team</a>'],
    ["employee stories", '<a href="/careers/employee-stories">Read more</a>'],
    ["generic apply", '<a href="/careers/apply-now">Apply now</a>'],
  ])("does not extract a %s page as a vacancy", async (_kind, anchor) => {
    fetchCompanySitePageMock.mockResolvedValue({
      ok: true,
      url: "https://fixture.example/careers",
      status: 200,
      contentType: "text/html",
      body: `<html><h1>Careers</h1>${anchor}</html>`,
    });

    const result = await discoverCompanySiteVacancies(
      "Fixture Employer",
      "https://fixture.example/careers",
    );

    expect(result.adverts).toEqual([]);
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

  it("treats an unavailable optional sitemap as a complete empty observation", async () => {
    fetchCompanySitePageMock
      .mockResolvedValueOnce({
        ok: true,
        url: "https://no-sitemap.example/",
        status: 200,
        contentType: "text/html",
        body: "<h1>Welcome</h1>",
      })
      .mockResolvedValueOnce({
        ok: true,
        url: "https://no-sitemap.example/sitemap.xml",
        status: 200,
        contentType: "application/xml",
        body: "<sitemapindex><sitemap><loc>https://no-sitemap.example/wp-sitemap-posts-job_listing-1.xml</loc></sitemap></sitemapindex>",
      })
      .mockResolvedValueOnce({
        ok: false,
        kind: "http",
        status: 404,
        reason: "HTTP 404",
      });

    const result = await discoverCompanySiteVacancies(
      "No Sitemap Employer",
      "https://no-sitemap.example/",
    );

    expect(result.completion).toBe("complete");
    expect(result.error).toBeUndefined();
    expect(result.diagnostics.pageFetches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        url: "https://no-sitemap.example/wp-sitemap-posts-job_listing-1.xml",
        status: 404,
        fetched: false,
      }),
    ]));
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

  it("continues a saved crawl beyond the per-run page limit", async () => {
    fetchCompanySitePageMock.mockImplementation(async (url: string) => ({
      ok: true,
      url,
      status: 200,
      contentType: url.endsWith("sitemap.xml") ? "application/xml" : "text/html",
      body: url.endsWith("sitemap.xml") ? "<urlset></urlset>" : "<p>Careers page</p>",
    }));
    const queued = Array.from(
      { length: 7 },
      (_, index) => `https://resume.example/careers?page=${index + 1}`,
    );

    const first = await discoverCompanySiteVacancies(
      "Resume Employer",
      "https://resume.example",
      {
        resumeState: {
          queue: queued,
          visited: Array.from(
            { length: 6 },
            (_, index) => `https://resume.example/archive?page=${index + 1}`,
          ),
        },
      },
    );

    expect(first.completion).toBe("partial_page_limit");
    expect(first.pagesFetched).toBe(6);
    expect(first.resumeState?.queue).toEqual([queued[6]]);

    fetchCompanySitePageMock.mockClear();
    const second = await discoverCompanySiteVacancies(
      "Resume Employer",
      "https://resume.example",
      { resumeState: first.resumeState },
    );

    expect(second.completion).toBe("complete");
    expect(fetchCompanySitePageMock).toHaveBeenCalledWith(
      queued[6],
      "resume.example",
      expect.any(Number),
    );
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

  it("reports an employer-linked BambooHR platform without crawling or importing it", async () => {
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
        url: "https://www.hopscotch.example/sitemap.xml",
        status: 200,
        contentType: "application/xml",
        body: "<urlset></urlset>",
      });

    const result = await discoverCompanySiteVacancies(
      "Hopscotch Employer",
      "https://www.hopscotch.example",
    );

    expect(result.atsProvider).toBeNull();
    expect(result.adverts).toEqual([]);
    expect(fetchCompanySitePageMock.mock.calls.map(([url]) => url)).not.toContain(
      "https://hopscotch.bamboohr.com/careers",
    );
    expect(result.diagnostics.atsLinksSeen).toEqual([
      expect.objectContaining({
        provider: "BambooHR",
        supportedForImport: false,
        linkedFromFirstParty: true,
        followed: false,
        reason: expect.stringContaining("not crawled or imported"),
      }),
    ]);
  });

  it("does not crawl unsupported BambooHR talent-pool postings", async () => {
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
        url: "https://www.bluefield.example/sitemap.xml",
        status: 200,
        contentType: "application/xml",
        body: "<urlset></urlset>",
      });

    const result = await discoverCompanySiteVacancies(
      "Bluefield Services Limited",
      "https://www.bluefield.example",
    );

    expect(result.adverts).toEqual([]);
    expect(fetchCompanySitePageMock.mock.calls.map(([url]) => url)).not.toContain(
      "https://bluefield.bamboohr.com/careers",
    );
    expect(result.diagnostics.atsLinksSeen[0]).toMatchObject({
      provider: "BambooHR",
      supportedForImport: false,
      followed: false,
    });
  });

  it("recursively checks a bounded sitemap index and extracts listed JobPosting evidence", async () => {
    const home = "https://sitemap-employer.example/";
    const index = "https://sitemap-employer.example/sitemap.xml";
    const careersMap = "https://sitemap-employer.example/careers-sitemap.xml";
    const jobUrl = "https://sitemap-employer.example/careers/jobs/care-assistant";
    fetchCompanySitePageMock.mockImplementation(async (url: string) => {
      if (url === home) {
        return {
          ok: true,
          url,
          status: 200,
          contentType: "text/html",
          body: "<html><h1>Welcome</h1></html>",
        };
      }
      if (url === index) {
        return {
          ok: true,
          url,
          status: 200,
          contentType: "application/xml",
          body: `<sitemapindex><sitemap><loc>${careersMap}</loc></sitemap></sitemapindex>`,
        };
      }
      if (url === careersMap) {
        return {
          ok: true,
          url,
          status: 200,
          contentType: "application/xml",
          body: `<urlset><url><loc>${jobUrl}</loc></url></urlset>`,
        };
      }
      return {
        ok: true,
        url,
        status: 200,
        contentType: "text/html",
        body: `<script type="application/ld+json">${JSON.stringify({
          "@type": "JobPosting",
          title: "Care Assistant",
          url: jobUrl,
        })}</script>`,
      };
    });

    const result = await discoverCompanySiteVacancies(
      "Sitemap Employer",
      home,
    );

    expect(result.adverts).toEqual([
      expect.objectContaining({
        title: "Care Assistant",
        url: jobUrl,
        companyVacancyEvidence: { kind: "json_ld_job_posting" },
      }),
    ]);
    expect(result.diagnostics.sitemapChecked).toBe(true);
    expect(result.diagnostics.sitemapDocuments).toEqual([index, careersMap]);
    expect(result.diagnostics.jsonLdJobPostingFound).toBe(true);
    expect(result.diagnostics.vacancyLikePages).toContain(jobUrl);
    expect(fetchCompanySitePageMock.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("unwraps CDATA sitemap locations and prioritizes a job sitemap over content maps", async () => {
    const home = "https://priority-sitemap.example/";
    const index = "https://priority-sitemap.example/sitemap_index.xml";
    const jobMap = "https://priority-sitemap.example/job-listings-sitemap.xml";
    const jobUrl = "https://priority-sitemap.example/careers/jobs/care-assistant";
    const lowerPriorityMaps = [
      "https://priority-sitemap.example/post-sitemap.xml",
      "https://priority-sitemap.example/page-sitemap.xml",
      "https://priority-sitemap.example/product-sitemap.xml",
      "https://priority-sitemap.example/mgt_clients_reviews-sitemap.xml",
    ];
    fetchCompanySitePageMock.mockImplementation(async (url: string) => {
      if (url === home) {
        return {
          ok: true,
          url,
          status: 200,
          contentType: "text/html",
          body: "<h1>Welcome</h1>",
        };
      }
      if (url.endsWith("/sitemap.xml")) {
        return {
          ok: true,
          url: index,
          status: 200,
          contentType: "application/xml",
          body: `<sitemapindex>${[
            ...lowerPriorityMaps,
            jobMap,
          ].map((child) => `<sitemap><loc><![CDATA[${child}]]></loc></sitemap>`).join("")}</sitemapindex>`,
        };
      }
      if (url === jobMap) {
        return {
          ok: true,
          url,
          status: 200,
          contentType: "application/xml",
          body: `<urlset><url><loc><![CDATA[${jobUrl}]]></loc></url></urlset>`,
        };
      }
      if (url === jobUrl) {
        return {
          ok: true,
          url,
          status: 200,
          contentType: "text/html",
          body: `<script type="application/ld+json">${JSON.stringify({
            "@type": "JobPosting",
            title: "Care Assistant",
            url: jobUrl,
          })}</script>`,
        };
      }
      return {
        ok: true,
        url,
        status: 200,
        contentType: "application/xml",
        body: "<urlset></urlset>",
      };
    });

    const result = await discoverCompanySiteVacancies("Priority Sitemap Employer", home);
    const fetchedUrls = fetchCompanySitePageMock.mock.calls.map(([url]) => url);

    expect(fetchedUrls).toContain(jobMap);
    expect(fetchedUrls).toContain(jobUrl);
    expect(fetchedUrls).not.toContain(
      "https://priority-sitemap.example/%3C![CDATA[https://priority-sitemap.example/job-listings-sitemap.xml]]%3E",
    );
    expect(result.adverts).toEqual([
      expect.objectContaining({
        title: "Care Assistant",
        url: jobUrl,
      }),
    ]);
    expect(result.diagnostics.vacancyLikePages).toContain(jobUrl);
    expect(fetchedUrls.length).toBeLessThanOrEqual(6);
  });

  it("extracts schema.org JobPosting microdata and reports its source page", async () => {
    const jobUrl = "https://microdata-employer.example/careers/jobs/registered-nurse";
    fetchCompanySitePageMock.mockResolvedValue({
      ok: true,
      url: jobUrl,
      status: 200,
      contentType: "text/html",
      body: `<main itemscope itemtype="https://schema.org/JobPosting">
        <h1 itemprop="title">Registered Nurse</h1>
        <a itemprop="url" href="${jobUrl}">View role</a>
        <div itemprop="jobLocation">Bath, England</div>
        <p itemprop="description">Provide safe and compassionate care.</p>
        <meta itemprop="datePosted" content="2026-09-01">
      </main>`,
    });

    const result = await discoverCompanySiteVacancies(
      "Microdata Employer",
      jobUrl,
    );

    expect(result.adverts).toEqual([
      expect.objectContaining({
        title: "Registered Nurse",
        url: jobUrl,
        location: "Bath, England",
        companyVacancyEvidence: { kind: "microdata_job_posting" },
      }),
    ]);
    expect(result.diagnostics.microdataJobPostingFound).toBe(true);
    expect(result.diagnostics.vacancyLikePages).toContain(jobUrl);
  });

  it.each([
    ["Workday", "https://acme.wd5.myworkdayjobs.com/en-US/External"],
    ["Oracle Recruiting", "https://careers.acme.oraclecloud.com/hcmUI/CandidateExperience"],
    ["Teamtailor", "https://acme.teamtailor.com/jobs"],
    ["BambooHR", "https://acme.bamboohr.com/careers"],
    ["iCIMS", "https://careers-acme.icims.com/jobs"],
    ["Pinpoint", "https://acme.pinpointhq.com/"],
    ["SmartRecruiters", "https://careers.smartrecruiters.com/Acme"],
    ["Workable", "https://apply.workable.com/acme/"],
    ["Personio", "https://acme.jobs.personio.com/"],
    ["Recruitee", "https://acme.recruitee.com/"],
  ])("records unsupported %s links without fetching their platform", async (provider, atsUrl) => {
    const home = "https://official-employer.example/";
    const sitemap = "https://official-employer.example/sitemap.xml";
    fetchCompanySitePageMock.mockImplementation(async (url: string) => ({
      ok: true,
      url,
      status: 200,
      contentType: url === sitemap ? "application/xml" : "text/html",
      body: url === home
        ? `<nav><a href="${atsUrl}">Careers</a></nav>`
        : "<urlset></urlset>",
    }));

    const result = await discoverCompanySiteVacancies("Official Employer", home);
    const fetchedUrls = fetchCompanySitePageMock.mock.calls.map(([url]) => url);

    expect(fetchedUrls).not.toContain(atsUrl);
    expect(result.diagnostics.atsLinksSeen).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider,
        supportedForImport: false,
        linkedFromFirstParty: true,
        followed: false,
      }),
    ]));
  });

  it("normalises bare sponsor domains and rejects non-http schemes", () => {
    expect(normaliseSponsorWebsite("example.org")).toBe("https://example.org/");
    expect(normaliseSponsorWebsite("ftp://example.org")).toBeNull();
  });
});