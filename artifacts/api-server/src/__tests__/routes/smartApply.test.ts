import { beforeEach, describe, expect, it, vi } from "vitest";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";

const { queryResults, storage, createCompletion, ensureCanonicalJobsageAlias } = vi.hoisted(() => ({
  queryResults: [] as any[],
  storage: {
    getObjectEntityFile: vi.fn(),
    canAccessObjectEntity: vi.fn(),
    downloadObject: vi.fn(),
  },
  createCompletion: vi.fn(),
  ensureCanonicalJobsageAlias: vi.fn().mockResolvedValue("jane.doe.abc123@mail.jobsage.co.uk"),
}));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      then: (resolve: (value: any[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(queryResults.shift() ?? []).then(resolve, reject),
    };
    return chain;
  }

  return {
    db: { select: () => makeChain() },
    profilesTable: {},
    jobListingsTable: {},
    smartApplyDraftsTable: {},
    documentsTable: {},
    sponsorLicenceVacanciesTable: {},
    sponsorLicencesTable: {},
  };
});

vi.mock("../../lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {}
  class ObjectStorageService {
    getObjectEntityFile = storage.getObjectEntityFile;
    canAccessObjectEntity = storage.canAccessObjectEntity;
    downloadObject = storage.downloadObject;
  }
  return { ObjectStorageService, ObjectNotFoundError };
});

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: createCompletion,
      },
    },
  },
}));

vi.mock("../../lib/jobsageEmailGen", () => ({
  ensureCanonicalJobsageAlias,
}));

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    getSession: vi.fn().mockResolvedValue({
      user: {
        id: "candidate-1",
        email: "jane@example.com",
        role: "candidate",
        firstName: "Jane",
        lastName: "Doe",
        profileImageUrl: null,
      },
    }),
  };
});

const smartApplyRouter = (await import("../../routes/smartApply")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(authMiddleware);
  app.use(smartApplyRouter);
  return app;
}

const AUTH_HEADER = "Bearer candidate-session";
const cv = {
  id: 7,
  userId: "candidate-1",
  filename: "Jane Doe CV.pdf",
  mimeType: "application/pdf",
  storageKey: "/objects/uploads/private-cv-key",
  documentType: "cv",
  isPrimary: true,
  uploadedAt: new Date("2025-01-01"),
};

