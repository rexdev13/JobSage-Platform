import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { dbResults, mockGetSession, mockGetObjectEntityFile } = vi.hoisted(() => ({
  dbResults: [] as any[],
  mockGetSession: vi.fn(),
  mockGetObjectEntityFile: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      values() { return chain; },
      set() { return chain; },
      then(resolve: any, reject?: any) {
        return Promise.resolve(dbResults.shift() ?? []).then(resolve, reject);
      },
      returning() {
        return Promise.resolve(dbResults.shift() ?? []);
      },
    };
    return chain;
  }
  return {
    db: {
      select: vi.fn(() => makeChain()),
      insert: vi.fn(() => makeChain()),
      update: vi.fn(() => makeChain()),
    },
    learningVideosTable: {},
    profilesTable: {},
    usersTable: {},
  };
});

vi.mock("../lib/objectStorage", () => ({
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
  ObjectStorageService: class {
    getObjectEntityFile(...args: unknown[]) {
      return mockGetObjectEntityFile(...args);
    }
  },
}));

vi.mock("../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../lib/auth")>("../lib/auth");
  return {
    ...actual,
    getSession: mockGetSession,
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
    createSession: vi.fn().mockResolvedValue("session"),
  };
});

const learningVideosRouter = (await import("../routes/learningVideos")).default;
const { authMiddleware } = await import("../middlewares/authMiddleware");
const {
  learningVideoMatchesProfession,
  normalizeExternalVideoUrl,
  normalizeExamPrepProfession,
  officialExamPrepResourcesForProfession,
  parseByteRange,
  validApplicability,
  validReviewWindow,
} = await import("../routes/learningVideos");

const candidate = {
  user: {
    id: "candidate-1",
    email: "candidate@example.com",
    role: "candidate",
    firstName: "Taylor",
    lastName: "Candidate",
    profileImageUrl: null,
  },
};
const AUTH = "Bearer learning-video-test-session";
const MEDIA_KEY = "/objects/uploads/00000000-0000-4000-8000-000000000001";
const adminVideoInput = {
  title: "Exam preparation video",
  description: "Reviewed exam preparation guidance.",
  category: "professional_registration",
  videoUrl: "https://youtu.be/dQw4w9WgXcQ",
  applicability: "Doctors preparing for PLAB",
  sourceLabel: "JOBSAGE",
  sourceUrl: "https://www.gmc-uk.org/",
  transcript: null,
  reviewedBy: "JOBSAGE reviewer",
  reviewedAt: "2026-01-01",
  reviewDueAt: "2099-01-01",
  status: "draft",
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(learningVideosRouter);
  return app;
}

function videoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    title: "Exam preparation video",
    description: "Reviewed exam preparation guidance.",
    category: "professional_registration",
    videoEmbedUrl: null,
    storageKey: MEDIA_KEY,
    durationSeconds: 60,
    language: "English",
    applicability: "Doctors preparing for PLAB",
    sourceLabel: "JOBSAGE",
    sourceUrl: "https://www.gmc-uk.org/",
    transcript: null,
    reviewedBy: "JOBSAGE reviewer",
    reviewedAt: "2026-01-01",
    reviewDueAt: "2099-01-01",
    status: "published",
    sortOrder: 1,
    createdBy: "admin-1",
    updatedBy: "admin-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

function setSession(role = "candidate", id = "candidate-1") {
  mockGetSession.mockResolvedValue({
    user: {
      ...candidate.user,
      id,
      role,
    },
  });
}

function enqueueProfileAndVideos(profession: string | null, videos: unknown[]) {
  dbResults.push(profession === null ? [] : [{ profession }], videos);
}

beforeEach(() => {
  dbResults.length = 0;
  setSession();
  mockGetObjectEntityFile.mockReset().mockResolvedValue({
    getMetadata: vi.fn().mockResolvedValue([{ size: "6", contentType: "video/mp4" }]),
    createReadStream: vi.fn(() => Readable.from([Buffer.from("video!")])),
  });
});

