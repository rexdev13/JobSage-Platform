import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectResults,
  selectMock,
  insertValuesMock,
  updateSetMock,
  deleteWhereMock,
  fetchSponsorVacanciesAsRolesMock,
  sendJobAlertEmailMock,
} = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  selectMock: vi.fn(),
  insertValuesMock: vi.fn(),
  updateSetMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  fetchSponsorVacanciesAsRolesMock: vi.fn(),
  sendJobAlertEmailMock: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  function chain(result: unknown[]) {
    const value: any = {
      from: () => value,
      where: () => value,
      orderBy: () => value,
      limit: () => value,
      then: (resolve: (result: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return value;
  }

  return {
    db: {
      select: (...args: unknown[]) => {
        selectMock(...args);
        return chain(selectResults.shift() ?? []);
      },
      update: () => ({
        set: (values: unknown) => {
          updateSetMock(values);
          const updateChain: any = {
            where: () => updateChain,
            returning: () => Promise.resolve([{ userId: "candidate-1" }]),
            then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
              Promise.resolve({ rowCount: 1 }).then(resolve, reject),
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
    profilesTable: { userId: "userId" },
    rolesTable: { active: "active", importedAt: "importedAt" },
    decisionRecordsTable: { userId: "userId", createdAt: "createdAt" },
    usersTable: {},
    jobAlertVacancyDeliveriesTable: { userId: "userId", vacancyUrl: "vacancyUrl" },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  desc: vi.fn(),
  and: vi.fn(),
  gt: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
}));

vi.mock("../../lib/email", () => ({
  sendJobAlertEmail: sendJobAlertEmailMock,
}));

vi.mock("../../lib/sponsorVacancyRoles", () => ({
  SPONSOR_VACANCY_ID_OFFSET: 2_000_000,
  fetchSponsorVacanciesAsRoles: fetchSponsorVacanciesAsRolesMock,
  roleDedupKey: (employer: string, title: string) => `${employer.trim().toLowerCase()}|${title.trim().toLowerCase()}`,
}));

const { processUserAlert } = await import("../../lib/alertScheduler");

const LAST_ALERT_AT = new Date("2026-08-23T07:00:00.000Z");
const NHS_URL = "https://www.jobs.nhs.uk/candidate/jobadvert/C9000-26-0001?language=en";

const nurseProfile = {
  userId: "candidate-1",
  profession: "nurse",
  registrationStatus: "registered",
  licenceReady: false,
  alertFrequency: "daily",
} as any;

function sponsorVacancy(overrides: Record<string, unknown> = {}) {
  return {
    id: 2_000_321,
    title: "Senior Staff Nurse",
    employer: "Example NHS Trust",
    location: "London",
    regulator: "NMC",
    sponsorshipOffered: true,
    requiredRegistration: "NMC registration pathway",
    active: true,
    importedAt: new Date("2026-08-24T06:30:00.000Z"),
    importedBy: "ai:sponsor-vacancy-pipeline",
    liveness: "live",
    lastVerifiedAt: new Date("2026-08-24T06:35:00.000Z"),
    livenessReason: null,
    applyUrl: NHS_URL,
    linkVerified: true,
    linkCheckedAt: "2026-08-24T06:35:00.000Z",
    contactEmail: null,
    contactPhone: null,
    contactWebsite: null,
    classifiedRelevant: true,
    description: null,
    ...overrides,
  };
}

describe("job alert sponsor vacancies", () => {
  beforeEach(() => {
    selectResults.length = 0;
    selectMock.mockClear();
    insertValuesMock.mockClear();
    updateSetMock.mockClear();
    deleteWhereMock.mockClear();
    fetchSponsorVacanciesAsRolesMock.mockReset();
    sendJobAlertEmailMock.mockReset();
    sendJobAlertEmailMock.mockResolvedValue(undefined);
  });

  it("alerts on a new NHS sponsor vacancy when the roles-only query returns no role", async () => {
    // Query order: latest decision, new roles (empty), prior delivery URLs (empty).
    selectResults.push([{ outcome: "eligible" }], [], []);
    fetchSponsorVacanciesAsRolesMock.mockResolvedValue([sponsorVacancy()]);

    await processUserAlert("candidate-1", "nurse@example.test", "Ada", nurseProfile, LAST_ALERT_AT);

    expect(fetchSponsorVacanciesAsRolesMock).toHaveBeenCalledWith("NMC", {
      since: LAST_ALERT_AT,
      requireSpecificVacancyUrl: true,
    });
    expect(sendJobAlertEmailMock).toHaveBeenCalledWith(
      "nurse@example.test",
      "Ada",
      [
        expect.objectContaining({
          title: "Senior Staff Nurse",
          employer: "Example NHS Trust",
          location: "London",
          sponsorshipOffered: true,
          isEligible: true,
          applyUrl: NHS_URL,
        }),
      ],
      [],
      "daily",
    );
    expect(insertValuesMock).toHaveBeenCalledWith([
      { userId: "candidate-1", vacancyId: 321, vacancyUrl: NHS_URL },
    ]);
  });

  it("does not send or claim a sponsor vacancy already delivered to this candidate", async () => {
    selectResults.push([{ outcome: "eligible" }], [], [{ vacancyUrl: NHS_URL }]);
    fetchSponsorVacanciesAsRolesMock.mockResolvedValue([sponsorVacancy()]);

    await processUserAlert("candidate-1", "nurse@example.test", "Ada", nurseProfile, LAST_ALERT_AT);

    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(sendJobAlertEmailMock).not.toHaveBeenCalled();
  });

  it("does not send an email-only sponsor record as a vacancy", async () => {
    selectResults.push([{ outcome: "eligible" }], []);
    fetchSponsorVacanciesAsRolesMock.mockResolvedValue([sponsorVacancy({ applyUrl: null, contactEmail: "hr@example.test" })]);

    await processUserAlert("candidate-1", "nurse@example.test", "Ada", nurseProfile, LAST_ALERT_AT);

    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(sendJobAlertEmailMock).not.toHaveBeenCalled();
  });

  it("does not send an unclassified healthcare vacancy across professions", async () => {
    selectResults.push([{ outcome: "eligible" }], []);
    fetchSponsorVacanciesAsRolesMock.mockResolvedValue([sponsorVacancy({ classifiedRelevant: false })]);

    await processUserAlert("candidate-1", "nurse@example.test", "Ada", nurseProfile, LAST_ALERT_AT);

    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(sendJobAlertEmailMock).not.toHaveBeenCalled();
  });

  it("restores the alert checkpoint and releases the URL claim when delivery fails", async () => {
    selectResults.push([{ outcome: "eligible" }], [], []);
    fetchSponsorVacanciesAsRolesMock.mockResolvedValue([sponsorVacancy()]);
    sendJobAlertEmailMock.mockRejectedValueOnce(new Error("Resend unavailable"));

    await expect(
      processUserAlert("candidate-1", "nurse@example.test", "Ada", nurseProfile, LAST_ALERT_AT),
    ).rejects.toThrow("Resend unavailable");

    expect(deleteWhereMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).toHaveBeenNthCalledWith(1, {
      lastAlertSentAt: expect.any(Date),
    });
    expect(updateSetMock).toHaveBeenNthCalledWith(2, {
      lastAlertSentAt: LAST_ALERT_AT,
    });
  });

  it("deduplicates identical vacancy URLs within one alert payload", async () => {
    selectResults.push([{ outcome: "eligible" }], [], []);
    fetchSponsorVacanciesAsRolesMock.mockResolvedValue([
      sponsorVacancy(),
      sponsorVacancy({ id: 2_000_322, title: "Senior Staff Nurse (duplicate snapshot)" }),
    ]);

    await processUserAlert("candidate-1", "nurse@example.test", "Ada", nurseProfile, LAST_ALERT_AT);

    expect(insertValuesMock).toHaveBeenCalledWith([
      { userId: "candidate-1", vacancyId: 321, vacancyUrl: NHS_URL },
    ]);
    expect(sendJobAlertEmailMock).toHaveBeenCalledTimes(1);
    expect(sendJobAlertEmailMock.mock.calls[0]?.[2]).toHaveLength(1);
  });
});