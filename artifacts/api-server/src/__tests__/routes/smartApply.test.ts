import { beforeEach, describe, expect, it, vi } from "vitest";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";

const { queryResults, storage } = vi.hoisted(() => ({
  queryResults: [] as any[],
  storage: {
    getObjectEntityFile: vi.fn(),
    canAccessObjectEntity: vi.fn(),
    downloadObject: vi.fn(),
  },
}));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from: () => chain,
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
  });

  it("requires authentication for the safe candidate prefill", async () => {
    const response = await request(buildApp()).get("/smart-apply/candidate-prefill");
    expect(response.status).toBe(401);
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
      email: "jane@example.com",
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

  it("uses the signed-in account email while returning contact fields from the profile", async () => {
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
      email: "jane@example.com",
      phone: "+44 7700 900123",
      streetAddress: "10 Example Road",
      city: "Leeds",
      postcode: "LS1 1AA",
      country: "United Kingdom",
    });
    expect(response.body).not.toHaveProperty("jobsageEmail");
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
});