describe("learning video URL validation", () => {
  it("normalizes YouTube watch and short links to privacy-enhanced embeds", () => {
    expect(normalizeExternalVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(normalizeExternalVideoUrl("https://youtu.be/dQw4w9WgXcQ?t=42")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });

  it("normalizes Vimeo links and retains the privacy hash", () => {
    expect(normalizeExternalVideoUrl("https://vimeo.com/123456789?h=abcdef")).toBe(
      "https://player.vimeo.com/video/123456789?h=abcdef",
    );
  });

  it("rejects unsupported hosts, insecure links, and credentials", () => {
    expect(normalizeExternalVideoUrl("http://youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(normalizeExternalVideoUrl("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(normalizeExternalVideoUrl("https://user:pass@vimeo.com/123456789")).toBeNull();
    expect(normalizeExternalVideoUrl("https://example.com/video.mp4")).toBeNull();
  });
});

describe("learning video review rules", () => {
  it("requires applicability for sponsorship, clinical, registration, and relocation guidance", () => {
    expect(validApplicability("medical", null)).toBe(false);
    expect(validApplicability("sponsorship", "   ")).toBe(false);
    expect(validApplicability("professional_registration", "Nurses applying to the UK")).toBe(true);
    expect(validApplicability("application", null)).toBe(true);
  });

  it("rejects invalid review periods and expired published videos", () => {
    expect(validReviewWindow("2025-01-01", "2025-02-01", "draft")).toBe(true);
    expect(validReviewWindow("2025-02-01", "2025-01-01", "draft")).toBe(false);
    expect(validReviewWindow("2025-01-01", "2025-02-01", "published")).toBe(false);
  });
});

describe("professional exam-prep access", () => {
  it.each([
    ["Doctor", "doctor"],
    ["Registered Nurse", "nurse"],
    ["Dentist", "dentist"],
  ] as const)("normalizes eligible profession %s", (value, expected) => {
    expect(normalizeExamPrepProfession(value)).toBe(expected);
  });

  it.each(["Midwife", "Pharmacist", "", null])("rejects unsupported profession %s", (value) => {
    expect(normalizeExamPrepProfession(value)).toBeNull();
  });

  it("matches only professional registration resources for the saved profession", () => {
    expect(learningVideoMatchesProfession("Nurses preparing for CBT and OSCE", "nurse")).toBe(true);
    expect(learningVideoMatchesProfession("Dentists preparing for ORE", "nurse")).toBe(false);
    expect(learningVideoMatchesProfession(null, "doctor")).toBe(false);
  });

  it.each([
    ["doctor", ["PLAB 1", "PLAB 2"]],
    ["nurse", ["CBT", "OSCE"]],
    ["dentist", ["ORE overview", "ORE Part 1", "ORE Part 2"]],
  ] as const)("provides current official resources for %s", (profession, stages) => {
    const resources = officialExamPrepResourcesForProfession(profession, new Date("2026-10-10T00:00:00.000Z"));
    expect(resources.map((resource) => resource.stage)).toEqual(stages);

    for (const resource of resources) {
      expect(resource.status).toBe("published");
      expect(resource.category).toBe("professional_registration");
      expect(resource.applicability?.toLowerCase()).toContain(profession);
      expect(resource.sourceUrl).toMatch(/^https:\/\/(www\.)?(gmc-uk\.org|nmc\.org\.uk|gdc-uk\.org)\//);
      expect(resource.reviewedAt.toISOString().slice(0, 10)).toBe("2026-10-10");
      expect(resource.reviewDueAt.getTime()).toBeGreaterThan(resource.reviewedAt.getTime());
      expect(resource.reviewedBy).toBeTruthy();
    }

    expect(officialExamPrepResourcesForProfession(profession, new Date("2027-04-11T00:00:00.000Z"))).toEqual([]);
  });
});

describe("learning video route profession gate", () => {
  const professionVideos = [
    videoRow({ id: 41, applicability: "Doctors preparing for PLAB" }),
    videoRow({ id: 42, applicability: "Nurses preparing for CBT and OSCE" }),
    videoRow({ id: 43, applicability: "Dentists preparing for ORE" }),
  ];

  it.each([
    ["doctor", "doctor", 41],
    ["nurse", "nurse", 42],
    ["dentist", "dentist", 43],
  ] as const)("returns applicable published resources to a %s candidate", async (_label, profession, expectedId) => {
    enqueueProfileAndVideos(profession, professionVideos);

    const response = await request(buildApp()).get("/learning-videos").set("Authorization", AUTH);

    expect(response.status).toBe(200);
    expect(response.body.videos.some((video: { id: number }) => video.id === expectedId)).toBe(true);
    expect(response.body.videos.filter((video: { id: number }) => [41, 42, 43].includes(video.id)))
      .toEqual([expect.objectContaining({ id: expectedId })]);
    expect(response.body.videos.some((video: { id: number }) => video.id < 0)).toBe(true);
  });

  it.each([
    ["doctor", "doctor", "Doctors preparing for PLAB"],
    ["nurse", "nurse", "Nurses preparing for CBT and OSCE"],
    ["dentist", "dentist", "Dentists preparing for ORE"],
  ] as const)("streams a direct media URL to an eligible %s candidate", async (_label, profession, applicability) => {
    dbResults.push([videoRow({ applicability })], [{ profession }]);

    const response = await request(buildApp())
      .get("/learning-videos/41/media")
      .set("Authorization", AUTH)
      .set("Range", "bytes=0-5");

    expect(response.status).toBe(206);
    expect(response.headers["content-range"]).toBe("bytes 0-5/6");
    expect(response.body.toString()).toBe("video!");
    expect(mockGetObjectEntityFile).toHaveBeenCalledWith(MEDIA_KEY);
  });

  it.each([
    ["unsupported profession", "pharmacist"],
    ["missing profession", null],
  ] as const)("denies the candidate video list with a %s", async (_label, profession) => {
    enqueueProfileAndVideos(profession, professionVideos);

    const response = await request(buildApp()).get("/learning-videos").set("Authorization", AUTH);

    expect(response.status).toBe(403);
    expect(response.body.videos).toBeUndefined();
  });

  it.each([
    ["unsupported profession", "pharmacist"],
    ["missing profession", null],
  ] as const)("does not stream directly requested media with a %s", async (_label, profession) => {
    dbResults.push([videoRow()], profession === null ? [] : [{ profession }]);

    const response = await request(buildApp()).get("/learning-videos/41/media").set("Authorization", AUTH);

    expect(response.status).toBe(404);
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
  });

  it("denies a direct media URL when the saved profession does not match the video", async () => {
    dbResults.push([videoRow({ applicability: "Doctors preparing for PLAB" })], [{ profession: "nurse" }]);

    const response = await request(buildApp()).get("/learning-videos/41/media").set("Authorization", AUTH);

    expect(response.status).toBe(404);
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
  });

  it("keeps the staff video-management list available for admins", async () => {
    setSession("admin", "admin-1");
    const draft = videoRow({ status: "draft", reviewDueAt: "2020-01-01", applicability: null });
    dbResults.push([draft]);

    const response = await request(buildApp()).get("/admin/learning-videos").set("Authorization", AUTH);

    expect(response.status).toBe(200);
    expect(response.body.videos).toEqual([
      expect.objectContaining({ id: 41, status: "draft", applicability: null }),
    ]);
  });

  it("lets admins create a managed video using review dates from the JSON form", async () => {
    setSession("admin", "admin-1");
    dbResults.push([
      videoRow({
        videoEmbedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
        storageKey: null,
        applicability: adminVideoInput.applicability,
        status: "draft",
      }),
    ]);

    const response = await request(buildApp())
      .post("/admin/learning-videos")
      .set("Authorization", AUTH)
      .send(adminVideoInput);

    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      id: 41,
      videoEmbedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      status: "draft",
      reviewedAt: "2026-01-01T00:00:00.000Z",
      reviewDueAt: "2099-01-01T00:00:00.000Z",
    }));
  });

  it("lets admins edit a managed video using review dates from the JSON form", async () => {
    setSession("admin", "admin-1");
    dbResults.push(
      [videoRow()],
      [videoRow({ title: "Updated exam preparation video", status: "published" })],
    );

    const response = await request(buildApp())
      .patch("/admin/learning-videos/41")
      .set("Authorization", AUTH)
      .send({ ...adminVideoInput, title: "Updated exam preparation video", status: "published" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      title: "Updated exam preparation video",
      status: "published",
      reviewedAt: "2026-01-01T00:00:00.000Z",
      reviewDueAt: "2099-01-01T00:00:00.000Z",
    }));
  });

  it.each(["admin", "super_admin"] as const)("allows %s staff to preview otherwise-ineligible media", async (role) => {
    setSession(role, `${role}-1`);
    dbResults.push([
      videoRow({
        status: "draft",
        reviewDueAt: "2020-01-01",
        category: "jobsage",
        applicability: "Pharmacists",
      }),
    ]);

    const response = await request(buildApp())
      .get("/learning-videos/41/media")
      .set("Authorization", AUTH)
      .set("Range", "bytes=0-5");

    expect(response.status).toBe(206);
    expect(response.body.toString()).toBe("video!");
    expect(mockGetObjectEntityFile).toHaveBeenCalledWith(MEDIA_KEY);
  });
});

describe("video byte ranges", () => {
  it("parses bounded, open-ended, and suffix byte ranges", () => {
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=0-999", 100)).toEqual({ start: 0, end: 99 });
  });

  it("rejects malformed and unsatisfiable ranges", () => {
    expect(parseByteRange("bytes=100-", 100)).toBe(false);
    expect(parseByteRange("bytes=-0", 100)).toBe(false);
    expect(parseByteRange("bytes=0-10,20-30", 100)).toBe(false);
  });
});
