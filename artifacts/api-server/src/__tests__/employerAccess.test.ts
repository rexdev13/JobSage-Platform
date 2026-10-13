import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { requireEmployer } from "../middlewares/employerAccess";

const { queryResults, dbSelect } = vi.hoisted(() => ({
  queryResults: [] as unknown[][],
  dbSelect: vi.fn(),
}));

vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");
  const makeChain = () => {
    const chain: any = {
      from() { return chain; },
      innerJoin() { return chain; },
      where() { return chain; },
      then(resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) {
        return Promise.resolve(queryResults.shift() ?? []).then(resolve, reject);
      },
    };
    return chain;
  };
  dbSelect.mockImplementation(() => makeChain());
  return { ...schema, db: { select: dbSelect } };
});

function makeRequest({
  id = "staff-1",
  role = "candidate",
  method = "GET",
  path = "/employer/jobs",
  cookie = "",
  impersonating = false,
}: {
  id?: string;
  role?: string;
  method?: string;
  path?: string;
  cookie?: string;
  impersonating?: boolean;
} = {}) {
  return {
    isAuthenticated: () => true,
    isImpersonating: impersonating,
    user: { id, role },
    method,
    path,
    body: {},
    get: (name: string) => name.toLowerCase() === "cookie" ? cookie : undefined,
  } as unknown as Request;
}

async function invoke(request: Request) {
  const response = {
    status: vi.fn(function (this: any) { return this; }),
    json: vi.fn(),
    cookie: vi.fn(),
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  await requireEmployer()(request, response, next);
  return { response, next };
}

describe("requireEmployer organization and assignment checks", () => {
  beforeEach(() => {
    queryResults.length = 0;
    dbSelect.mockClear();
  });

  it("allows a candidate account only through its active hiring-manager membership and job assignment", async () => {
    queryResults.push(
      [],
      [{ employerProfileId: 44, ownerUserId: "owner-1", role: "hiring_manager" }],
      [{ id: 9 }],
    );
    const { response, next } = await invoke(makeRequest({
      id: "staff-1",
      role: "candidate",
      path: "/employer/jobs/17/applicants",
      cookie: "jobsage-employer-context=44",
    }));
    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });

  it("rejects staff access to a job that is not assigned to their account", async () => {
    queryResults.push(
      [],
      [{ employerProfileId: 44, ownerUserId: "owner-1", role: "recruiter" }],
      [],
    );
    const { response, next } = await invoke(makeRequest({
      path: "/employer/jobs/17/applicants",
      cookie: "jobsage-employer-context=44",
    }));
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ error: "This job is not assigned to your account." });
    expect(next).not.toHaveBeenCalled();
  });

  it("does not accept a selected organisation outside the actor's memberships", async () => {
    queryResults.push(
      [{ employerProfileId: 44, ownerUserId: "staff-1" }],
      [],
    );
    const { response, next } = await invoke(makeRequest({
      id: "staff-1",
      role: "employer",
      cookie: "jobsage-employer-context=45",
    }));
    expect(response.status).toHaveBeenCalledWith(409);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects accounts without an active employer membership", async () => {
    queryResults.push([], []);
    const { response, next } = await invoke(makeRequest());
    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks employer access during impersonation without querying memberships", async () => {
    const { response, next } = await invoke(makeRequest({ impersonating: true }));
    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it("applies the staff-operation role matrix through the real employer middleware", async () => {
    const operations = [
      { method: "GET", path: "/employer/staff" },
      { method: "POST", path: "/employer/staff/invitations" },
      { method: "PUT", path: "/employer/staff/member-1/role" },
      { method: "DELETE", path: "/employer/staff/member-1" },
      { method: "PUT", path: "/employer/staff/assignments" },
      { method: "POST", path: "/employer/staff/transfer-ownership", ownerOnly: true },
      { method: "POST", path: "/employer/staff/delete-organization", ownerOnly: true },
    ];
    const roles = ["employer_owner", "employer_admin", "recruiter", "hiring_manager", "employer_viewer"] as const;

    for (const role of roles) {
      for (const operation of operations) {
        queryResults.push([], [{ employerProfileId: 44, ownerUserId: "owner-1", role }]);
        const { response, next } = await invoke(makeRequest({
          role: "candidate",
          method: operation.method,
          path: operation.path,
          cookie: "jobsage-employer-context=44",
        }));
        const allowed = role === "employer_owner"
          || role === "employer_admin" && !operation.ownerOnly;
        if (allowed) {
          expect(next, `${role} should be allowed to ${operation.method} ${operation.path}`).toHaveBeenCalledOnce();
          expect(response.status).not.toHaveBeenCalled();
        } else {
          expect(response.status, `${role} should be denied ${operation.method} ${operation.path}`).toHaveBeenCalledWith(403);
          expect(next).not.toHaveBeenCalled();
        }
      }
    }
  });
});
