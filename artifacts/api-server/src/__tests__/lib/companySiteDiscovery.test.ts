import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchCompanySitePageMock, fetchCompanySitePublicApiPageMock } = vi.hoisted(() => ({
  fetchCompanySitePageMock: vi.fn(),
  fetchCompanySitePublicApiPageMock: vi.fn(),
}));

vi.mock("../../lib/companySiteHttp", () => ({
  COMPANY_SITE_EMPLOYER_BUDGET_MS: 25_000,
  classifyCompanySiteFailure: ({ kind, status }: { kind: string; status?: number }) =>
    kind === "unsafe" || status === 404 || status === 410 ? "permanent" : "temporary",
  fetchCompanySitePage: fetchCompanySitePageMock,
  fetchCompanySitePublicApiPage: fetchCompanySitePublicApiPageMock,
  fetchCompanySitePublicApiPost: fetchCompanySitePublicApiPageMock,
  fetchCompanySiteRobotsAwarePublicApiPage: fetchCompanySitePublicApiPageMock,
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
          : value.includes("smartrecruiters.com")
            ? "SmartRecruiters"
            : value.includes("personio.")
              ? "Personio"
              : value.includes("recruitee.com")
                ? "Recruitee"
                : value.includes("myworkdayjobs.com")
                  ? "Workday"
                  : value.includes("pinpointhq.com")
                    ? "Pinpoint"
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
    fetchCompanySitePublicApiPageMock.mockReset();
    fetchCompanySitePageMock.mockImplementation(async (url: string) => ({
      ok: true,
      url,
      status: 200,
      contentType: url.endsWith(".xml") ? "application/xml" : "text/html",
      body: url.endsWith(".xml") ? "<urlset></urlset>" : "<h1>Welcome</h1>",
    }));
    fetchCompanySitePublicApiPageMock.mockResolvedValue({
      ok: false,
      kind: "network",
      reason: "Direct feed unavailable in fixture",
      failureClass: "temporary",
    });
  });

  it("uses only the verified Circle Workday direct feed and never falls back to general discovery", async () => {
    fetchCompanySitePublicApiPageMock.mockResolvedValue({
      ok: false,
      kind: "network",
      reason: "CXS unavailable",
      failureClass: "temporary",
    });
    const result = await discoverCompanySiteVacancies(
      "BMI Healthcare Limited trading as Circle Health Group Limited",
      "https://careers.circlehealthgroup.co.uk/",
      {
        directFeedsOnly: true,
        checkGeneric: false,
        checkAts: true,
        knownCareersUrl: "https://circlehealth.wd103.myworkdayjobs.com/chgcareers",
        knownCareersMappingVerified: true,
        knownCareersEvidenceUrl:
          "http://careers.circlehealthgroup.co.uk/jobs/sister-charge-nurse-critical-care-jr110643",
      },
    );
    expect(result.atsProvider).toBe("Workday");
    expect(result.atsCompleted).toBe(false);
    expect(result.genericCompleted).toBe(false);
    expect(result.adverts).toEqual([]);
    expect(fetchCompanySitePageMock).not.toHaveBeenCalled();
    expect(fetchCompanySitePublicApiPageMock).toHaveBeenCalled();
  });

  it("marks a complete Circle Workday snapshot as the direct ATS source", async () => {
    fetchCompanySitePublicApiPageMock.mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://circlehealth.wd103.myworkdayjobs.com/wday/cxs/circlehealth/chgcareers/jobs",
      contentType: "application/json",
      body: JSON.stringify({ total: 0, jobPostings: [] }),
    });

    const result = await discoverCompanySiteVacancies(
      "BMI Healthcare Limited trading as Circle Health Group Limited",
      "https://careers.circlehealthgroup.co.uk/",
      {
        knownCareersUrl: "https://circlehealth.wd103.myworkdayjobs.com/chgcareers",
        knownCareersMappingVerified: true,
        knownCareersEvidenceUrl:
          "http://careers.circlehealthgroup.co.uk/jobs/sister-charge-nurse-critical-care-jr110643",
      },
    );

    expect(result).toMatchObject({
      completion: "complete",
      atsProvider: "Workday",
      atsCompleted: true,
      snapshotScope: { provider: "Workday", boardId: "chgcareers" },
      diagnostics: { directSourceKind: "ats_feed" },
    });
    expect(fetchCompanySitePageMock).not.toHaveBeenCalled();
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
    expect(fetchCompanySitePublicApiPageMock).not.toHaveBeenCalled();
    expect(result.atsMappingVerified).toBe(false);
  });

  it("probes common first-party careers paths after an empty homepage and sitemap", async () => {
    const home = "https://common-paths.example/";
    fetchCompanySitePageMock.mockImplementation(async (url: string) => url.endsWith("sitemap.xml")
      ? { ok: false, kind: "http", status: 404, reason: "HTTP 404" }
      : {
          ok: true,
          url,
          status: 200,
          contentType: "text/html",
          body: "<h1>Welcome</h1>",
        });

    const result = await discoverCompanySiteVacancies("Common Paths Employer", home);
    const fetchedUrls = fetchCompanySitePageMock.mock.calls.map(([url]) => url);
    const expectedPaths = ["/careers", "/jobs", "/vacancies", "/join-us", "/work-with-us"];

    expect(fetchedUrls).toContain(`${home}sitemap.xml`);
    expect(fetchedUrls).toEqual(expect.arrayContaining(
      expectedPaths.slice(0, 4).map((path) => new URL(path, home).toString()),
    ));
    expect(result.resumeState?.queue).toContain(new URL(expectedPaths[4], home).toString());
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
      body: `${accepted ? "<h1>Current vacancies</h1>" : ""}<a href="${path}">${text}</a>`,
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

  it("rejects career-resource destinations without dropping a real role on the same page", async () => {
    const listingUrl = "https://abpi.example/careers/";
    const roleUrl = "https://abpi.example/careers/jobs/registered-nurse-12345";
    const resources = [
      { slug: "benefits", text: "Benefits" },
      { slug: "why-work-in-the-industry", text: "Why work in the industry" },
      { slug: "working-in-the-industry", text: "Working in the industry" },
      { slug: "pharmaceutical-recruiters", text: "Pharmaceutical recruiters" },
      { slug: "international-non-eu-applicants", text: "International non-EU applicants" },
      { slug: "pharmaceutical-careers-for-doctors", text: "Pharmaceutical careers for doctors" },
      { slug: "post-graduates-post-doctoral-researchers", text: "Post graduates and post doctoral researchers" },
      { slug: "undergraduates", text: "Undergraduates" },
    ];
    const resourceLinks = resources
      .map(({ slug, text }) => `<a href="/careers/${slug}">${text}</a>`)
      .join("");
    fetchCompanySitePageMock.mockImplementation(async (url: string) => ({
      ok: true,
      url,
      status: 200,
      contentType: url.endsWith("sitemap.xml") ? "application/xml" : "text/html",
      body: url.endsWith("sitemap.xml")
        ? "<urlset></urlset>"
        : `<html><h1>Careers</h1><main>${resourceLinks}<a href="/careers/candidate-guide">Candidate guide</a><a href="${roleUrl}">Registered Nurse</a></main></html>`,
    }));

    const result = await discoverCompanySiteVacancies("ABPI", listingUrl);

    expect(result.adverts).toEqual([
      expect.objectContaining({ title: "Registered Nurse", url: roleUrl }),
    ]);
    expect(result.rejectionReasons.invalid_deep_link).toBeGreaterThanOrEqual(resources.length);
    expect(result.rejectionReasons.missing_posting_specific_evidence).toBeGreaterThan(0);
  });

  it("does not treat a skip-to-content link as a vacancy title", async () => {
    const roleUrl = "https://skip.example/careers/jobs/registered-nurse-12345";
    fetchCompanySitePageMock.mockImplementation(async (url: string) => ({
      ok: true,
      url,
      status: 200,
      contentType: url.endsWith("sitemap.xml") ? "application/xml" : "text/html",
      body: url.endsWith("sitemap.xml")
        ? "<urlset></urlset>"
        : `<html><h1>Careers</h1><nav><a href="${roleUrl}">Skip to main content</a></nav></html>`,
    }));

    const result = await discoverCompanySiteVacancies(
      "Fixture Employer",
      "https://skip.example/careers/",
    );

    expect(result.adverts).toEqual([]);
    expect(result.rejectionReasons.navigation_link_not_vacancy).toBeGreaterThan(0);
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

  it("treats an unavailable optional sitemap as non-fatal while probing common careers paths", async () => {
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

    expect(result.completion).toBe("partial_page_limit");
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
    ["Workable", "https://apply.workable.com/acme/"],
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

  it("imports Pinpoint only through its observed public feed and never treats it as authoritative", async () => {
    const careersUrl = "https://acme.pinpointhq.com/";
    const feedUrl = "https://acme.pinpointhq.com/postings.json";
    fetchCompanySitePublicApiPageMock.mockResolvedValue({
      ok: true,
      url: feedUrl,
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    });

    const result = await discoverCompanySiteVacancies(
      "Official Employer",
      "https://official-employer.example/",
      {
        knownCareersUrl: careersUrl,
        knownCareersMappingVerified: true,
        knownCareersEvidenceUrl: "https://official-employer.example/careers",
        directFeedsOnly: true,
      },
    );

    expect(fetchCompanySitePublicApiPageMock).toHaveBeenCalledWith(
      feedUrl,
      expect.any(Number),
      expect.any(Number),
      { readOnly: false },
    );
    expect(result.atsProvider).toBe("Pinpoint");
    expect(result.atsCompleted).toBe(true);
    expect(result.snapshotScope).toBeUndefined();
    expect(result.diagnostics.directSourceKind).toBe("ats_feed");
    expect(result.adverts).toEqual([]);
  });

  it.each([
    {
      provider: "SmartRecruiters",
      careersUrl: "https://jobs.smartrecruiters.com/Acme",
      feedUrl: "https://api.smartrecruiters.com/v1/companies/Acme/postings?limit=100&offset=0",
      body: JSON.stringify({
        totalFound: 1,
        content: [{
          id: "sr-123",
          name: "Senior Engineer",
          postingUrl: "https://jobs.smartrecruiters.com/Acme/1234",
          location: { city: "London", country: "United Kingdom" },
        }],
      }),
      advertUrl: "https://jobs.smartrecruiters.com/Acme/1234",
    },
    {
      provider: "Personio",
      careersUrl: "https://acme.jobs.personio.com/",
      feedUrl: "https://acme.jobs.personio.com/xml",
      body: "<workzag-jobs><position><id>p-123</id><name>People Partner</name><office>London</office></position></workzag-jobs>",
      advertUrl: "https://acme.jobs.personio.com/job/p-123",
    },
    {
      provider: "Recruitee",
      careersUrl: "https://acme.recruitee.com/",
      feedUrl: "https://acme.recruitee.com/api/offers/",
      body: JSON.stringify({
        offers: [{
          id: "r-123",
          title: "Product Designer",
          careers_url: "https://acme.recruitee.com/o/product-designer",
          location: "London",
        }],
      }),
      advertUrl: "https://acme.recruitee.com/o/product-designer",
    },
  ])("imports supported $provider direct-feed postings from a verified mapping", async ({
    provider,
    careersUrl,
    feedUrl,
    body,
    advertUrl,
  }) => {
    fetchCompanySitePageMock.mockImplementation(async (url: string) => ({
      ok: true,
      url,
      status: 200,
      contentType: "text/html",
      body: `<nav><a href="${careersUrl}">Careers</a></nav>`,
    }));
    fetchCompanySitePublicApiPageMock.mockResolvedValue({
      ok: true,
      url: feedUrl,
      status: 200,
      contentType: provider === "Personio" ? "application/xml" : "application/json",
      body,
    });

    const result = await discoverCompanySiteVacancies(
      "Official Employer",
      "https://official-employer.example/",
    );

    expect(fetchCompanySitePublicApiPageMock).toHaveBeenCalledWith(
      feedUrl,
      expect.any(Number),
      expect.any(Number),
      { readOnly: false },
    );
    expect(result.atsProvider).toBe(provider);
    if (provider === "Personio" || provider === "Recruitee") {
      expect(result.snapshotScope).toBeUndefined();
    }
    expect(result.adverts).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: advertUrl, sourceType: "company_site" }),
    ]));
    expect(result.diagnostics.atsLinksSeen).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider,
        supportedForImport: true,
        followed: true,
      }),
    ]));
  });

  it("does not fall back to employer HTML when a direct-feed-only ATS request fails", async () => {
    const careersUrl = "https://jobs.ashbyhq.com/acme";
    fetchCompanySitePublicApiPageMock.mockResolvedValue({
      ok: false,
      kind: "network",
      reason: "Direct feed unavailable in fixture",
      failureClass: "temporary",
    });

    const result = await discoverCompanySiteVacancies(
      "Acme Limited",
      "https://acme.example/",
      {
        knownCareersUrl: careersUrl,
        knownAtsBoardId: "acme",
        knownCareersMappingVerified: true,
        directFeedsOnly: true,
      },
    );

    expect(fetchCompanySitePublicApiPageMock).toHaveBeenCalledTimes(1);
    expect(fetchCompanySitePageMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      completion: "failed",
      genericCompleted: false,
      diagnostics: {
        directFeedsOnly: true,
        directSourceKind: "ats_feed",
      },
    });
  });

  it("does not import schema.org listings through the strict direct-feeds-only path", async () => {
    const careersUrl = "https://schema-employer.example/careers";
    const jobUrl = "https://schema-employer.example/careers/jobs/123456";
    fetchCompanySitePageMock.mockResolvedValue({
      ok: true,
      url: careersUrl,
      status: 200,
      contentType: "text/html",
      body: `<script type="application/ld+json">{
        "@context":"https://schema.org",
        "@type":"JobPosting",
        "title":"Care Assistant",
        "url":"${jobUrl}",
        "description":"Provide safe and compassionate care.",
        "hiringOrganization":{"@type":"Organization","name":"Schema Employer"},
        "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"London","addressCountry":"GB"}}
      }</script><a href="https://schema-employer.example/careers/benefits">Benefits</a>`,
    });

    const result = await discoverCompanySiteVacancies(
      "Schema Employer",
      "https://schema-employer.example/",
      {
        knownCareersUrl: careersUrl,
        knownCareersMappingVerified: true,
        directFeedsOnly: true,
      },
    );

    expect(fetchCompanySitePageMock).not.toHaveBeenCalled();
    expect(fetchCompanySitePublicApiPageMock).not.toHaveBeenCalled();
    expect(result.adverts).toEqual([]);
    expect(result.diagnostics).toMatchObject({
      directFeedsOnly: true,
      directSourceKind: null,
      directFeedSkipReason: "no_direct_feed_source",
    });
  });

  it("skips direct-feeds-only discovery without a verified source mapping", async () => {
    const result = await discoverCompanySiteVacancies(
      "Unmapped Employer",
      "https://unmapped.example/",
      {
        knownCareersUrl: "https://unmapped.example/careers",
        knownCareersMappingVerified: false,
        directFeedsOnly: true,
      },
    );

    expect(fetchCompanySitePageMock).not.toHaveBeenCalled();
    expect(fetchCompanySitePublicApiPageMock).not.toHaveBeenCalled();
    expect(result.diagnostics.directFeedSkipReason).toBe("no_direct_feed_source");
  });

  it("uses the vacancy slug when the listing link only says find out more", async () => {
    const listing = "https://fixture.example/careers/vacancies";
    const job = "https://fixture.example/careers/vacancies/sys-4933-care-assistant-purley-surrey";
    fetchCompanySitePageMock.mockImplementation(async (url: string) => ({
      ok: true,
      url,
      status: 200,
      contentType: "text/html",
      body: `<h1>Search for roles nearby</h1><a href="${job}">Find out more</a>`,
    }));
    const result = await discoverCompanySiteVacancies("Fixture Employer", listing, {
      knownCareersUrl: listing,
    });
    expect(result.adverts[0]).toMatchObject({
      title: "sys 4933 care assistant purley surrey",
      url: job,
    });
  });

  it("fetches a known same-site careers list before the homepage", async () => {
    const home = "https://careuk.example/";
    const careers = "https://careuk.example/careers/vacancies";
    await discoverCompanySiteVacancies("Care UK Care Services Ltd", home, {
      knownCareersUrl: careers,
      checkGeneric: true,
      checkAts: true,
    });
    expect(fetchCompanySitePageMock.mock.calls[0]?.[0]).toBe(careers);
  });

  it("normalises bare sponsor domains and rejects non-http schemes", () => {
    expect(normaliseSponsorWebsite("example.org")).toBe("https://example.org/");
    expect(normaliseSponsorWebsite("ftp://example.org")).toBeNull();
  });
});