import { describe, expect, it, vi } from "vitest";
import {
  boardVacancyFingerprint,
  mergeCompanyVacancyEvidence,
  discoverEmployerBoardVacancies,
  normaliseAndDedupeBoardAdverts,
  persistScrapedAdvertContacts,
  type BoardAdapter,
  type BoardAdvert,
} from "../../lib/boardVacancyPipeline";

function advert(overrides: Partial<BoardAdvert> = {}): BoardAdvert {
  return {
    organisationName: "Example NHS Trust",
    employer: "Example NHS Trust",
    title: "Staff Nurse",
    location: "London",
    salary: null,
    url: "https://www.jobs.nhs.uk/candidate/jobadvert/C123?language=en",
    description: null,
    postedDate: null,
    targetRegions: ["London"],
    boardName: "NHS Jobs",
    externalId: "C123",
    ...overrides,
  };
}

function knownAtsAdvert(externalId: string, url: string): BoardAdvert {
  return advert({
    organisationName: "Example NHS Trust",
    title: "Patient Administrator",
    location: "Guildford",
    sourceType: "company_site",
    boardName: null,
    externalId,
    url,
    companyVacancyEvidence: {
      kind: "known_ats_posting",
      provider: "Workday",
      listingUrl: "https://careers.example.nhs.uk/careers",
    },
  });
}

