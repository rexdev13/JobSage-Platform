import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

// ── hoisted DB results queue ──────────────────────────────────────────────────
const { dbResults } = vi.hoisted(() => ({ dbResults: [] as any[] }));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from() { return chain; },
      innerJoin() { return chain; },
      leftJoin() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      values() { return chain; },
      set() { return chain; },
      onConflictDoNothing() { return chain; },
      delete() { return chain; },
      then(resolve: any, reject?: any) {
        return Promise.resolve(dbResults.shift() ?? []).then(resolve, reject);
      },
      catch(fn: any) { return chain; },
      returning() { return Promise.resolve(dbResults.shift() ?? []); },
    };
    return chain;
  }
  return {
    db: {
      select: () => makeChain(),
      insert: () => makeChain(),
      update: () => makeChain(),
      delete: () => makeChain(),
      execute: () => Promise.resolve({ rows: [] }),
    },
    rolesTable: {},
    profilesTable: {},
    decisionRecordsTable: {},
    rulesetRulesTable: {},
    applicationsTable: {},
    speculativeApplicationsTable: {},
    jobListingsTable: {},
    employerProfilesTable: {},
    candidateMatchScoresTable: {},
    matchDismissalsTable: {},
    vacancyFavoritesTable: {},
    sponsorLicenceBookmarksTable: {},
    careerProfilesTable: {},
    auditEventsTable: {},
    sponsorLicenceVacanciesTable: {},
    sponsorLicencesTable: {},
    sponsorLicenceVacancyScoresTable: {},
  };
});

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    getSession: vi.fn().mockResolvedValue({
      user: { id: "admin-1", email: "admin@test.com", role: "admin", firstName: null, lastName: null, profileImageUrl: null },
    }),
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
    createSession: vi.fn().mockResolvedValue("sess"),
  };
});

