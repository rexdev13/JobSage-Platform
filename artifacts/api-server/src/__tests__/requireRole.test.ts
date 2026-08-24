import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { requireAuthenticated, requireRole } from "../middlewares/requireRole";

function makeReq(overrides: Record<string, unknown> = {}): Request {
  const req = {
    isAuthenticated: () => false,
    isImpersonating: false,
    method: "GET",
    user: undefined,
    ...overrides,
  } as unknown as Request;
  return req;
}

function makeRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

describe("requireAuthenticated", () => {
  it("calls next() when user is authenticated", () => {
    const next: NextFunction = vi.fn();
    const req = makeReq({
      isAuthenticated: () => true,
      user: { id: "u1", email: "a@b.com", role: "candidate" } as unknown as Express.User,
    });
    const { res } = makeRes();
    requireAuthenticated(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 401 when not authenticated", () => {
    const next: NextFunction = vi.fn();
    const { res, status, json } = makeRes();
    requireAuthenticated(makeReq(), res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "Not authenticated." });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 for write operations during impersonation", () => {
    const next: NextFunction = vi.fn();
    const req = makeReq({
      isAuthenticated: () => true,
      isImpersonating: true,
      method: "POST",
      user: { id: "u1", role: "candidate" } as unknown as Express.User,
    });
    const { res, status, json } = makeRes();
    requireAuthenticated(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: "Write operations are not permitted during impersonation." });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows GET during impersonation", () => {
    const next: NextFunction = vi.fn();
    const req = makeReq({
      isAuthenticated: () => true,
      isImpersonating: true,
      method: "GET",
      user: { id: "u1", role: "candidate" } as unknown as Express.User,
    });
    const { res } = makeRes();
    requireAuthenticated(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 for marketing accounts on candidate-facing routes", () => {
    const next: NextFunction = vi.fn();
    const req = makeReq({
      isAuthenticated: () => true,
      method: "GET",
      user: { id: "marketing-1", role: "marketing" } as unknown as Express.User,
    });
    const { res, status, json } = makeRes();
    requireAuthenticated(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: "Marketing accounts may only access leads management." });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requireRole", () => {
  it("calls next() when user has the required role", () => {
    const next: NextFunction = vi.fn();
    const req = makeReq({
      isAuthenticated: () => true,
      method: "GET",
      user: { id: "u1", role: "admin" } as unknown as Express.User,
    });
    const { res } = makeRes();
    requireRole("admin")(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 401 when user is not authenticated", () => {
    const next: NextFunction = vi.fn();
    const { res, status, json } = makeRes();
    requireRole("admin")(makeReq(), res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "Not authenticated." });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when user has wrong role", () => {
    const next: NextFunction = vi.fn();
    const req = makeReq({
      isAuthenticated: () => true,
      method: "GET",
      user: { id: "u1", role: "candidate" } as unknown as Express.User,
    });
    const { res, status, json } = makeRes();
    requireRole("admin")(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("admin") }));
    expect(next).not.toHaveBeenCalled();
  });

  it("allows any of multiple allowed roles", () => {
    const next: NextFunction = vi.fn();
    const req = makeReq({
      isAuthenticated: () => true,
      method: "GET",
      user: { id: "u1", role: "reviewer" } as unknown as Express.User,
    });
    const { res } = makeRes();
    requireRole("admin", "reviewer")(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 for impersonation on POST", () => {
    const next: NextFunction = vi.fn();
    const req = makeReq({
      isAuthenticated: () => true,
      isImpersonating: true,
      method: "POST",
      user: { id: "u1", role: "admin" } as unknown as Express.User,
    });
    const { res, status } = makeRes();
    requireRole("admin")(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when role is null", () => {
    const next: NextFunction = vi.fn();
    const req = makeReq({
      isAuthenticated: () => true,
      method: "GET",
      user: { id: "u1", role: null } as unknown as Express.User,
    });
    const { res, status } = makeRes();
    requireRole("admin")(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
