import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { appResults } = vi.hoisted(() => ({ appResults: [] as any[] }));

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
        return Promise.resolve(appResults.shift() ?? []).then(resolve, reject);
      },
      catch() { return chain; },
      returning() { return Promise.resolve(appResults.shift() ?? []); },
    };
    return chain;
  }
  return {
    db: {
      select: () => makeChain(),
      insert: () => makeChain(),
      update: () => makeChain(),
      delete: () => makeChain(),
    },
    applicationsTable: {},
    speculativeApplicationsTable: {},
    jobListingsTable: {},
    documentsTable: {},
    rolesTable: {},
    candidateMessagesTable: {},
  };
});

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    getSession: vi.fn().mockResolvedValue({
      user: { id: "cand-1", email: "cand@test.com", role: "candidate", firstName: "Jane", lastName: "Doe", profileImageUrl: null },
    }),
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
    createSession: vi.fn().mockResolvedValue("sess"),
  };
});

vi.mock("../../lib/systemMessages", () => ({
  createApplicationReceivedMessage: vi.fn().mockResolvedValue(undefined),
}));

// DNS lookups in the SSRF guard: hostnames containing "private" resolve to an
// RFC1918 address; everything else resolves to a public IP.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => {
    if (host.includes("private")) return [{ address: "10.0.0.5", family: 4 }];
    return [{ address: "93.184.216.34", family: 4 }];
  }),
}));

const applicationsRouter = (await import("../../routes/applications")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(applicationsRouter);
  return app;
}

const SESS = "cand-session";

describe("GET /applications", () => {
  beforeEach(() => { appResults.length = 0; });

  it("returns 401 when not authenticated (no auth header)", async () => {
    const app = buildApp();
    const res = await request(app).get("/applications");
    expect(res.status).toBe(401);
  });

  it("returns empty application list with stats when none exist", async () => {
    appResults.push(
      [],
      [],
    );
    const app = buildApp();
    const res = await request(app)
      .get("/applications")
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.applications)).toBe(true);
    expect(res.body.applications).toHaveLength(0);
    expect(res.body.stats).toBeDefined();
    expect(res.body.stats.total).toBe(0);
  });
});