vi.mock("../../middlewares/consentMiddleware", () => ({
  requireConsent: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../../lib/candidateAiMatch", () => ({
  batchScoreRoles: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("../../lib/sponsorshipFeasibility", () => ({
  assessSponsorshipFeasibility: vi.fn().mockReturnValue(null),
}));

const rolesRouter = (await import("../../routes/roles")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(rolesRouter);
  return app;
}

const AUTH = "Bearer admin-session";

// ── Helper: create a multipart CSV upload request ────────────────────────────
async function importCSV(app: express.Express, csvContent: string) {
  const boundary = "----TestBoundary";
  const body =
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="roles.csv"\r\nContent-Type: text/csv\r\n\r\n` +
    csvContent +
    `\r\n--${boundary}--\r\n`;
  return request(app)
    .post("/admin/roles/import")
    .set("Authorization", AUTH)
    .set("Content-Type", `multipart/form-data; boundary=${boundary}`)
    .send(Buffer.from(body));
}

describe("Admin roles CSV import — applyUrl column", () => {
  beforeEach(() => { dbResults.length = 0; });

  it("imports CSV without applyUrl column (backward compatibility)", async () => {
    const csv = [
      "title,employer,location,regulator,sponsorshipOffered,requiredRegistration",
      "Staff Nurse,NHS Trust,London,NMC,true,Full NMC Registration",
    ].join("\n");

    // DB: insert returns [] success, audit insert returns []
    dbResults.push([]); // insert roles
    dbResults.push([]); // audit insert

    const app = buildApp();
    const res = await importCSV(app, csv);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(0);
  });

  it("imports CSV with valid applyUrl column", async () => {
    const csv = [
      "title,employer,location,regulator,sponsorshipOffered,requiredRegistration,applyUrl",
      "Consultant Cardiologist,NHS Trust,London,GMC,true,Full GMC Registration,https://jobs.nhs.uk/vacancy/123",
    ].join("\n");

    dbResults.push([]); // insert roles
    dbResults.push([]); // audit insert

    const app = buildApp();
    const res = await importCSV(app, csv);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(0);
  });

  it("rejects rows with invalid applyUrl (non-http/https)", async () => {
    const csv = [
      "title,employer,location,regulator,sponsorshipOffered,requiredRegistration,applyUrl",
      "Staff Nurse,NHS Trust,London,NMC,true,Full NMC Registration,ftp://invalid.com/jobs",
    ].join("\n");

    const app = buildApp();
    const res = await importCSV(app, csv);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.skipped).toBe(1);
    expect(res.body.errors[0].message).toMatch(/valid http/i);
  });

  it("accepts empty applyUrl column (treated as null)", async () => {
    const csv = [
      "title,employer,location,regulator,sponsorshipOffered,requiredRegistration,applyUrl",
      "Physiotherapist,NHS Trust,Leeds,HCPC,false,Full HCPC Registration,",
    ].join("\n");

    dbResults.push([]); // insert roles
    dbResults.push([]); // audit insert

    const app = buildApp();
    const res = await importCSV(app, csv);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(0);
  });

  it("rejects CSV missing required columns", async () => {
    const csv = [
      "title,employer,location",
      "Staff Nurse,NHS Trust,London",
    ].join("\n");

    const app = buildApp();
    const res = await importCSV(app, csv);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing required columns/i);
  });
});

describe("GET /roles — vacancy-specific speculative CV matching (appliedRoleIds)", () => {
  beforeEach(() => { dbResults.length = 0; });

  /**
   * Push the standard sequence of DB results needed by GET /roles.
   * Order mirrors the query order in roles.ts:
   *   1. profilesTable
   *   2. decisionRecordsTable  (empty → no eligibleRuleId sub-query)
   *   3. rolesTable            (all active roles)
   *   4. jobListingsTable      (published employer jobs — empty)
   *   5. sponsorLicenceVacanciesTable ⋈ sponsorLicencesTable (discovered vacancies)
   *   6. Promise.all[0] applicationsTable
   *   7. Promise.all[1] speculativeApplicationsTable
   *   8. Promise.all[2] candidateMatchScoresTable
   *   9. Promise.all[3] sponsorLicenceVacancyScoresTable
   */
  function pushRolesDbResults(
    roles: any[],
    specApps: any[],
    opts: { applications?: any[]; sponsorVacancies?: any[]; sponsorScores?: any[]; specialty?: string } = {},
  ) {
    dbResults.push([{
      userId: "admin-1",
      profession: "doctor",
      specialty: opts.specialty ?? "cardiology",
      registrationStatus: "full_registration",
      licenceReady: null,
      requiresSponsorship: false,
      preferredRegion: null,
    }]);
    dbResults.push([]);      // decisionRecordsTable — no decision
    dbResults.push(roles);   // rolesTable
    dbResults.push([]);      // jobListingsTable — no employer jobs
    dbResults.push(opts.sponsorVacancies ?? []); // sponsor vacancies join
    dbResults.push(opts.applications ?? []); // applicationsTable
    dbResults.push(specApps); // speculativeApplicationsTable
    dbResults.push([]);      // candidateMatchScoresTable
    dbResults.push(opts.sponsorScores ?? []);    // sponsorLicenceVacancyScoresTable
  }

  function makeRole(id: number, employer: string, title: string) {
    return {
      id,
      title,
      employer,
      location: "London",
      regulator: "GMC",
      sponsorshipOffered: true,
      requiredRegistration: "Full GMC Registration",
      active: true,
      importedAt: new Date(),
      importedBy: "admin",
      applyUrl: "https://jobs.nhs.uk/vacancy/" + id,
      liveness: "live",
      lastVerifiedAt: null,
      livenessReason: null,
      contactEmail: null,
      contactPhone: null,
      contactWebsite: null,
    };
  }

  it("happy path: exact-match company + title → roleId appears in appliedRoleIds", async () => {
    const role = makeRole(42, "NHS Trust", "Consultant Cardiologist");
    const specApp = { companyName: "NHS Trust", vacancyTitle: "Consultant Cardiologist" };

    pushRolesDbResults([role], [specApp]);

    const app = buildApp();
    const res = await request(app).get("/roles").set("Authorization", AUTH);
    expect(res.status).toBe(200);
    expect(res.body.appliedRoleIds).toContain(42);
  });

  it("normalises casing: UPPER company + lower title still matches the role", async () => {
    const role = makeRole(99, "City Hospital", "Senior Registrar");
    // Speculative app stored with different casing than the role catalogue
    const specApp = { companyName: "CITY HOSPITAL", vacancyTitle: "senior registrar" };

    pushRolesDbResults([role], [specApp]);

    const app = buildApp();
    const res = await request(app).get("/roles").set("Authorization", AUTH);
    expect(res.status).toBe(200);
    expect(res.body.appliedRoleIds).toContain(99);
  });

  it("normalises whitespace: leading/trailing spaces around company + title still match", async () => {
    const role = makeRole(77, "Royal Infirmary", "Staff Grade Doctor");
    const specApp = { companyName: "  Royal Infirmary  ", vacancyTitle: "  Staff Grade Doctor  " };

    pushRolesDbResults([role], [specApp]);

    const app = buildApp();
    const res = await request(app).get("/roles").set("Authorization", AUTH);
    expect(res.status).toBe(200);
    expect(res.body.appliedRoleIds).toContain(77);
  });

  it("excludes completed application statuses but leaves a bare outbound click eligible", async () => {
    const interviewRole = makeRole(201, "North Trust", "Consultant");
    const offerRole = makeRole(202, "South Trust", "Registrar");
    const clickOnlyRole = makeRole(203, "East Trust", "Clinical Fellow");

    pushRolesDbResults([interviewRole, offerRole, clickOnlyRole], [], {
      applications: [
        { roleId: 201, status: "interview" },
        { roleId: 202, status: "offer" },
        { roleId: 203, status: "link_clicked" },
      ],
    });

    const app = buildApp();
    const res = await request(app).get("/roles").set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.appliedRoleIds).toEqual(expect.arrayContaining([201, 202]));
    expect(res.body.appliedRoleIds).not.toContain(203);
  });

  it("does not include roleId when company name mismatches", async () => {
    const role = makeRole(7, "Royal Infirmary", "Registrar");
    const specApp = { companyName: "Different Hospital", vacancyTitle: "Registrar" };

    pushRolesDbResults([role], [specApp]);

    const app = buildApp();
    const res = await request(app).get("/roles").set("Authorization", AUTH);
    expect(res.status).toBe(200);
    expect(res.body.appliedRoleIds).not.toContain(7);
  });

  it("does not include roleId when vacancy title mismatches", async () => {
    const role = makeRole(8, "City Trust", "Senior Consultant");
    const specApp = { companyName: "City Trust", vacancyTitle: "Junior Doctor" };

    pushRolesDbResults([role], [specApp]);

    const app = buildApp();
    const res = await request(app).get("/roles").set("Authorization", AUTH);
    expect(res.status).toBe(200);
    expect(res.body.appliedRoleIds).not.toContain(8);
  });

  it("ignores speculative apps with blank-only vacancyTitle", async () => {
    const role = makeRole(5, "City Trust", "Registrar");
    const specApp = { companyName: "City Trust", vacancyTitle: "   " };

    pushRolesDbResults([role], [specApp]);

    const app = buildApp();
    const res = await request(app).get("/roles").set("Authorization", AUTH);
    expect(res.status).toBe(200);
    expect(res.body.appliedRoleIds).not.toContain(5);
  });

  it("merges speculative appliedRoleIds with formal application roleIds", async () => {
    const role = makeRole(42, "NHS Trust", "Consultant Cardiologist");
    const specApp = { companyName: "NHS Trust", vacancyTitle: "Consultant Cardiologist" };

    dbResults.push([{
      userId: "admin-1",
      profession: "doctor",
      specialty: "cardiology",
      registrationStatus: "full_registration",
      licenceReady: null,
      requiresSponsorship: false,
      preferredRegion: null,
    }]);
    dbResults.push([]);      // decisionRecordsTable
    dbResults.push([role]);  // rolesTable
    dbResults.push([]);      // jobListingsTable
    dbResults.push([]);      // sponsor vacancies join
    dbResults.push([{ roleId: 10 }]); // applicationsTable — a formal application to role 10
    dbResults.push([specApp]);        // speculativeApplicationsTable
    dbResults.push([]);               // candidateMatchScoresTable
    dbResults.push([]);               // sponsorLicenceVacancyScoresTable

    const app = buildApp();
    const res = await request(app).get("/roles").set("Authorization", AUTH);
    expect(res.status).toBe(200);
    expect(res.body.appliedRoleIds).toContain(10);  // formal application
    expect(res.body.appliedRoleIds).toContain(42);  // speculative vacancy match
  });
});

describe("GET /roles — AI-discovered sponsor vacancy merging", () => {
  beforeEach(() => { dbResults.length = 0; });

  function makeSponsorVacancyRow(id: number, org: string, title: string, extra: Record<string, any> = {}) {
    return {
      vac: {
        id,
        organisationName: org,
        checkDate: "2026-07-29",
        title,
        location: "Manchester",
        salary: null,
        url: `https://employer.example/vacancy/${id}`,
        description: null,
        postedDate: null,
        createdAt: new Date(),
        liveness: "live",
        lastVerifiedAt: new Date(),
        livenessReason: null,
        ...extra,
      },
      lic: { contactEmail: "hr@org.example", contactPhone: null, website: "https://org.example", industry: "Hospital activities" },
    };
  }

  function makeRole(id: number, employer: string, title: string) {
    return {
      id, title, employer, location: "London", regulator: "GMC",
      sponsorshipOffered: true, requiredRegistration: "Full GMC Registration",
      active: true, importedAt: new Date(), importedBy: "admin",
      applyUrl: "https://jobs.nhs.uk/vacancy/" + id, liveness: "live",
      lastVerifiedAt: null, livenessReason: null,
      contactEmail: null, contactPhone: null, contactWebsite: null,
    };
  }

  function pushDb(roles: any[], sponsorVacancies: any[], sponsorScores: any[]) {
    dbResults.push([{
      userId: "admin-1", profession: "doctor", specialty: "cardiology",
      registrationStatus: "full_registration", licenceReady: null,
      requiresSponsorship: false, preferredRegion: null,
    }]);
    dbResults.push([]);               // decision
    dbResults.push(roles);            // rolesTable
    dbResults.push([]);               // jobListingsTable
    dbResults.push(sponsorVacancies); // sponsor vacancies join
    dbResults.push([]);               // applicationsTable
    dbResults.push([]);               // speculativeApplicationsTable
    dbResults.push([]);               // candidateMatchScoresTable
    dbResults.push(sponsorScores);    // sponsorLicenceVacancyScoresTable
  }

  it("merges discovered sponsor vacancies with offset ids and pipeline fit scores", async () => {
    const sv = makeSponsorVacancyRow(7, "Northern Care Trust", "Consultant Cardiologist");
    pushDb([], [sv], [{ vacancyId: 7, score: 88, explanation: "Strong cardiology match" }]);

    const app = buildApp();
    const res = await request(app).get("/roles").set("Authorization", AUTH);
    expect(res.status).toBe(200);
    const merged = res.body.roles.find((r: any) => r.role.id === 2_000_007);
    expect(merged).toBeTruthy();
    expect(merged.role.employer).toBe("Northern Care Trust");
    expect(merged.aiScore).toBe(88);
    expect(merged.aiExplanation).toBe("Strong cardiology match");
    expect(merged.applyUrl).toBe("https://employer.example/vacancy/7");
    expect(merged.linkVerified).toBe(true);
    expect(merged.contactEmail).toBe("hr@org.example");
    expect(merged.contactWebsite).toBe("https://org.example");
  });

  it("appears without a pipeline score yet (score-pending) with null aiScore", async () => {
    const sv = makeSponsorVacancyRow(9, "City Hospital", "Staff Physician");
    pushDb([], [sv], []);

    const app = buildApp();
    const res = await request(app).get("/roles").set("Authorization", AUTH);
    expect(res.status).toBe(200);
    const merged = res.body.roles.find((r: any) => r.role.id === 2_000_009);
    expect(merged).toBeTruthy();
    expect(merged.aiScore).toBeNull();
    expect(typeof merged.matchScore).toBe("number");
  });

  it("dedupes: sponsor vacancy with same employer+title as a CSV role is dropped", async () => {
    const role = makeRole(3, "NHS Trust", "Consultant Cardiologist");
    const sv = makeSponsorVacancyRow(11, "nhs trust", "consultant cardiologist");
    pushDb([role], [sv], []);

    const app = buildApp();
    const res = await request(app).get("/roles").set("Authorization", AUTH);
    expect(res.status).toBe(200);
    const ids = res.body.roles.map((r: any) => r.role.id);
    expect(ids).toContain(3);
    expect(ids).not.toContain(2_000_011);
  });

  it("bottom-ranks unclassified vacancies below regulator-relevant ones", async () => {
    const relevant = makeSponsorVacancyRow(1, "Trust A", "Consultant Cardiologist");
    const unclassified = makeSponsorVacancyRow(2, "Trust B", "Team Lead");
    pushDb([], [relevant, unclassified], []);

    const app = buildApp();
    const res = await request(app).get("/roles").set("Authorization", AUTH);
    expect(res.status).toBe(200);
    const ids = res.body.roles.map((r: any) => r.role.id);
    expect(ids.indexOf(2_000_001)).toBeLessThan(ids.indexOf(2_000_002));
    const unclassifiedItem = res.body.roles.find((r: any) => r.role.id === 2_000_002);
    expect(unclassifiedItem.matchScore).toBeLessThanOrEqual(25);
  });

  it("excludes vacancies classified to a different regulator and manual-labour titles", async () => {
    const nmc = makeSponsorVacancyRow(21, "Trust C", "Staff Nurse");
    const cleaner = makeSponsorVacancyRow(22, "Trust D", "Hospital Cleaner");
    pushDb([], [nmc, cleaner], []);

    const app = buildApp();
    const res = await request(app).get("/roles").set("Authorization", AUTH);
    expect(res.status).toBe(200);
    const ids = res.body.roles.map((r: any) => r.role.id);
    expect(ids).not.toContain(2_000_021);
    expect(ids).not.toContain(2_000_022);
  });

  it("returns an empty list when no roles and no discovered vacancies exist", async () => {
    pushDb([], [], []);

    const app = buildApp();
    const res = await request(app).get("/roles").set("Authorization", AUTH);
    expect(res.status).toBe(200);
    expect(res.body.roles).toEqual([]);
  });
});

