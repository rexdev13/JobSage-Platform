import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const {
  dbResults,
  insertValues,
  updateSets,
  operationOrder,
  objectStorageMock,
  extractCvFieldsMock,
  MockObjectNotFoundError,
} = vi.hoisted(() => {
  class MockObjectNotFoundError extends Error {
    constructor() {
      super("Object not found");
      this.name = "ObjectNotFoundError";
    }
  }

  return {
    dbResults: [] as any[],
    insertValues: [] as any[],
    updateSets: [] as any[],
    operationOrder: [] as string[],
    objectStorageMock: {
      saveFileBuffer: vi.fn(),
      trySetObjectEntityAclPolicy: vi.fn(),
      getObjectEntityFile: vi.fn(),
      deleteObjectEntityFile: vi.fn(),
    },
    extractCvFieldsMock: vi.fn(),
    MockObjectNotFoundError,
  };
});

vi.mock("@workspace/db", () => {
  function makeChain(action: string): any {
    const chain: any = {
      from() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      values(value: unknown) {
        insertValues.push(value);
        return chain;
      },
      set(value: unknown) {
        updateSets.push(value);
        return chain;
      },
      returning() {
        if (action === "delete") operationOrder.push("database-delete");
        return Promise.resolve(dbResults.shift() ?? []);
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(dbResults.shift() ?? []).then(resolve, reject);
      },
    };
    return chain;
  }

  const dbMock: any = {
    select: () => makeChain("select"),
    insert: () => makeChain("insert"),
    update: () => makeChain("update"),
    delete: () => makeChain("delete"),
    transaction: (callback: (tx: any) => Promise<unknown>) => callback(dbMock),
  };

  return {
    db: dbMock,
    documentsTable: {},
    careerProfilesTable: {},
    DOCUMENT_DISCLAIMER: "Synthetic document disclaimer.",
    DOCUMENT_TYPES: ["cv", "cover_letter", "certificate", "other"],
  };
});

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: vi.fn(function ObjectStorageService() {
    return objectStorageMock;
  }),
  ObjectNotFoundError: MockObjectNotFoundError,
}));

vi.mock("../../lib/cvParser", () => ({
  extractCvFields: extractCvFieldsMock,
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
    createSession: vi.fn().mockResolvedValue("document-session"),
  };
});

const documentsRouter = (await import("../../routes/documents")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

const SESSION = "document-session";
const STORAGE_KEY = "/objects/uploads/12345678-1234-1234-1234-123456789012";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    Object.assign(req, { log: { error: vi.fn() } });
    next();
  });
  app.use(authMiddleware);
  app.use(documentsRouter);
  return app;
}

