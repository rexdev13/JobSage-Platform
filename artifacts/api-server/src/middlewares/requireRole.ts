import type { Request, Response, NextFunction } from "express";

export type AppRole = "candidate" | "admin" | "reviewer";

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
