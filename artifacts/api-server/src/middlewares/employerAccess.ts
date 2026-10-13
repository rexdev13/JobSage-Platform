import type { Request, Response, NextFunction } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  employerProfilesTable,
  employerMembershipsTable,
  employerJobAssignmentsTable,
} from "@workspace/db";
import {
  employerPathJobId,
  employerRoleCanAccessRoute,
  type EmployerStaffRole,
} from "../lib/employerPermissions";

export interface EmployerRequestContext {
  employerProfileId: number;
  ownerUserId: string;
  actingUserId: string;
  role: EmployerStaffRole;
}

const contexts = new WeakMap<Request, EmployerRequestContext>();

export function getEmployerContext(req: Request): EmployerRequestContext | undefined {
  return contexts.get(req);
}

export function requireEmployer() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.isAuthenticated() || !req.user) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }
    if (req.isImpersonating) {
      res.status(403).json({ error: "Employer organisation access is unavailable during impersonation." });
      return;
    }

    try {
      const actorId = req.user.id;
      const ownerProfiles = await db.select({
        employerProfileId: employerProfilesTable.id,
        ownerUserId: employerProfilesTable.userId,
      }).from(employerProfilesTable).where(and(
        eq(employerProfilesTable.userId, actorId),
        isNull(employerProfilesTable.deletedAt),
      ));

      const memberships = await db.select({
        employerProfileId: employerProfilesTable.id,
        ownerUserId: employerProfilesTable.userId,
        role: employerMembershipsTable.role,
      }).from(employerMembershipsTable)
        .innerJoin(employerProfilesTable, eq(employerProfilesTable.id, employerMembershipsTable.employerProfileId))
        .where(and(
          eq(employerMembershipsTable.userId, actorId),
          eq(employerMembershipsTable.status, "active"),
          isNull(employerProfilesTable.deletedAt),
        ));

      const organizations = new Map<number, { employerProfileId: number; ownerUserId: string; role: EmployerStaffRole }>();
      for (const profile of ownerProfiles) {
        organizations.set(profile.employerProfileId, {
          ...profile,
          role: "employer_owner",
        });
      }
      for (const membership of memberships) {
        if (!organizations.has(membership.employerProfileId)) {
          organizations.set(membership.employerProfileId, {
            employerProfileId: membership.employerProfileId,
            ownerUserId: membership.ownerUserId,
            role: membership.role as EmployerStaffRole,
          });
        }
      }

      const available = [...organizations.values()];
      if (available.length === 0) {
        res.status(403).json({ error: "No active employer organisation membership was found." });
        return;
      }

      const rawCookie = req.get("cookie") ?? "";
      const cookieMatch = rawCookie.match(/(?:^|;\s*)jobsage-employer-context=(\d+)/);
      const requestedValue = req.get("x-jobsage-employer-profile-id") ?? cookieMatch?.[1];
      const requestedId = Number(requestedValue);
      const context = Number.isInteger(requestedId) && requestedId > 0
        ? organizations.get(requestedId)
        : available.length === 1 ? available[0] : undefined;
      if (!context) {
        res.status(409).json({ error: "Choose an employer organisation before continuing.", organizations: available.map(org => ({
          id: org.employerProfileId,
          role: org.role,
        })) });
        return;
      }

      if (!employerRoleCanAccessRoute(context.role, req.method, req.path)) {
        res.status(403).json({ error: "This employer action is not available to staff members." });
        return;
      }

      if (req.path === "/employer/profile" && context.role !== "employer_owner" && context.role !== "employer_admin") {
        res.status(403).json({ error: "Only the owner or an organisation admin can view organisation settings." });
        return;
      }
      if (["recruiter", "hiring_manager", "employer_viewer"].includes(context.role)) {
        if (req.path === "/employer/candidates" || req.path === "/employer/talent-search"
          || req.path.startsWith("/employer/candidates/")) {
          res.status(403).json({ error: "This action requires an assigned job." });
          return;
        }
        let jobId = employerPathJobId(req.path);
        if (req.path === "/employer/contact-candidate") {
          const rawJobId = req.body?.vacancyId;
          jobId = Number.isInteger(Number(rawJobId)) ? Number(rawJobId) : null;
        }
        if (jobId !== null) {
          const [assignment] = await db.select({ id: employerJobAssignmentsTable.id })
            .from(employerJobAssignmentsTable)
            .where(and(
              eq(employerJobAssignmentsTable.employerProfileId, context.employerProfileId),
              eq(employerJobAssignmentsTable.jobListingId, jobId),
              eq(employerJobAssignmentsTable.userId, actorId),
            ));
          if (!assignment) {
            res.status(403).json({ error: "This job is not assigned to your account." });
            return;
          }
        }
        if (req.path === "/employer/contact-candidate" && jobId === null) {
          res.status(403).json({ error: "Messages from staff accounts must reference an assigned job." });
          return;
        }
      }

      contexts.set(req, { ...context, actingUserId: actorId });
      if (!requestedValue && available.length === 1) {
        res.cookie("jobsage-employer-context", String(context.employerProfileId), {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
