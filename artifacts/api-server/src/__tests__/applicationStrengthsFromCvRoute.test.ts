import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectRows, routeErrors, mockOpenAiCreate, mockGetSession } = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  routeErrors: [] as unknown[],
  mockOpenAiCreate: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

vi.mock("@workspace/db", () => {
  const query = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
        Promise.resolve(selectRows.shift() ?? []).then(resolve, reject),
    };
    return chain;
  };
  return {
    db: {
      select: query,
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    },
    consentLogsTable: { userId: {}, consentedAt: {} },
    documentsTable: { id: {}, userId: {}, documentType: {} },
    cvEnhancementUsageTable: { userId: {}, usageDate: {}, count: {} },
    profilesTable: {},
    DOCUMENT_DISCLAIMER: "Uploaded by candidate for reference.",
  };
});

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: mockOpenAiCreate } } },
}));

vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityFile() { return {}; }
    async downloadObject() { return new Response("fixture PDF"); }
  },
}));

vi.mock("pdf-parse", () => ({
  PDFParse: class {
    async getText() {
      return {
        text: [
          "Email: candidate@example.com",
          "Registered nurse with experience in urgent and emergency care.",
          "Led a multidisciplinary team of 12 during a service redesign.",
        ].join("\n"),
      };
    }
  },
}));

vi.mock("../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../lib/auth")>("../lib/auth");
  return {
    ...actual,
    getSession: mockGetSession,
    createSession: vi.fn().mockResolvedValue("session"),
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
  };
});

const cvEnhancementRouter = (await import("../routes/cvEnhancement")).default;
const { authMiddleware } = await import("../middlewares/authMiddleware");

const consentRow = { userId: "candidate-1", consentedAt: new Date() };
const cvDocument = {
  id: 41,
  userId: "candidate-1",
  filename: "primary-cv.pdf",
  mimeType: "application/pdf",
  storageKey: "/objects/uploads/cv-41",
  documentType: "cv",
};
const evidence = "Led a multidisciplinary team of 12 during a service redesign.";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use((req, _res, next) => {
    (req as unknown as { log: { error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void } }).log = {
      error: (...args) => routeErrors.push(args),
      warn: (...args) => routeErrors.push(args),
    };
    next();
  });
  app.use(cvEnhancementRouter);
  return app;
}

describe("POST /profiles/application-strengths/draft", () => {
  beforeEach(() => {
    selectRows.length = 0;
    routeErrors.length = 0;
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: {
        id: "candidate-1",
        email: "candidate@example.com",
        role: "candidate",
        firstName: "Candidate",
        lastName: "Example",
        profileImageUrl: null,
      },
    });
    mockOpenAiCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            strengths: [{
              text: "I lead multidisciplinary teams through service improvement.",
              evidence: [evidence],
            }],
          }),
        },
      }],
    });
  });

  it("requires a signed-in user", async () => {
    mockGetSession.mockResolvedValue(null);
    const response = await request(buildApp())
      .post("/profiles/application-strengths/draft")
      .send({ documentId: 41 });
    expect(response.status).toBe(401);
    expect(mockOpenAiCreate).not.toHaveBeenCalled();
  });

  it("does not draft from a CV that is not owned by the candidate", async () => {
    selectRows.push([consentRow], []);
    const response = await request(buildApp())
      .post("/profiles/application-strengths/draft")
      .set("Authorization", "Bearer candidate-session-token")
      .send({ documentId: 41 });
    expect(response.status, JSON.stringify(routeErrors)).toBe(404);
    expect(mockOpenAiCreate).not.toHaveBeenCalled();
  });

  it("uses only redacted text from an owned CV and returns verifiable draft evidence", async () => {
    selectRows.push([consentRow], [cvDocument], [{ count: 0 }]);
    const response = await request(buildApp())
      .post("/profiles/application-strengths/draft")
      .set("Authorization", "Bearer candidate-session-token")
      .send({ documentId: 41 });

    expect(response.status, JSON.stringify(routeErrors)).toBe(200);
    expect(response.body).toMatchObject({
      documentId: 41,
      filename: "primary-cv.pdf",
      remaining: 4,
      strengths: [{
        text: "I lead multidisciplinary teams through service improvement.",
        evidence: [evidence],
      }],
    });

    const aiInput = mockOpenAiCreate.mock.calls[0]?.[0];
    const sourceText = aiInput.messages[1].content as string;
    expect(sourceText).toContain(evidence);
    expect(sourceText).not.toContain("candidate@example.com");
  });

  it("rejects a non-PDF CV before calling the AI", async () => {
    selectRows.push([consentRow], [{ ...cvDocument, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }]);
    const response = await request(buildApp())
      .post("/profiles/application-strengths/draft")
      .set("Authorization", "Bearer candidate-session-token")
      .send({ documentId: 41 });
    expect(response.status, JSON.stringify(routeErrors)).toBe(415);
    expect(mockOpenAiCreate).not.toHaveBeenCalled();
  });
});