describe("GET /roles/my-matches — incremental scoring with sponsor vacancies", () => {
  beforeEach(() => { dbResults.length = 0; vi.clearAllMocks(); });

  /**
   * Query order for /roles/my-matches:
   *   1-2. Promise.all: profilesTable, careerProfilesTable
   *   3.   decisionRecordsTable
   *   4.   rolesTable
   *   5.   jobListingsTable
   *   6.   sponsor vacancies join
   *   7-11. Promise.all: applications, cached scores, sponsor scores, favourites, sponsor bookmarks
   *   12.  matchDismissalsTable
   */
  function pushMyMatchesDb(
    roles: any[],
    sponsorVacancies: any[],
    cachedScores: any[],
    sponsorScores: any[],
    completedApplications: any[] = [],
    favourites: any[] = [],
    sponsorBookmarks: any[] = [],
    dismissals: any[] = [],
  ) {
    dbResults.push([{
      userId: "admin-1", profession: "doctor", specialty: "cardiology",
      experienceYears: 5, qualificationCountry: "India",
      registrationStatus: "full_registration", licenceReady: null,
      requiresSponsorship: false, preferredRegion: null,
    }]);
    dbResults.push([]);               // careerProfilesTable
    dbResults.push([]);               // decisionRecordsTable
    dbResults.push(roles);            // rolesTable
    dbResults.push([]);               // jobListingsTable
    dbResults.push(sponsorVacancies); // sponsor vacancies join
    dbResults.push(completedApplications); // applicationsTable
    dbResults.push(cachedScores);     // candidateMatchScoresTable
    dbResults.push(sponsorScores);    // sponsorLicenceVacancyScoresTable
    dbResults.push(favourites);       // vacancyFavoritesTable
    dbResults.push(sponsorBookmarks); // sponsor licence bookmarks join
    dbResults.push(dismissals);       // matchDismissalsTable
  }

  function makeRole(id: number) {
    return {
      id, title: "Consultant Cardiologist", employer: "NHS Trust", location: "London",
      regulator: "GMC", sponsorshipOffered: true, requiredRegistration: "Full GMC Registration",
      active: true, importedAt: new Date(), importedBy: "admin",
      applyUrl: "https://jobs.nhs.uk/vacancy/" + id, liveness: "live",
      lastVerifiedAt: null, livenessReason: null,
      contactEmail: null, contactPhone: null, contactWebsite: null,
    };
  }

  function makeSponsorVacancyRow(id: number, title: string) {
    return {
      vac: {
        id, organisationName: "Care Group", checkDate: "2026-07-29", title,
        location: "Leeds", salary: null, url: `https://employer.example/v/${id}`,
        description: null, postedDate: null, createdAt: new Date(),
        liveness: "live", lastVerifiedAt: new Date(), livenessReason: null,
      },
      lic: { contactEmail: null, contactPhone: null, website: "https://care.example", industry: "Human health activities" },
    };
  }

  it("a new sponsor vacancy does NOT trigger a full AI re-score when curated roles are covered", async () => {
    const { batchScoreRoles } = await import("../../lib/candidateAiMatch");
    const role = makeRole(1);
    const newVacancy = makeSponsorVacancyRow(50, "Consultant Physician");
    // Curated role 1 has a fresh cached score; the sponsor vacancy has none.
    pushMyMatchesDb([role], [newVacancy], [{ roleId: 1, score: 70, aiExplanation: "Good fit", scoredAt: new Date() }], []);

    const app = buildApp();
    const res = await request(app).get("/roles/my-matches").set("Authorization", AUTH);
    expect(res.status).toBe(200);
    expect(batchScoreRoles).not.toHaveBeenCalled();
    expect(res.body.cached).toBe(true);
    const ids = res.body.matches.map((m: any) => m.roleId);
    expect(ids).toContain(1);
    expect(ids).toContain(2_000_050);
  });

  it("uses the pre-computed pipeline score for sponsor vacancies", async () => {
    const vac = makeSponsorVacancyRow(60, "Consultant Cardiologist");
    pushMyMatchesDb([], [vac], [], [{ vacancyId: 60, score: 91, explanation: "Excellent specialty fit" }]);

    const app = buildApp();
    const res = await request(app).get("/roles/my-matches").set("Authorization", AUTH);
    expect(res.status).toBe(200);
    const m = res.body.matches.find((x: any) => x.roleId === 2_000_060);
    expect(m).toBeTruthy();
    // 91 + specialty boost (title contains "cardiologist"? boost applies on focus words) — at least the base score
    expect(m.aiScore).toBeGreaterThanOrEqual(91);
    expect(m.aiExplanation).toContain("Excellent specialty fit");
  });

  it("removes completed roles from matches while retaining link-clicked roles", async () => {
    const interviewRole = makeRole(71);
    const offerRole = makeRole(72);
    const clickOnlyRole = makeRole(73);
    pushMyMatchesDb(
      [interviewRole, offerRole, clickOnlyRole],
      [],
      [
        { roleId: 71, score: 90, aiExplanation: "Strong fit", scoredAt: new Date() },
        { roleId: 72, score: 85, aiExplanation: "Strong fit", scoredAt: new Date() },
        { roleId: 73, score: 80, aiExplanation: "Strong fit", scoredAt: new Date() },
      ],
      [],
      [
        { roleId: 71, status: "interview" },
        { roleId: 72, status: "offer" },
        { roleId: 73, status: "link_clicked" },
      ],
    );

    const app = buildApp();
    const res = await request(app).get("/roles/my-matches").set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.matches.map((match: any) => match.roleId)).toEqual([73]);
  });

  it("boosts favourites with an explainable reason and excludes dismissed roles", async () => {
    const lowerScoreFavourite = makeRole(74);
    const dismissedRole = makeRole(75);
    pushMyMatchesDb(
      [dismissedRole, lowerScoreFavourite],
      [],
      [
        { roleId: 75, score: 90, aiExplanation: "Strong fit", scoredAt: new Date() },
        { roleId: 74, score: 75, aiExplanation: "Good fit", scoredAt: new Date() },
      ],
      [],
      [],
      [{ vacancyId: 74 }],
      [],
      [{ roleId: 75 }],
    );

    const app = buildApp();
    const res = await request(app).get("/roles/my-matches").set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.matches).toHaveLength(1);
    expect(res.body.matches[0]).toMatchObject({
      roleId: 74,
      matchReason: "You favourited this opportunity",
    });
    expect(res.body.matches[0].aiScore).toBeGreaterThan(75);
  });

  it("paginates the merged list", async () => {
    const vacs = Array.from({ length: 5 }, (_, i) => makeSponsorVacancyRow(100 + i, "Consultant Physician " + i));
    pushMyMatchesDb([], vacs, [], []);

    const app = buildApp();
    const res = await request(app).get("/roles/my-matches?limit=2&offset=0").set("Authorization", AUTH);
    expect(res.status).toBe(200);
    expect(res.body.matches.length).toBe(2);
    expect(res.body.totalCount).toBe(5);
  });
});