describe("candidate document lifecycle", () => {
  beforeEach(() => {
    dbResults.length = 0;
    insertValues.length = 0;
    updateSets.length = 0;
    operationOrder.length = 0;
    objectStorageMock.saveFileBuffer.mockReset().mockResolvedValue(STORAGE_KEY);
    objectStorageMock.trySetObjectEntityAclPolicy.mockReset().mockResolvedValue(STORAGE_KEY);
    objectStorageMock.getObjectEntityFile.mockReset();
    objectStorageMock.deleteObjectEntityFile.mockReset().mockImplementation(async () => {
      operationOrder.push("storage-delete");
    });
    extractCvFieldsMock.mockReset();
  });

  it("uploads a CV, assigns a private owner ACL, and registers its metadata", async () => {
    const document = {
      id: 41,
      userId: "cand-1",
      filename: "candidate-cv.pdf",
      mimeType: "application/pdf",
      storageKey: STORAGE_KEY,
      fileSize: 20,
    };
    dbResults.push([document]);

    const response = await request(buildApp())
      .post("/documents/upload")
      .set("Authorization", `Bearer ${SESSION}`)
      .attach("file", Buffer.from("%PDF synthetic candidate CV"), {
        filename: "candidate-cv.pdf",
        contentType: "application/pdf",
      });

    expect(response.status).toBe(201);
    expect(objectStorageMock.saveFileBuffer).toHaveBeenCalledWith(expect.objectContaining({
      contentType: "application/pdf",
    }));
    expect(objectStorageMock.trySetObjectEntityAclPolicy).toHaveBeenCalledWith(STORAGE_KEY, {
      owner: "cand-1",
      visibility: "private",
    });
    expect(insertValues[0]).toMatchObject({
      userId: "cand-1",
      filename: "candidate-cv.pdf",
      mimeType: "application/pdf",
      storageKey: STORAGE_KEY,
    });
  });

  it("does not register a multipart upload if its private ACL fails and cleans up the uploaded bytes", async () => {
    objectStorageMock.trySetObjectEntityAclPolicy.mockRejectedValueOnce(new Error("ACL unavailable"));

    const response = await request(buildApp())
      .post("/documents/upload")
      .set("Authorization", `Bearer ${SESSION}`)
      .attach("file", Buffer.from("%PDF synthetic candidate CV"), {
        filename: "candidate-cv.pdf",
        contentType: "application/pdf",
      });

    expect(response.status).toBe(503);
    expect(insertValues).toHaveLength(0);
    expect(objectStorageMock.deleteObjectEntityFile).toHaveBeenCalledWith(STORAGE_KEY);
    expect(operationOrder).toEqual(["storage-delete"]);
  });

  it("rejects presigned object paths that escape the private uploads namespace", async () => {
    const response = await request(buildApp())
      .post("/documents")
      .set("Authorization", `Bearer ${SESSION}`)
      .send({
        filename: "candidate-cv.pdf",
        mimeType: "application/pdf",
        storageKey: "/objects/uploads/../../other-user/private-file",
        fileSize: 20,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Invalid storage key");
    expect(objectStorageMock.trySetObjectEntityAclPolicy).not.toHaveBeenCalled();
    expect(insertValues).toHaveLength(0);
  });

  it("does not register a presigned upload if its private ACL cannot be written", async () => {
    objectStorageMock.trySetObjectEntityAclPolicy.mockRejectedValueOnce(new Error("ACL unavailable"));

    const response = await request(buildApp())
      .post("/documents")
      .set("Authorization", `Bearer ${SESSION}`)
      .send({
        filename: "candidate-cv.pdf",
        mimeType: "application/pdf",
        storageKey: STORAGE_KEY,
        fileSize: 20,
      });

    expect(response.status).toBe(503);
    expect(response.body.error).toContain("could not be secured");
    expect(insertValues).toHaveLength(0);
  });

  it("parses only an owned, valid private upload and returns reviewed extraction data", async () => {
    const document = {
      id: 41,
      userId: "cand-1",
      filename: "candidate-cv.pdf",
      mimeType: "application/pdf",
      storageKey: STORAGE_KEY,
    };
    const download = vi.fn().mockResolvedValue([Buffer.from("%PDF synthetic candidate CV")]);
    dbResults.push([document]);
    objectStorageMock.getObjectEntityFile.mockResolvedValue({ download });
    extractCvFieldsMock.mockResolvedValue({ profession: "Registered Nurse" });

    const response = await request(buildApp())
      .post("/documents/41/parse-cv")
      .set("Authorization", `Bearer ${SESSION}`);

    expect(response.status).toBe(200);
    expect(response.body.extracted).toEqual({ profession: "Registered Nurse" });
    expect(objectStorageMock.getObjectEntityFile).toHaveBeenCalledWith(STORAGE_KEY);
    expect(extractCvFieldsMock).toHaveBeenCalledWith(expect.any(Buffer), "application/pdf");
  });

  it("deletes stored bytes before deleting the owned document row", async () => {
    dbResults.push(
      [{ id: 41, storageKey: STORAGE_KEY }],
      [{ id: 41 }],
    );

    const response = await request(buildApp())
      .delete("/documents/41")
      .set("Authorization", `Bearer ${SESSION}`);

    expect(response.status).toBe(204);
    expect(objectStorageMock.deleteObjectEntityFile).toHaveBeenCalledWith(STORAGE_KEY);
    expect(operationOrder).toEqual(["storage-delete", "database-delete"]);
  });

  it("allows metadata cleanup when the already-missing file is retried", async () => {
    dbResults.push(
      [{ id: 41, storageKey: STORAGE_KEY }],
      [{ id: 41 }],
    );
    objectStorageMock.deleteObjectEntityFile.mockRejectedValueOnce(new MockObjectNotFoundError());

    const response = await request(buildApp())
      .delete("/documents/41")
      .set("Authorization", `Bearer ${SESSION}`);

    expect(response.status).toBe(204);
    expect(operationOrder).toEqual(["database-delete"]);
  });

  it("does not delete another candidate's document or stored file", async () => {
    dbResults.push([]);

    const response = await request(buildApp())
      .delete("/documents/41")
      .set("Authorization", `Bearer ${SESSION}`);

    expect(response.status).toBe(404);
    expect(objectStorageMock.deleteObjectEntityFile).not.toHaveBeenCalled();
    expect(operationOrder).toEqual([]);
  });

  it("keeps document metadata when file storage is temporarily unavailable", async () => {
    dbResults.push([{ id: 41, storageKey: STORAGE_KEY }]);
    objectStorageMock.deleteObjectEntityFile.mockRejectedValueOnce(new Error("storage unavailable"));

    const response = await request(buildApp())
      .delete("/documents/41")
      .set("Authorization", `Bearer ${SESSION}`);

    expect(response.status).toBe(503);
    expect(response.body.error).toContain("could not be removed from file storage");
    expect(operationOrder).toEqual([]);
  });
});