describe("shared board vacancy pipeline", () => {
  const approved = {
    roleEligibilityReview: {
      status: "approved",
      socCode: "1234",
      evidenceUrl: "https://evidence.example/role-1",
    },
  };
  const existing = {
    organisationName: "Example NHS Trust",
    sourceType: "company_site",
    externalListingId: "role-1",
    url: "https://careers.example/jobs/role-1",
    title: "Operations Manager",
    companyVacancyEvidence: approved,
  };

  it("preserves approved review evidence for the exact same company-site role", () => {
    expect(mergeCompanyVacancyEvidence(existing, {
      ...advert({
        organisationName: "Example NHS Trust",
        sourceType: "company_site",
        externalId: "role-1",
        url: "https://careers.example/jobs/role-1",
        title: "Operations Manager",
        companyVacancyEvidence: { kind: "structured_job_card" },
      }),
    })).toMatchObject({ roleEligibilityReview: approved.roleEligibilityReview });
  });

  it("omits evidence fields when a refresh supplies no evidence", () => {
    expect(mergeCompanyVacancyEvidence(existing, {
      ...advert({
        organisationName: "Example NHS Trust",
        sourceType: "company_site",
        externalId: "role-1",
        url: "https://careers.example/jobs/role-1",
        title: "Staff Nurse",
      }),
    })).toBeUndefined();
  });

  it.each([
    ["changed title", { title: "Senior Operations Manager" }],
    ["changed identity", { externalId: "role-2" }],
    ["changed employer", { organisationName: "Other Trust" }],
    ["job board source", { sourceType: "job_board" }],
  ])("clears review evidence for %s", (_label, changes) => {
    expect(mergeCompanyVacancyEvidence(existing, {
      ...advert({
        organisationName: "Example NHS Trust",
        sourceType: "company_site",
        externalId: "role-1",
        url: "https://careers.example/jobs/role-1",
        title: "Operations Manager",
      }),
      ...(changes as Partial<BoardAdvert>),
    })).toBeUndefined();
  });

  it("supports a fake board through the adapter contract without pipeline changes", async () => {
    const adapter: BoardAdapter = {
      id: "fake",
      reserve: vi.fn().mockResolvedValue({ allowed: true, organisationKey: "example", leaseId: "1" }),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(null),
      searchByEmployer: vi.fn().mockResolvedValue({
        sourceUrl: "https://fake.example/jobs",
        adverts: [advert()],
        requestSucceeded: true,
        transientFailure: false,
      }),
    };

    const result = await discoverEmployerBoardVacancies("Example NHS Trust", [adapter]);

    expect(result.adverts).toHaveLength(1);
    expect(result.boardCounts).toEqual({ fake: 1 });
    expect(adapter.complete).toHaveBeenCalledTimes(1);
  });

  it("deduplicates canonical URLs and organisation/title/location fingerprints with NHS preference", () => {
    const result = normaliseAndDedupeBoardAdverts([
      advert({
        boardName: "Reed",
        url: "https://www.reed.co.uk/jobs/staff-nurse/12345?utm_source=test",
        externalId: "12345",
      }),
      advert(),
      advert({ url: "https://www.jobs.nhs.uk/candidate/jobadvert/C123?language=en&utm_medium=email" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ boardName: "NHS Jobs", externalId: "C123" });
  });

  it("keeps a direct employer advert when a job-board advert has the same fingerprint", () => {
    const result = normaliseAndDedupeBoardAdverts([
      advert(),
      advert({
        sourceType: "company_site",
        url: "https://careers.example.nhs.uk/jobs/staff-nurse-123",
        boardName: null,
        externalId: null,
        companyVacancyEvidence: {
          kind: "structured_job_card",
          listingUrl: "https://careers.example.nhs.uk/jobs/staff-nurse-123",
        },
      }),
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.sourceType).sort()).toEqual(["company_site", "job_board"]);
  });

  it("drops manual-labour titles before persistence", () => {
    expect(normaliseAndDedupeBoardAdverts([advert({ title: "Warehouse Operative" })])).toEqual([]);
  });

  it("recovers a labelled closing date stored in postedDate", () => {
    const [normalized] = normaliseAndDedupeBoardAdverts([advert({
      organisationName: "Accelerate Health CIC",
      title: "Community Wound Care Nurse",
      location: "London",
      sourceType: "company_site",
      boardName: null,
      externalId: null,
      url: "https://www.acceleratecic.com/about/careers/community-wound-care-nurse/",
      postedDate: "Closing date: 28 May 2025",
      companyVacancyEvidence: { kind: "structured_job_card" },
    })]);

    expect(normalized?.closesAt?.toISOString()).toBe("2025-05-28T22:59:59.999Z");
    expect(normalized?.postedDate).toBeNull();
  });

  it("omits close date when a refresh has no close-date evidence", () => {
    const [normalized] = normaliseAndDedupeBoardAdverts([advert({
      sourceType: "company_site",
      boardName: null,
      externalId: null,
      url: "https://careers.example.nhs.uk/jobs/staff-nurse-123",
      closesAt: null,
      postedDate: "2026-05-28",
      companyVacancyEvidence: { kind: "structured_job_card" },
    })]);

    expect(normalized?.closesAt).toBeUndefined();
    expect(normalized?.postedDate).toBe("2026-05-28");
  });

  it("clears an unspecified closing label without inventing a close date", () => {
    const [normalized] = normaliseAndDedupeBoardAdverts([advert({
      sourceType: "company_site",
      boardName: null,
      externalId: null,
      url: "https://careers.example.nhs.uk/jobs/leg-ulcer-nurse-456",
      postedDate: "Closing date: Not specified",
      companyVacancyEvidence: { kind: "structured_job_card" },
    })]);

    expect(normalized?.closesAt).toBeUndefined();
    expect(normalized?.postedDate).toBeNull();
  });

  it("preserves distinct known ATS posting IDs that share a fingerprint", () => {
    const result = normaliseAndDedupeBoardAdverts([
      knownAtsAdvert("JR117009", "https://careers.example.nhs.uk/jobs/JR117009"),
      knownAtsAdvert("JR115988", "https://careers.example.nhs.uk/jobs/JR115988"),
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.externalId).sort()).toEqual(["JR115988", "JR117009"]);
  });

  it("deduplicates a repeated ATS ID and prefers verified ATS evidence over a generic crawl", () => {
    const direct = knownAtsAdvert("JR117009", "https://careers.example.nhs.uk/jobs/JR117009");
    const repeatedDirect = {
      ...direct,
      url: "https://careers.example.nhs.uk/jobs/JR117009?source=refresh",
    };
    const generic = advert({
      ...direct,
      sourceType: "company_site",
      boardName: null,
      externalId: null,
      url: "https://careers.example.nhs.uk/jobs/patient-administrator",
      companyVacancyEvidence: {
        kind: "structured_job_card",
        listingUrl: "https://careers.example.nhs.uk/careers",
      },
    });

    const result = normaliseAndDedupeBoardAdverts([generic, direct, repeatedDirect]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      externalId: "JR117009",
      companyVacancyEvidence: { kind: "known_ats_posting" },
    });
  });

  it("normalises fingerprint case, whitespace, and punctuation", () => {
    expect(boardVacancyFingerprint(advert())).toBe(
      boardVacancyFingerprint(advert({
        organisationName: " EXAMPLE   NHS TRUST ",
        title: "Staff-Nurse",
        location: "LONDON!",
      })),
    );
  });

  it("keeps a separate exact application URL on repeat-import adverts", () => {
    const first = normaliseAndDedupeBoardAdverts([advert({
      sourceType: "company_site",
      boardName: null,
      url: "https://jobs.lever.co/example/job-1",
      applicationUrl: "https://jobs.lever.co/example/job-1/apply",
      companyVacancyEvidence: { kind: "known_ats_posting", provider: "Lever" },
    })]);
    const repeatWithoutApplyUrl = normaliseAndDedupeBoardAdverts([advert({
      sourceType: "company_site",
      boardName: null,
      url: "https://jobs.lever.co/example/job-1",
      applicationUrl: null,
      companyVacancyEvidence: { kind: "known_ats_posting", provider: "Lever" },
    })]);
    expect(first[0]?.applicationUrl).toBe("https://jobs.lever.co/example/job-1/apply");
    expect(repeatWithoutApplyUrl[0]?.applicationUrl).toBeNull();
    // Persistence uses the existing-row value when the repeat source omits it.
    expect(repeatWithoutApplyUrl[0]?.url).toBe(first[0]?.url);
  });

  it("does not overwrite an existing sponsor contact or write false provenance", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });

    await expect(persistScrapedAdvertContacts({ execute }, [advert({
      contactEmail: "recruitment@example.org",
      contactEvidenceUrl: "https://www.jobs.nhs.uk/candidate/jobadvert/C123",
    })])).resolves.toEqual({
      upserted: 0,
      skippedExisting: 1,
      rejected: 0,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("records provenance only after a blank sponsor contact was filled", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(persistScrapedAdvertContacts({ execute }, [advert({
      contactEmail: "recruitment@example.org",
      contactEvidenceUrl: "https://www.jobs.nhs.uk/candidate/jobadvert/C123",
    })])).resolves.toEqual({
      upserted: 1,
      skippedExisting: 0,
      rejected: 0,
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});