describe("GET /opportunities/recommended — behavioural ranking", () => {
  beforeEach(() => { dbResults.length = 0; vi.clearAllMocks(); });

  it("excludes dismissals and boosts a favourite without replacing its cached score", async () => {
    const dismissed = {
      id: 80, title: "Consultant Cardiologist", employer: "NHS Trust", location: "London",
      regulator: "GMC", sponsorshipOffered: true, requiredRegistration: "Full GMC Registration",
      active: true, importedAt: new Date(), importedBy: "admin",
      applyUrl: "https://jobs.nhs.uk/vacancy/80", liveness: "live",
      lastVerifiedAt: null, livenessReason: null,
      contactEmail: null, contactPhone: null, contactWebsite: null,
    };
    const favourite = { ...dismissed, id: 81, title: "Cardiology Specialty Doctor" };
    dbResults.push([{
      userId: "admin-1", profession: "doctor", specialty: "cardiology",
      registrationStatus: "full_registration", licenceReady: null,
      requiresSponsorship: false, preferredRegion: null,
    }]);
    dbResults.push([]); // career profile
    dbResults.push([{ outcome: "eligible" }]); // decision
    dbResults.push([dismissed, favourite]); // roles
    dbResults.push([]); // employer jobs
    dbResults.push([]); // applications
    dbResults.push([]); // speculative applications
    dbResults.push([{ vacancyId: 81 }]); // favourites
    dbResults.push([]); // sponsor bookmarks
    dbResults.push([{ roleId: 80 }]); // dismissals
    dbResults.push([{ roleId: 81, score: 70, scoredAt: new Date() }]); // cached scores

    const app = buildApp();
    const res = await request(app).get("/opportunities/recommended").set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.roles).toHaveLength(1);
    expect(res.body.roles[0]).toMatchObject({
      id: 81,
      matchReason: "You favourited this opportunity",
    });
    expect(res.body.roles[0].matchScore).toBeGreaterThan(70);
  });

  it("uses a completed application's regulator as a similarity signal for future roles", async () => {
    const completedRole = {
      id: 82, title: "Medical Administrator", employer: "West Trust", location: "London",
      regulator: "GMC", sponsorshipOffered: false, requiredRegistration: "Full GMC Registration",
      active: true, importedAt: new Date(), importedBy: "admin",
      applyUrl: "https://jobs.nhs.uk/vacancy/82", liveness: "live",
      lastVerifiedAt: null, livenessReason: null,
      contactEmail: null, contactPhone: null, contactWebsite: null,
    };
    const futureRole = { ...completedRole, id: 83, title: "Paediatrician", employer: "East Trust" };
    dbResults.push([{
      userId: "admin-1", profession: "doctor", specialty: null,
      registrationStatus: "full_registration", licenceReady: null,
      requiresSponsorship: false, preferredRegion: null,
    }]);
    dbResults.push([]); // career profile
    dbResults.push([{ outcome: "eligible" }]); // decision
    dbResults.push([completedRole, futureRole]); // roles
    dbResults.push([]); // employer jobs
    dbResults.push([{
      roleId: 82,
      status: "applied",
      jobTitle: null,
      companyName: null,
      appliedAt: new Date(),
    }]);
    dbResults.push([]); // speculative applications
    dbResults.push([]); // favourites
    dbResults.push([]); // sponsor bookmarks
    dbResults.push([]); // dismissals
    dbResults.push([{ roleId: 83, score: 70, scoredAt: new Date() }]); // cached scores

    const app = buildApp();
    const res = await request(app).get("/opportunities/recommended").set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.roles).toHaveLength(1);
    expect(res.body.roles[0]).toMatchObject({
      id: 83,
      matchScore: 73,
      matchReason: "Similar to roles in your profession",
    });
  });
});

describe("applyUrl URL validation pattern", () => {
  const APPLY_URL_PATTERN = /^https?:\/\/.+/i;

  it("accepts http URLs", () => {
    expect(APPLY_URL_PATTERN.test("http://example.com/jobs")).toBe(true);
  });

  it("accepts https URLs", () => {
    expect(APPLY_URL_PATTERN.test("https://jobs.nhs.uk/vacancy/123")).toBe(true);
  });

  it("rejects ftp URLs", () => {
    expect(APPLY_URL_PATTERN.test("ftp://example.com/jobs")).toBe(false);
  });

  it("rejects plain text", () => {
    expect(APPLY_URL_PATTERN.test("not a url")).toBe(false);
  });

  it("rejects javascript: protocol", () => {
    expect(APPLY_URL_PATTERN.test("javascript:alert(1)")).toBe(false);
  });

  it("accepts https URL with path and query params", () => {
    expect(APPLY_URL_PATTERN.test("https://jobs.nhs.uk/vacancy?id=123&ref=abc")).toBe(true);
  });
});
