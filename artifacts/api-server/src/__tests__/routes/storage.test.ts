import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { objectStorageMock, MockObjectNotFoundError } = vi.hoisted(() => {
  class MockObjectNotFoundError extends Error {
    constructor() {
      super("Object not found");
      this.name = "ObjectNotFoundError";
    }
  }

  return {
    objectStorageMock: {
      getObjectEntityFile: vi.fn(),
      canAccessObjectEntity: vi.fn(),
      downloadObject: vi.fn(),
      getObjectEntityUploadURL: vi.fn(),
      normalizeObjectEntityPath: vi.fn(),
      searchPublicObject: vi.fn(),
    },
    MockObjectNotFoundError,
  };
});

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: vi.fn(function ObjectStorageService() {
    return objectStorageMock;
  }),
  ObjectNotFoundError: MockObjectNotFoundError,
}));

vi.mock("../../lib/objectAcl", () => ({
  ObjectPermission: { READ: "read", WRITE: "write" },
}));

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    getSession: vi.fn().mockResolvedValue({
      user: { id: "cand-1", email: "candidate@jobsage.test", role: "candidate" },
    }),
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
    createSession: vi.fn().mockResolvedValue("storage-session"),
  };
});

const storageRouter = (await import("../../routes/storage")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

const SESSION = "storage-session";
const STORAGE_KEY = "/objects/uploads/12345678-1234-1234-1234-123456789012";

beforeEach(() => {
  objectStorageMock.getObjectEntityFile.mockReset();
  objectStorageMock.canAccessObjectEntity.mockReset();
  objectStorageMock.downloadObject.mockReset();
  objectStorageMock.getObjectEntityUploadURL.mockReset();
  objectStorageMock.normalizeObjectEntityPath.mockReset();
  objectStorageMock.searchPublicObject.mockReset();
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(storageRouter);
  return app;
}

describe("private object download authorization", () => {
  it("streams a private object only after the authenticated owner passes its ACL", async () => {
    const objectFile = { name: "private CV" };
    objectStorageMock.getObjectEntityFile.mockResolvedValueOnce(objectFile);
    objectStorageMock.canAccessObjectEntity.mockResolvedValueOnce(true);
    objectStorageMock.downloadObject.mockResolvedValueOnce(
      new Response("synthetic CV bytes", {
        headers: {
          "Content-Type": "application/pdf",
          "Cache-Control": "private, max-age=0",
        },
      }),
    );

    const response = await request(buildApp())
      .get(`/storage${STORAGE_KEY}`)
      .set("Authorization", `Bearer ${SESSION}`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["cache-control"]).toBe("private, max-age=0");
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect((response.body as Buffer).toString("utf8")).toBe("synthetic CV bytes");
    expect(objectStorageMock.getObjectEntityFile).toHaveBeenCalledWith(STORAGE_KEY);
    expect(objectStorageMock.canAccessObjectEntity).toHaveBeenCalledWith({
      userId: "cand-1",
      objectFile,
      requestedPermission: "read",
    });
    expect(objectStorageMock.downloadObject).toHaveBeenCalledWith(objectFile);
  });

  it("does not stream a private object to a different authenticated account", async () => {
    objectStorageMock.getObjectEntityFile.mockResolvedValueOnce({ name: "another candidate CV" });
    objectStorageMock.canAccessObjectEntity.mockResolvedValueOnce(false);

    const response = await request(buildApp())
      .get(`/storage${STORAGE_KEY}`)
      .set("Authorization", `Bearer ${SESSION}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Forbidden");
    expect(objectStorageMock.downloadObject).not.toHaveBeenCalled();
  });

  it("requires authentication before resolving a private object path", async () => {
    const response = await request(buildApp()).get(`/storage${STORAGE_KEY}`);

    expect(response.status).toBe(401);
    expect(objectStorageMock.getObjectEntityFile).not.toHaveBeenCalled();
  });
});
