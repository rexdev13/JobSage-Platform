import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectResults,
  insertValuesMock,
  updateSetMock,
  deleteWhereMock,
  fetchSponsorVacanciesAsRolesMock,
  sendJobAlertEmailMock,
} = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  insertValuesMock: vi.fn(),
  updateSetMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  fetchSponsorVacanciesAsRolesMock: vi.fn(),
  sendJobAlertEmailMock: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const tables = {
    profilesTable: { userId: "profile.userId", lastAlertSentAt: "profile.lastAlertSentAt", active: "profile.active" },
    rolesTable: { active: "roles.active" },
    decisionRecordsTable: { userId: "decision.userId", createdAt: "decision.createdAt" },
    usersTable: { id: "users.id" },
    jobAlertVacancyDeliveriesTable: { userId: "delivery.userId", vacancyUrl: "delivery.vacancyUrl" },
    jobListingsTable: { employerProfileId: "job.employerProfileId", status: "job.status" },
    employerProfilesTable: { id: "employer.id" },
    candidateMatchScoresTable: { userId: "score.userId" },
    sponsorLicenceVacancyScoresTable: { userId: "sponsorScore.userId" },
    vacancyFavoritesTable: { userId: "favourite.userId" },
    sponsorLicenceBookmarksTable: { userId: "bookmark.userId", sponsorLicenceId: "bookmark.sponsorLicenceId" },
    sponsorLicencesTable: { id: "licence.id", organisationName: "licence.organisationName" },
    applicationsTable: { userId: "application.userId" },
    careerProfilesTable: { userId: "career.userId", isActive: "career.isActive" },
  };

  function chain(result: unknown[]) {
    const value: any = {
      from: () => value,
      innerJoin: () => value,
      where: () => value,
      orderBy: () => value,
      limit: () => value,
      then: (resolve: (result: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return value;
  }

  return {
    ...tables,
    db: {
      select: () => chain(selectResults.shift() ?? []),
      update: () => ({
        set: (values: unknown) => {
          updateSetMock(values);
          const updateChain: any = {
            where: () => updateChain,
            returning: () => Promise.resolve([{ userId: "candidate-1" }]),
          };
          return updateChain;
        },
      }),
      insert: () => ({
        values: (rows: unknown[]) => {
          insertValuesMock(rows);
          return {
            onConflictDoNothing: () => ({
              returning: () =>
                Promise.resolve((rows as Array<{ vacancyUrl: string }>).map(({ vacancyUrl }) => ({ vacancyUrl }))),
            }),
          };
        },
      }),
      delete: () => ({ where: deleteWhereMock.mockResolvedValue({ rowCount: 1 }) }),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  desc: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  gte: vi.fn(),
}));

vi.mock("../../lib/email", () => ({
  sendJobAlertEmail: sendJobAlertEmailMock,
}));

vi.mock("../../lib/sponsorVacancyRoles", async () => {
  const actual = await vi.importActual<typeof import("../../lib/sponsorVacancyRoles")>("../../lib/sponsorVacancyRoles");
  return {
    ...actual,
    SPONSOR_VACANCY_ID_OFFSET: 2_000_000,
    EMPLOYER_JOB_ID_OFFSET: 1_000_000,
    fetchSponsorVacanciesAsRoles: fetchSponsorVacanciesAsRolesMock,
  };
});

const { processUserAlert, runAlerts } = await import("../../lib/alertScheduler");

const LAST_ALERT_AT = new Date("2026-08-23T07:00:00.000Z");
const nurseProfile = {
  userId: "candidate-1",
  profession: "nurse",
  specialty: "cardiology",
  registrationStatus: "registered",
  licenceReady: false,
  requiresSponsorship: false,
  preferredRegion: null,
  dbsClearanceLevel: "none",
  safeguardingTrainingLevel: "none",
  alertFrequency: "daily",
} as any;

function sponsorVacancy(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id: 2_000_000 + id,
    title: `Senior Staff Nurse ${id}`,
    employer: "Example NHS Trust",
    location: "London",
    regulator: "NMC",
    opportunityCategory: "NMC",
    sourceType: "job_board",
    boardName: "NHS Jobs",
    sponsorshipOffered: true,
    requiredRegistration: "NMC registration pathway",
    requiredDbsClearanceLevel: null,
    requiredSafeguardingLevel: null,
    targetRegions: [],
    applyUrl: `https://www.jobs.nhs.uk/candidate/jobadvert/C9000-${id}`,
    linkVerified: true,
    contactEmail: null,
    contactPhone: null,
    contactWebsite: null,
    classifiedRelevant: true,
    sponsorVacancyId: id,
    ...overrides,
  };
}

/**
 * Queue the DB reads in the same order as processUserAlert:
 * decision, catalogue roles, employer jobs, candidate scores, sponsor scores,
 * favourites, bookmarks, applications, career profile, delivered URLs.
 */
function queueReads(opts: {
  sponsorRoles: any[];
  sponsorScores?: any[];
  delivered?: any[];
  roles?: any[];
  decision?: any[];
}) {
  selectResults.push(
    opts.decision ?? [{ outcome: "eligible" }],
    opts.roles ?? [],
    [],
    [],
    opts.sponsorScores ?? [],
    [],
    [],
    [],
    [],
    opts.delivered ?? [],
  );
}

describe("weekly candidate job alerts", () => {
  beforeEach(() => {
    selectResults.length = 0;
    insertValuesMock.mockClear();
    updateSetMock.mockClear();
    deleteWhereMock.mockClear();
    fetchSponsorVacanciesAsRolesMock.mockReset();
    sendJobAlertEmailMock.mockReset().mockResolvedValue({ success: true, messageId: "msg-1" });
  });

  it("sends at most the Opportunities top five in the same score order", async () => {
    const roles = Array.from({ length: 6 }, (_, index) => sponsorVacancy(index + 1));
    queueReads({
      sponsorRoles: roles,
      sponsorScores: roles.map((role, index) => ({
        vacancyId: index + 1,
        score: index === 4 ? 98 : 70 - index,
      })),
    });
    fetchSponsorVacanciesAsRolesMock.mockResolvedValue(roles);

    const result = await processUserAlert("candidate-1", "nurse@example.test", "Ada", nurseProfile, LAST_ALERT_AT);

    expect(result).toEqual({ sent: true, rolesIncluded: 5 });
    expect(fetchSponsorVacanciesAsRolesMock).toHaveBeenCalledWith("NMC");
    expect(sendJobAlertEmailMock).toHaveBeenCalledWith(
      "nurse@example.test",
      "Ada",
      expect.arrayContaining([expect.objectContaining({ title: "Senior Staff Nurse 5" })]),
      "weekly",
    );
    const emailedRoles = sendJobAlertEmailMock.mock.calls[0]?.[2] as Array<{ title: string }>;
    expect(emailedRoles).toHaveLength(5);
    expect(emailedRoles.map((role) => role.title)).toEqual([
      "Senior Staff Nurse 5",
      "Senior Staff Nurse 1",
      "Senior Staff Nurse 2",
      "Senior Staff Nurse 3",
      "Senior Staff Nurse 4",
    ]);
  });

  it("treats a legacy daily preference as weekly", async () => {
    const role = sponsorVacancy(1);
    queueReads({ sponsorRoles: [role] });
    fetchSponsorVacanciesAsRolesMock.mockResolvedValue([role]);

    await processUserAlert("candidate-1", "nurse@example.test", "Ada", nurseProfile, LAST_ALERT_AT);

    expect(sendJobAlertEmailMock.mock.calls[0]?.[3]).toBe("weekly");
  });

  it("honours the weekly checkpoint for legacy daily preferences", async () => {
    selectResults.push([{
      ...nurseProfile,
      lastAlertSentAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    }]);

    await runAlerts();

    expect(sendJobAlertEmailMock).not.toHaveBeenCalled();
  });

  it("does not move beyond the current top five after durable dedupe", async () => {
    const roles = Array.from({ length: 6 }, (_, index) => sponsorVacancy(index + 1));
    queueReads({
      sponsorRoles: roles,
      sponsorScores: roles.map((_, index) => ({ vacancyId: index + 1, score: 100 - index })),
      delivered: [{ vacancyUrl: roles[0].applyUrl }],
    });
    fetchSponsorVacanciesAsRolesMock.mockResolvedValue(roles);

    await processUserAlert("candidate-1", "nurse@example.test", "Ada", nurseProfile, LAST_ALERT_AT);

    const emailedRoles = sendJobAlertEmailMock.mock.calls[0]?.[2] as Array<{ title: string }>;
    expect(emailedRoles.map((role) => role.title)).toEqual([
      "Senior Staff Nurse 2",
      "Senior Staff Nurse 3",
      "Senior Staff Nurse 4",
      "Senior Staff Nurse 5",
    ]);
    expect(emailedRoles.map((role) => role.title)).not.toContain("Senior Staff Nurse 6");
  });

  it("skips an empty week without claiming a vacancy or sending filler", async () => {
    queueReads({ sponsorRoles: [] });
    fetchSponsorVacanciesAsRolesMock.mockResolvedValue([]);

    const result = await processUserAlert("candidate-1", "nurse@example.test", "Ada", nurseProfile, LAST_ALERT_AT);

    expect(result).toEqual({ sent: false, rolesIncluded: 0, reason: "no_top_matches" });
    expect(sendJobAlertEmailMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("restores the checkpoint and releases claims when Resend returns an error", async () => {
    const role = sponsorVacancy(1);
    queueReads({ sponsorRoles: [role] });
    fetchSponsorVacanciesAsRolesMock.mockResolvedValue([role]);
    sendJobAlertEmailMock.mockResolvedValueOnce({ success: false, error: "Resend rejected the message" });

    const result = await processUserAlert("candidate-1", "nurse@example.test", "Ada", nurseProfile, LAST_ALERT_AT);

    expect(result).toEqual({ sent: false, rolesIncluded: 0, reason: "provider_rejected" });
    expect(deleteWhereMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).toHaveBeenNthCalledWith(2, { lastAlertSentAt: LAST_ALERT_AT });
  });
});