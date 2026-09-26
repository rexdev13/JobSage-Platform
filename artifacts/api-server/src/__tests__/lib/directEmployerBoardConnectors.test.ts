import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/companySiteHttp", () => ({
  fetchCompanySitePublicApiPage: vi.fn(),
  fetchCompanySiteRobotsAwarePublicApiPage: vi.fn(),
}));

const {
  parseDirectBoardMapping,
  fetchDirectEmployerBoard,
} = await import("../../lib/directEmployerBoardConnectors");
const {
  fetchCompanySitePublicApiPage,
  fetchCompanySiteRobotsAwarePublicApiPage,
} = await import("../../lib/companySiteHttp");

describe("direct employer board connectors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives strict board mappings only from saved platform URLs", () => {
    expect(parseDirectBoardMapping("Ashby", "https://jobs.ashbyhq.com/9fin")).toMatchObject({
      provider: "Ashby",
      boardId: "9fin",
    });
    expect(parseDirectBoardMapping("Greenhouse", "https://boards.greenhouse.io/appier")).toMatchObject({
      provider: "Greenhouse",
      boardId: "appier",
    });
    expect(parseDirectBoardMapping("Lever", "https://jobs.lever.co/aeratechnology")).toMatchObject({
      provider: "Lever",
      boardId: "aeratechnology",
    });
    expect(parseDirectBoardMapping(
      "Ashby",
      "https://jobs.ashbyhq.com/9fin/form/talent-community",
    )).toMatchObject({
      provider: "Ashby",
      boardId: "9fin",
      feedUrl: "https://api.ashbyhq.com/posting-api/job-board/9fin",
    });
    expect(parseDirectBoardMapping("Ashby", "https://jobs.ashbyhq.com/9fin/not-a-job")).toBeNull();
    expect(parseDirectBoardMapping("Ashby", "https://example.com/9fin")).toBeNull();
    expect(parseDirectBoardMapping("Greenhouse", "https://boards.greenhouse.io/")).toBeNull();
    expect(parseDirectBoardMapping("SmartRecruiters", "https://jobs.smartrecruiters.com/acme")).toMatchObject({
      provider: "SmartRecruiters",
      boardId: "acme",
      feedUrl: "https://api.smartrecruiters.com/v1/companies/acme/postings?limit=100&offset=0",
    });
    expect(parseDirectBoardMapping(
      "SmartRecruiters",
      "https://jobs.smartrecruiters.com/acme/senior-engineer/123",
    )).toMatchObject({ provider: "SmartRecruiters", boardId: "acme" });
    expect(parseDirectBoardMapping("Recruitee", "https://acme.recruitee.com/o/engineer")).toMatchObject({
      provider: "Recruitee",
      boardId: "acme",
      feedUrl: "https://acme.recruitee.com/api/offers/",
    });
    expect(parseDirectBoardMapping("Personio", "https://acme.jobs.personio.de/job/123")).toMatchObject({
      provider: "Personio",
      boardId: "acme",
      feedUrl: "https://acme.jobs.personio.de/xml",
    });
    expect(parseDirectBoardMapping(
      "Pinpoint",
      "https://dentalbeautypartners.pinpointhq.com/",
      { firstPartyEvidenceUrl: "https://careers.dentalbeautypartners.co.uk/" },
    )).toMatchObject({
      provider: "Pinpoint",
      boardId: "dentalbeautypartners",
      feedUrl: "https://dentalbeautypartners.pinpointhq.com/postings.json",
      postingHostnames: [
        "dentalbeautypartners.pinpointhq.com",
        "careers.dentalbeautypartners.co.uk",
      ],
    });
    expect(parseDirectBoardMapping("Pinpoint", "https://www.pinpointhq.com/")).toBeNull();
    expect(parseDirectBoardMapping("Pinpoint", "https://dentalbeautypartners.pinpointhq.com/unrelated")).toBeNull();
    expect(parseDirectBoardMapping("SmartRecruiters", "https://evil.smartrecruiters.com/acme")).toBeNull();
    expect(parseDirectBoardMapping("SmartRecruiters", "https://jobs.smartrecruiters.com/acme/jobs")).toBeNull();
    expect(parseDirectBoardMapping("Recruitee", "https://acme.recruitee.com/unrelated/path")).toBeNull();
    expect(parseDirectBoardMapping("Personio", "https://acme.jobs.personio.de/careers")).toBeNull();
    expect(parseDirectBoardMapping("Personio", "http://acme.jobs.personio.de/")).toBeNull();
    expect(parseDirectBoardMapping("Lever", "https://user@jobs.lever.co/acme")).toBeNull();
  });

  it("excludes unlisted Ashby jobs and preserves exact listing URLs and IDs", async () => {
    vi.mocked(fetchCompanySitePublicApiPage).mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://api.ashbyhq.com/posting-api/job-board/9fin",
      contentType: "application/json",
      body: JSON.stringify({
        jobs: [
          {
            id: "listed-id",
            title: "Senior Engineer",
            jobUrl: "https://jobs.ashbyhq.com/9fin/listed-id",
            descriptionPlain: "Full description",
            location: "London",
            publishedAt: "2025-01-01T00:00:00Z",
            isListed: true,
          },
          {
            id: "hidden-id",
            title: "Hidden",
            jobUrl: "https://jobs.ashbyhq.com/9fin/hidden-id",
            isListed: false,
          },
        ],
      }),
    });
    const result = await fetchDirectEmployerBoard("9fin Limited", "Ashby", "https://jobs.ashbyhq.com/9fin");
    expect(result.complete).toBe(true);
    expect(fetchCompanySitePublicApiPage).toHaveBeenCalledOnce();
    expect(fetchCompanySiteRobotsAwarePublicApiPage).not.toHaveBeenCalled();
    expect(result.adverts).toHaveLength(1);
    expect(result.adverts[0]).toMatchObject({
      externalId: "listed-id",
      url: "https://jobs.ashbyhq.com/9fin/listed-id",
      applicationUrl: null,
      title: "Senior Engineer",
      description: "Full description",
      location: "London",
      sourceType: "company_site",
    });
  });

  it("extracts Greenhouse jobs whose provider IDs are numeric", async () => {
    vi.mocked(fetchCompanySitePublicApiPage).mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://boards-api.greenhouse.io/v1/boards/public/jobs?content=true",
      contentType: "application/json",
      body: JSON.stringify({
        jobs: [
          {
            id: 7982150003,
            title: "Active Trader Sales: Options Lead",
            absolute_url: "https://job-boards.greenhouse.io/public/jobs/7982150003",
            content: "<p>About Public</p>",
            location: { name: "New York City or US Remote" },
            updated_at: "2026-08-31T14:25:18-04:00",
          },
          {
            id: 7970574003,
            title: "Lifecycle Marketing Lead",
            absolute_url: "https://job-boards.greenhouse.io/public/jobs/7970574003",
            location: { name: "New York, New York" },
          },
        ],
      }),
    });
    const result = await fetchDirectEmployerBoard(
      "Public",
      "Greenhouse",
      "https://job-boards.greenhouse.io/public",
    );

    expect(result.complete).toBe(true);
    expect(result.adverts).toHaveLength(2);
    expect(fetchCompanySitePublicApiPage).toHaveBeenCalledOnce();
    expect(fetchCompanySiteRobotsAwarePublicApiPage).not.toHaveBeenCalled();
    expect(result.adverts[0]).toMatchObject({
      externalId: "7982150003",
      url: "https://job-boards.greenhouse.io/public/jobs/7982150003",
      title: "Active Trader Sales: Options Lead",
      description: "About Public",
      location: "New York City or US Remote",
    });
  });

  it("paginates Lever until a short page and reports malformed pages incomplete", async () => {
    const page = (count: number, start: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `id-${start + i}`,
        text: `Role ${start + i}`,
        hostedUrl: `https://jobs.lever.co/board/id-${start + i}`,
        applyUrl: `https://jobs.lever.co/board/id-${start + i}/apply`,
        descriptionPlain: "Description",
        categories: { location: "London" },
      }));
    vi.mocked(fetchCompanySitePublicApiPage)
      .mockResolvedValueOnce({
        ok: true, status: 200, url: "https://api.lever.co/v0/postings/board?skip=0",
        contentType: "application/json", body: JSON.stringify(page(100, 0)),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, url: "https://api.lever.co/v0/postings/board?skip=100",
        contentType: "application/json", body: JSON.stringify(page(1, 100)),
      });
    const result = await fetchDirectEmployerBoard("Board Ltd", "Lever", "https://jobs.lever.co/board");
    expect(result.complete).toBe(true);
    expect(result.pagesFetched).toBe(2);
    expect(fetchCompanySitePublicApiPage).toHaveBeenCalledTimes(2);
    expect(fetchCompanySiteRobotsAwarePublicApiPage).not.toHaveBeenCalled();
    expect(result.adverts).toHaveLength(101);
    expect(result.adverts[0]?.url).toBe("https://jobs.lever.co/board/id-0");
    expect(result.adverts[0]?.applicationUrl).toBe("https://jobs.lever.co/board/id-0/apply");
  });

  it("paginates SmartRecruiters by its declared total and validates posting URLs", async () => {
    vi.mocked(fetchCompanySitePublicApiPage)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        url: "https://api.smartrecruiters.com/v1/companies/acme/postings?limit=100&offset=0",
        contentType: "application/json",
        body: JSON.stringify({
          totalFound: 2,
          content: [{
            id: 101,
            name: "Senior Engineer",
            postingUrl: "https://jobs.smartrecruiters.com/acme/senior-engineer/101",
            location: { city: "London", country: "UK" },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        url: "https://api.smartrecruiters.com/v1/companies/acme/postings?limit=100&offset=1",
        contentType: "application/json",
        body: JSON.stringify({
          totalFound: 2,
          content: [{
            id: 102,
            name: "Product Manager",
            postingUrl: "https://jobs.smartrecruiters.com/acme/product-manager/102",
          }],
        }),
      });
    const result = await fetchDirectEmployerBoard(
      "Acme",
      "SmartRecruiters",
      "https://jobs.smartrecruiters.com/acme",
    );
    expect(result.complete).toBe(true);
    expect(result.pagesFetched).toBe(2);
    expect(fetchCompanySitePublicApiPage).toHaveBeenCalledTimes(2);
    expect(fetchCompanySiteRobotsAwarePublicApiPage).not.toHaveBeenCalled();
    expect(result.adverts).toHaveLength(2);
    expect(result.adverts[0]).toMatchObject({
      externalId: "101",
      title: "Senior Engineer",
      url: "https://jobs.smartrecruiters.com/acme/senior-engineer/101",
      location: "London, UK",
    });
  });

  it("rejects a SmartRecruiters feed with a non-provider posting URL", async () => {
    vi.mocked(fetchCompanySitePublicApiPage).mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://api.smartrecruiters.com/v1/companies/acme/postings?limit=100&offset=0",
      contentType: "application/json",
      body: JSON.stringify({
        content: [{
          id: "bad-url",
          name: "Engineer",
          postingUrl: "https://attacker.example/acme/engineer",
        }],
      }),
    });
    const result = await fetchDirectEmployerBoard(
      "Acme",
      "SmartRecruiters",
      "https://jobs.smartrecruiters.com/acme",
    );
    expect(result.complete).toBe(false);
    expect(result.adverts).toHaveLength(0);
    expect(result.error).toMatch(/invalid job identity\/title\/URL/);
  });

  it("keeps a short SmartRecruiters response partial when it omits totalFound", async () => {
    vi.mocked(fetchCompanySitePublicApiPage).mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://api.smartrecruiters.com/v1/companies/acme/postings?limit=100&offset=0",
      contentType: "application/json",
      body: JSON.stringify({
        content: [{
          id: "partial-role",
          name: "Engineer",
          postingUrl: "https://jobs.smartrecruiters.com/acme/engineer/partial-role",
        }],
      }),
    });
    const result = await fetchDirectEmployerBoard(
      "Acme",
      "SmartRecruiters",
      "https://jobs.smartrecruiters.com/acme",
    );
    expect(result.complete).toBe(false);
    expect(result.adverts).toHaveLength(1);
    expect(result.adverts[0]?.externalId).toBe("partial-role");
    expect(result.error).toMatch(/total is missing or unstable/);
  });

  it("parses Recruitee and Personio postings without accepting incomplete feeds", async () => {
    vi.mocked(fetchCompanySiteRobotsAwarePublicApiPage).mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "https://acme.recruitee.com/api/offers/",
      contentType: "application/json",
      body: JSON.stringify({
        offers: [{
          id: 17,
          title: "Designer",
          careers_url: "https://acme.recruitee.com/o/designer",
          description: "<p>Design the product</p>",
          city: "London",
        }],
      }),
    });
    const recruitee = await fetchDirectEmployerBoard(
      "Acme",
      "Recruitee",
      "https://acme.recruitee.com/",
    );
    expect(recruitee.complete).toBe(false);
    expect(recruitee.error).toMatch(/no trustworthy total or pagination metadata/);
    expect(fetchCompanySiteRobotsAwarePublicApiPage).toHaveBeenCalledWith(
      "https://acme.recruitee.com/api/offers/",
      expect.any(Number),
      2_000_000,
    );
    expect(recruitee.adverts[0]).toMatchObject({
      externalId: "17",
      title: "Designer",
      url: "https://acme.recruitee.com/o/designer",
      applicationUrl: "https://acme.recruitee.com/o/designer",
      description: "Design the product",
      location: "London",
    });

    vi.mocked(fetchCompanySiteRobotsAwarePublicApiPage).mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "https://acme.jobs.personio.de/xml",
      contentType: "application/xml",
      body: `<?xml version="1.0"?><workzag-jobs><position><id>42</id><name>Analyst</name><office>Berlin</office></position></workzag-jobs>`,
    });
    const personio = await fetchDirectEmployerBoard(
      "Acme",
      "Personio",
      "https://acme.jobs.personio.de/",
    );
    expect(personio.complete).toBe(true);
    expect(fetchCompanySiteRobotsAwarePublicApiPage).toHaveBeenLastCalledWith(
      "https://acme.jobs.personio.de/xml",
      expect.any(Number),
      2_000_000,
    );
    expect(fetchCompanySitePublicApiPage).not.toHaveBeenCalled();
    expect(personio.adverts[0]).toMatchObject({
      externalId: "42",
      title: "Analyst",
      url: "https://acme.jobs.personio.de/job/42",
      applicationUrl: "https://acme.jobs.personio.de/job/42",
      location: "Berlin",
    });
  });

  it("parses Pinpoint postings from the documented feed and restricts listing URLs to the approved career host", async () => {
    vi.mocked(fetchCompanySitePublicApiPage).mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "https://dentalbeautypartners.pinpointhq.com/postings.json",
      contentType: "application/json",
      body: JSON.stringify({
        data: [{
          id: "559205",
          title: "Practice Manager",
          url: "https://careers.dentalbeautypartners.co.uk/en/postings/308f97ff-679c-4bff-b8a8-e2d94000000b",
          description: "<p>Lead the dental practice team.</p>",
          employment_type: "permanent",
          location: {
            name: "Streatham",
            city: "Streatham",
            province: "Greater London",
          },
          job: {
            division: { name: "Dental Beauty Partners" },
          },
        }],
      }),
    });
    const result = await fetchDirectEmployerBoard(
      "DENTAL BEAUTY GROUP LTD",
      "Pinpoint",
      "https://dentalbeautypartners.pinpointhq.com/",
      { firstPartyEvidenceUrl: "https://careers.dentalbeautypartners.co.uk/" },
    );
    expect(result.complete).toBe(true);
    expect(result.adverts).toHaveLength(1);
    expect(result.adverts[0]).toMatchObject({
      organisationName: "DENTAL BEAUTY GROUP LTD",
      externalId: "559205",
      title: "Practice Manager",
      url: "https://careers.dentalbeautypartners.co.uk/en/postings/308f97ff-679c-4bff-b8a8-e2d94000000b",
      applicationUrl: "https://careers.dentalbeautypartners.co.uk/en/postings/308f97ff-679c-4bff-b8a8-e2d94000000b",
      description: "Lead the dental practice team.",
      location: "Streatham, Greater London",
      sourceType: "company_site",
      companyVacancyEvidence: {
        kind: "known_ats_posting",
        provider: "Pinpoint",
        listingUrl: "https://dentalbeautypartners.pinpointhq.com/",
      },
    });
    expect(fetchCompanySitePublicApiPage).toHaveBeenCalledWith(
      "https://dentalbeautypartners.pinpointhq.com/postings.json",
      expect.any(Number),
      2_000_000,
    );
    expect(fetchCompanySiteRobotsAwarePublicApiPage).not.toHaveBeenCalled();

    vi.mocked(fetchCompanySitePublicApiPage).mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "https://dentalbeautypartners.pinpointhq.com/postings.json",
      contentType: "application/json",
      body: JSON.stringify({
        data: [{
          id: "untrusted",
          title: "Unexpected",
          url: "https://attacker.example/jobs/untrusted",
        }],
      }),
    });
    const untrusted = await fetchDirectEmployerBoard(
      "DENTAL BEAUTY GROUP LTD",
      "Pinpoint",
      "https://dentalbeautypartners.pinpointhq.com/",
      { firstPartyEvidenceUrl: "https://careers.dentalbeautypartners.co.uk/" },
    );
    expect(untrusted.complete).toBe(false);
    expect(untrusted.adverts).toHaveLength(0);
    expect(untrusted.error).toMatch(/invalid Pinpoint posting identity\/title\/URL/);
  });

  it("does not claim complete snapshots for truncated XML or unpaginated Recruitee feeds", async () => {
    vi.mocked(fetchCompanySiteRobotsAwarePublicApiPage).mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "https://acme.jobs.personio.de/xml",
      contentType: "application/xml",
      body: "<workzag-jobs><position><id>42</id><name>Analyst</name></position>",
    });
    const truncatedXml = await fetchDirectEmployerBoard(
      "Acme",
      "Personio",
      "https://acme.jobs.personio.de/",
    );
    expect(truncatedXml.complete).toBe(false);
    expect(truncatedXml.adverts).toHaveLength(0);

    vi.mocked(fetchCompanySiteRobotsAwarePublicApiPage).mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "https://acme.recruitee.com/api/offers/",
      contentType: "application/json",
      body: JSON.stringify({
        offers: Array.from({ length: 100 }, (_, id) => ({
          id,
          title: `Role ${id}`,
          careers_url: `https://acme.recruitee.com/o/role-${id}`,
        })),
      }),
    });
    const cappedRecruitee = await fetchDirectEmployerBoard(
      "Acme",
      "Recruitee",
      "https://acme.recruitee.com/",
    );
    expect(cappedRecruitee.complete).toBe(false);
    expect(cappedRecruitee.adverts).toHaveLength(100);
  });

  it("rejects malformed Personio positions and accepts a well-formed empty feed", async () => {
    vi.mocked(fetchCompanySiteRobotsAwarePublicApiPage).mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "https://acme.jobs.personio.de/xml",
      contentType: "application/xml",
      body: "<workzag-jobs><position><id>42</id><name>Analyst</name></workzag-jobs>",
    });
    const malformed = await fetchDirectEmployerBoard(
      "Acme",
      "Personio",
      "https://acme.jobs.personio.de/",
    );
    expect(malformed.complete).toBe(false);
    expect(malformed.adverts).toHaveLength(0);
    expect(malformed.error).toMatch(/malformed or unclosed position/);

    vi.mocked(fetchCompanySiteRobotsAwarePublicApiPage).mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "https://acme.jobs.personio.de/xml",
      contentType: "application/xml",
      body: `<?xml version="1.0"?><workzag-jobs></workzag-jobs>`,
    });
    const empty = await fetchDirectEmployerBoard(
      "Acme",
      "Personio",
      "https://acme.jobs.personio.de/",
    );
    expect(empty.complete).toBe(true);
    expect(empty.adverts).toHaveLength(0);
  });
});