describe("POST /applications", () => {
  beforeEach(() => { appResults.length = 0; });

  it("returns 400 when roleId is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/applications")
      .set("Authorization", `Bearer ${SESS}`)
      .send({ coverLetter: "Hello" });
    expect(res.status).toBe(400);
  });

  it("creates new application and returns 200 when no duplicate exists", async () => {
    appResults.push(
      [],
      [{ id: 1, userId: "cand-1", roleId: 42, status: "applied", appliedAt: new Date(), applicationType: "platform", cvDocumentId: null }],
      [],
      [],
    );
    const app = buildApp();
    const res = await request(app)
      .post("/applications")
      .set("Authorization", `Bearer ${SESS}`)
      .send({ roleId: 42 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  it("returns 200 when application already exists for that role (idempotent)", async () => {
    appResults.push(
      [{ id: 5, userId: "cand-1", roleId: 42, status: "applied", appliedAt: new Date(), applicationType: "platform", cvDocumentId: null }],
    );
    const app = buildApp();
    const res = await request(app)
      .post("/applications")
      .set("Authorization", `Bearer ${SESS}`)
      .send({ roleId: 42 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(5);
  });
});

describe("GET /applications/track-outbound", () => {
  beforeEach(() => {
    appResults.length = 0;
    vi.unstubAllGlobals();
  });

  const base = "/applications/track-outbound";

  it("rejects homepage-style URLs with 400 INVALID_DEEP_LINK", async () => {
    const app = buildApp();
    for (const url of ["https://acme.com/", "https://acme.com/careers", "https://acme.com/search", "https://acme.com/jobs"]) {
      const res = await request(app)
        .get(`${base}?vacancyId=7&destinationUrl=${encodeURIComponent(url)}`)
        .set("Authorization", `Bearer ${SESS}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_DEEP_LINK");
    }
  });

  it("rejects private/loopback/link-local destinations with 400 INVALID_DEEP_LINK (SSRF guard)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const app = buildApp();
    for (const url of [
      "http://127.0.0.1/jobs/nurse-12345",
      "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.1/jobs/nurse-12345",
      "http://192.168.1.10/jobs/nurse-12345",
      "http://localhost/jobs/nurse-12345",
      "https://private.corp-intranet.com/jobs/nurse-12345",
    ]) {
      const res = await request(app)
        .get(`${base}?vacancyId=7&destinationUrl=${encodeURIComponent(url)}`)
        .set("Authorization", `Bearer ${SESS}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_DEEP_LINK");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a destination that does not match the vacancy's stored apply URL", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    appResults.push([{ employer: "Acme", applyUrl: "https://acme.com/jobs/nurse-12345" }]);
    const app = buildApp();
    const res = await request(app)
      .get(`${base}?vacancyId=7&destinationUrl=${encodeURIComponent("https://evil.example.com/jobs/steal-tokens")}`)
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DEEP_LINK");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects when the vacancy does not exist, or has a null or non-http stored apply URL", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const app = buildApp();
    const cases = [
      [], // vacancy not found
      [{ employer: "Acme", applyUrl: null }], // no stored apply URL
      [{ employer: "Acme", applyUrl: "mailto:jobs@acme.com" }], // non-http stored URL
    ];
    for (const lookupResult of cases) {
      appResults.length = 0;
      appResults.push(lookupResult);
      const res = await request(app)
        .get(`${base}?vacancyId=7&destinationUrl=${encodeURIComponent("https://acme.com/jobs/nurse-12345")}`)
        .set("Authorization", `Bearer ${SESS}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_DEEP_LINK");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks a public URL that 30x-redirects to a private/metadata host (SSRF via redirect)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    appResults.push([{ employer: "Acme", applyUrl: "https://acme.com/jobs/nurse-12345" }]);
    const app = buildApp();
    const res = await request(app)
      .get(`${base}?vacancyId=7&destinationUrl=${encodeURIComponent("https://acme.com/jobs/nurse-12345")}`)
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DEEP_LINK");
    // Only the public first hop was fetched — never the private redirect target.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("acme.com");
  });

  it("returns 410 JOB_EXPIRED and expires the vacancy when destination is 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not found", { status: 404 })));
    appResults.push([{ employer: "Acme", applyUrl: "https://acme.com/jobs/nurse-12345" }]);
    const app = buildApp();
    const res = await request(app)
      .get(`${base}?vacancyId=7&destinationUrl=${encodeURIComponent("https://acme.com/jobs/nurse-12345")}`)
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("JOB_EXPIRED");
  });

  it("returns 410 JOB_EXPIRED when body contains an expiration phrase", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><body>This vacancy has closed.</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ));
    appResults.push([{ employer: "Acme", applyUrl: "https://acme.com/jobs/nurse-12345" }]);
    const app = buildApp();
    const res = await request(app)
      .get(`${base}?vacancyId=7&destinationUrl=${encodeURIComponent("https://acme.com/jobs/nurse-12345")}`)
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("JOB_EXPIRED");
  });

  it("redirects 302 when the destination is live", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html><body>Apply now for this great role</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ));
    appResults.push([{ employer: "Acme", applyUrl: "https://acme.com/jobs/nurse-12345" }], []); // role lookup, no existing application
    const app = buildApp();
    const res = await request(app)
      .get(`${base}?vacancyId=7&destinationUrl=${encodeURIComponent("https://acme.com/jobs/nurse-12345")}`)
      .set("Authorization", `Bearer ${SESS}`)
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://acme.com/jobs/nurse-12345");
  });

  it("still redirects when the health check throws (network/bot-block)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ETIMEDOUT")));
    appResults.push([{ employer: "Acme", applyUrl: "https://acme.com/jobs/nurse-12345" }], []);
    const app = buildApp();
    const res = await request(app)
      .get(`${base}?vacancyId=7&destinationUrl=${encodeURIComponent("https://acme.com/jobs/nurse-12345")}`)
      .set("Authorization", `Bearer ${SESS}`)
      .redirects(0);
    expect(res.status).toBe(302);
  });
});

describe("PATCH /applications/:id/status", () => {
  beforeEach(() => { appResults.length = 0; });

  it("returns 401 when not authenticated", async () => {
    const { getSession } = await import("../../lib/auth");
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await request(app)
      .patch("/applications/1/status")
      .set("Authorization", "Bearer no-auth");
    expect(res.status).toBe(401);
  });
});