describe("Smart Apply extension endpoints", () => {
  beforeEach(() => {
    queryResults.length = 0;
    vi.clearAllMocks();
    createCompletion.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ values: [] }) } }],
    });
  });

  it("requires authentication for the safe candidate prefill", async () => {
    const response = await request(buildApp()).get("/smart-apply/candidate-prefill");
    expect(response.status).toBe(401);
  });

  it("explains why it refuses to generate sensitive personal confirmations", async () => {
    const response = await request(buildApp())
      .post("/smart-apply/assistant")
      .set("Authorization", AUTH_HEADER)
      .send({
        message: "Have you ever had a criminal conviction?",
        questionText: "Have you ever had a criminal conviction?",
      });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: "JOBSAGE can't generate an answer because this question asks you to confirm sensitive or personal information. Please review it and answer it yourself.",
    });
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it("returns only the candidate prefill allowlist", async () => {
    const response = await request(buildApp())
      .get("/smart-apply/candidate-prefill")
      .set("Authorization", AUTH_HEADER);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      firstName: "Jane",
      lastName: "Doe",
      fullName: "Jane Doe",
      email: "jane.doe.abc123@mail.jobsage.co.uk",
      phone: null,
      streetAddress: null,
      city: null,
      postcode: null,
      country: "United Kingdom",
      profession: null,
      specialty: null,
      qualificationCountry: null,
      qualificationType: null,
      qualificationYear: null,
      experienceYears: null,
      registrationStatus: null,
      residencyStatus: null,
      preferredStartDate: null,
      languages: null,
    });
    expect(response.body).not.toHaveProperty("passwordHash");
  });

  it("uses the JOBSAGE alias without exposing the signed-in email", async () => {
    queryResults.push([{
      phone: "+44 7700 900123",
      streetAddress: "10 Example Road",
      city: "Leeds",
      postcode: "LS1 1AA",
      country: "United Kingdom",
    }]);

    const response = await request(buildApp())
      .get("/smart-apply/candidate-prefill")
      .set("Authorization", AUTH_HEADER);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      email: "jane.doe.abc123@mail.jobsage.co.uk",
      phone: "+44 7700 900123",
      streetAddress: "10 Example Road",
      city: "Leeds",
      postcode: "LS1 1AA",
      country: "United Kingdom",
    });
    expect(JSON.stringify(response.body)).not.toContain("jane@example.com");
    expect(ensureCanonicalJobsageAlias).toHaveBeenCalledWith("candidate-1", "Jane", "Doe");
  });

  it("returns 404 when the candidate has no CV", async () => {
    queryResults.push([]);
    const response = await request(buildApp())
      .get("/smart-apply/cv")
      .set("Authorization", AUTH_HEADER);

    expect(response.status).toBe(404);
    expect(storage.getObjectEntityFile).not.toHaveBeenCalled();
  });

  it("downloads the selected CV after ownership and object ACL checks", async () => {
    queryResults.push([cv]);
    storage.getObjectEntityFile.mockResolvedValue({ name: "hidden-storage-key" });
    storage.canAccessObjectEntity.mockResolvedValue(true);
    storage.downloadObject.mockResolvedValue(new Response("cv bytes", {
      headers: { "Content-Type": "application/pdf" },
    }));

    const response = await request(buildApp())
      .get("/smart-apply/cv")
      .set("Authorization", AUTH_HEADER);

    expect(response.status).toBe(200);
    expect(response.body.toString()).toBe("cv bytes");
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="Jane Doe CV.pdf"');
    expect(response.headers["content-disposition"]).not.toContain("private-cv-key");
    expect(storage.getObjectEntityFile).toHaveBeenCalledWith(cv.storageKey);
    expect(storage.canAccessObjectEntity).toHaveBeenCalledWith(expect.objectContaining({ userId: "candidate-1" }));
  });

  it("does not download a CV when its object ACL denies access", async () => {
    queryResults.push([cv]);
    storage.getObjectEntityFile.mockResolvedValue({ name: "hidden-storage-key" });
    storage.canAccessObjectEntity.mockResolvedValue(false);

    const response = await request(buildApp())
      .get("/smart-apply/cv")
      .set("Authorization", AUTH_HEADER);

    expect(response.status).toBe(403);
    expect(storage.downloadObject).not.toHaveBeenCalled();
  });

  it("refuses to map sensitive structured fields from the profile or CV", async () => {
    const response = await request(buildApp())
      .post("/smart-apply/structured-prefill")
      .set("Authorization", AUTH_HEADER)
      .send({
        fields: [
          { id: "health", label: "Health Details", controlType: "textarea", options: [] },
          { id: "sex", label: "Equal Opportunities — Sex", controlType: "select", options: ["Female", "Male"] },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ values: [] });
  });

  it("uses gpt-4o-mini and retries it when structured-prefill temporarily fails", async () => {
    queryResults.push([{
      phone: "+44 7700 900123",
      streetAddress: "10 Example Road",
      city: "Leeds",
      postcode: "LS1 1AA",
      country: "United Kingdom",
      profession: "Registered Nurse",
      specialty: "Adult Nursing",
      qualificationCountry: "Nigeria",
      qualificationType: "BSc Nursing",
      qualificationYear: 2020,
      experienceYears: 4,
      registrationStatus: "NMC registered",
      residencyStatus: "Skilled Worker",
      preferredStartDate: null,
      languages: ["English"],
    }]);
    queryResults.push([]);
    createCompletion
      .mockRejectedValueOnce(new Error("Temporary provider failure"))
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              values: [{ id: "experience", value: "4" }],
            }),
          },
        }],
      });

    const response = await request(buildApp())
      .post("/smart-apply/structured-prefill")
      .set("Authorization", AUTH_HEADER)
      .send({
        fields: [
          { id: "experience", label: "Years of relevant experience", controlType: "text", options: [] },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      values: [{ id: "experience", value: "4" }],
    });
    expect(createCompletion).toHaveBeenCalledTimes(2);
    expect(createCompletion.mock.calls[0]?.[0]).toMatchObject({ model: "gpt-4o-mini" });
    expect(createCompletion.mock.calls[1]?.[0]).toMatchObject({ model: "gpt-4o-mini" });
    expect(JSON.stringify(createCompletion.mock.calls)).toContain("jane.doe.abc123@mail.jobsage.co.uk");
    expect(JSON.stringify(createCompletion.mock.calls)).not.toContain("jane@example.com");
  });

  it("resolves sponsor-vacancy unified role IDs for Smart Apply prefill", async () => {
    queryResults.push(
      [{
        profession: "Registered Nurse",
        specialty: "Adult Nursing",
        qualificationCountry: "Nigeria",
        qualificationType: "BSc Nursing",
        qualificationYear: 2020,
        experienceYears: 4,
        registrationStatus: "NMC registered",
        residencyStatus: "Skilled Worker",
        preferredStartDate: "Immediately",
        languages: ["English"],
        requiresSponsorship: true,
      }],
      [{
        vacancy: {
          id: 123,
          title: "Registered Nurse",
          organisationName: "Sponsor NHS Trust",
          location: "Leeds",
          description: "Skilled Worker sponsorship is available for this nursing role.",
        },
        licence: {
          organisationName: "Sponsor NHS Trust",
          contactEmail: "recruitment@sponsor.example",
        },
      }],
      [],
    );

    const response = await request(buildApp())
      .post("/roles/2000123/smart-apply/prefill")
      .set("Authorization", AUTH_HEADER);

    expect(response.status).toBe(200);
    expect(response.body.roleContext).toEqual({
      title: "Registered Nurse",
      location: "Leeds",
      regulator: "NMC",
      sponsorshipOffered: true,
    });
  });

  it("uses supplied vacancy context when a role is not fully represented internally", async () => {
    queryResults.push(
      [{
        profession: "Registered Nurse",
        specialty: "Adult Nursing",
        qualificationCountry: "Nigeria",
        qualificationType: "BSc Nursing",
        qualificationYear: 2020,
        experienceYears: 4,
        registrationStatus: "NMC registered",
        residencyStatus: "Skilled Worker",
        preferredStartDate: "Immediately",
        requiresSponsorship: true,
        preferredRegion: ["North West"],
        languages: ["English"],
        additionalNotes: null,
      }],
      [],
    );

    const response = await request(buildApp())
      .post("/roles/42/smart-apply/prefill")
      .set("Authorization", AUTH_HEADER)
      .send({
        title: "Staff Nurse",
        employer: "Example NHS Trust",
        location: "Liverpool",
        salary: "£31,000",
        description: "Provide safe, compassionate ward care.",
        externalUrl: "https://example.test/jobs/42",
        regulator: "NMC",
      });

    expect(response.status).toBe(200);
    const prompt = JSON.stringify(createCompletion.mock.calls[0]?.[0]);
    expect(prompt).toContain("Staff Nurse");
    expect(prompt).toContain("Example NHS Trust");
    expect(prompt).toContain("Liverpool");
    expect(prompt).toContain("£31,000");
    expect(prompt).toContain("Provide safe, compassionate ward care.");
    expect(prompt).toContain("https://example.test/jobs/42");
    expect(prompt).toContain("NMC");
  });

  it("uses sponsor vacancy and licence context for the Smart Apply assistant", async () => {
    queryResults.push(
      [{
        profession: "Registered Nurse",
        specialty: "Adult Nursing",
        qualificationCountry: "Nigeria",
        qualificationType: "BSc Nursing",
        qualificationYear: 2020,
        experienceYears: 4,
        registrationStatus: "NMC registered",
        requiresSponsorship: true,
        preferredRegion: ["Yorkshire"],
        languages: ["English"],
        additionalNotes: null,
      }],
      [{
        vacancy: {
          id: 123,
          title: "Registered Nurse",
          organisationName: "Sponsor NHS Trust",
          location: "Leeds",
          description: "Ward role with Skilled Worker sponsorship available.",
          url: "https://careers.sponsor.example/nurse",
        },
        licence: {
          organisationName: "Sponsor NHS Trust",
          contactEmail: "recruitment@sponsor.example",
          contactPhone: "0113 555 0100",
          website: "https://sponsor.example",
        },
      }],
      [],
    );
    async function* stream() {
      yield { choices: [{ delta: { content: "Draft answer" } }] };
    }
    createCompletion.mockResolvedValue(stream());

    const response = await request(buildApp())
      .post("/smart-apply/assistant")
      .set("Authorization", AUTH_HEADER)
      .send({ roleId: 2_000_123, message: "Help me answer this question." });

    expect(response.status).toBe(200);
    const prompt = JSON.stringify(createCompletion.mock.calls[0]?.[0]);
    expect(prompt).toContain("Sponsor NHS Trust");
    expect(prompt).toContain("https://careers.sponsor.example/nurse");
    expect(prompt).toContain("recruitment@sponsor.example");
  });
});