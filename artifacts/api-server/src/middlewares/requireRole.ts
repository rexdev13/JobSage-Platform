import type { Request, Response, NextFunction } from "express";

export type AppRole = "candidate" | "admin" | "reviewer" | "employer" | "super_admin" | "marketing";

/**
 * Middleware for candidate-facing routes. Marketing accounts are deliberately
 * excluded because their role is limited to the leads-management surface.
 */
export function requireAuthenticated(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  if (req.isImpersonating && req.method !== "GET") {
    res.status(403).json({ error: "Write operations are not permitted during impersonation." });
    return;
  }
  if ((req.user as { role?: string | null } | undefined)?.role === "marketing") {
    res.status(403).json({ error: "Marketing accounts may only access leads management." });
    return;
  }
  next();
}

/**
 * Unified role-gating middleware factory.
 * Pass one or more allowed roles — the request proceeds if the authenticated user has any of them.
 */
export function requireRole(...allowedRoles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }
    if (req.isImpersonating && req.method !== "GET") {
      res.status(403).json({ error: "Write operations are not permitted during impersonation." });
      return;
    }
    const role = (req.user as { role?: string | null }).role;
    if (!role || !allowedRoles.includes(role as AppRole)) {
      res.status(403).json({
        error: `Access denied. Required role(s): ${allowedRoles.join(", ")}.`,
      });
      return;
    }
    next();
  };
}
