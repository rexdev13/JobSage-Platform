import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  db,
  usersTable,
  auditEventsTable,
  profilesTable,
  documentsTable,
  applicationsTable,
  consentLogsTable,
  sponsorLicencesTable,
  sponsorLicenceSyncLogTable,
  decisionRecordsTable,
  employerProfilesTable,
  jobListingsTable,
  rolesTable,
} from "@workspace/db";
import { eq, and, desc, gte, lte, count, max, ilike, sql, asc } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";
import { writeAuditEvent } from "../lib/audit";
import { createSession, getSession, deleteSession, updateSession, getSessionId } from "../lib/auth";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

router.get(
  "/admin/super/stats",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    writeAuditEvent(req.user!.id, "super_admin_view_stats").catch(() => {});

    const usersByRoleRows = await db
      .select({ role: usersTable.role, cnt: count(usersTable.id) })
      .from(usersTable)
      .groupBy(usersTable.role);

    const [profileCount] = await db
      .select({ cnt: count(profilesTable.id) })
      .from(profilesTable)
      .innerJoin(usersTable, eq(profilesTable.userId, usersTable.id))
      .where(
        and(
          eq(usersTable.role, "candidate"),
          sql`${profilesTable.profession} IS NOT NULL`,
          sql`${profilesTable.specialty} IS NOT NULL`,
          sql`${profilesTable.qualificationCountry} IS NOT NULL`,
          sql`${profilesTable.registrationStatus} IS NOT NULL`,
        ),
      );

    const [activeJobsCount] = await db
      .select({ cnt: count(jobListingsTable.id) })
      .from(jobListingsTable)
      .where(eq(jobListingsTable.status, "published"));

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [weeklyApps] = await db
      .select({ cnt: count(applicationsTable.id) })
      .from(applicationsTable)
      .where(gte(applicationsTable.appliedAt, oneWeekAgo));

    const [sponsorCount] = await db.select({ cnt: count(sponsorLicencesTable.id) }).from(sponsorLicencesTable);

    const [lastSync] = await db
      .select({ lastSync: max(sponsorLicencesTable.syncedAt) })
      .from(sponsorLicencesTable);

    const [totalUsers] = await db.select({ cnt: count(usersTable.id) }).from(usersTable);

    const roleMap: Record<string, number> = {};
    for (const r of usersByRoleRows) roleMap[r.role] = Number(r.cnt);

    res.json({
      totalUsers: Number(totalUsers?.cnt ?? 0),
      usersByRole: roleMap,
      completedProfiles: Number(profileCount?.cnt ?? 0),
      activeJobs: Number(activeJobsCount?.cnt ?? 0),
      applicationsThisWeek: Number(weeklyApps?.cnt ?? 0),
      sponsorLicences: Number(sponsorCount?.cnt ?? 0),
      lastSponsorSync: lastSync?.lastSync ?? null,
    });
  },
);

router.get(
  "/admin/super/users",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    writeAuditEvent(req.user!.id, "super_admin_view_users").catch(() => {});

    const {
      role,
      verified,
      search,
      sortBy = "createdAt",
      sortDir = "desc",
      page: pageStr = "1",
      dateFrom,
      dateTo,
    } = req.query as Record<string, string | undefined>;

    const PAGE_SIZE = 25;
    const pageNum = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
    const offset = (pageNum - 1) * PAGE_SIZE;

    const whereClause = and(
      role ? eq(usersTable.role, role as "candidate" | "admin" | "reviewer" | "employer" | "super_admin") : undefined,
      verified === "true" ? eq(usersTable.emailVerified, true) : undefined,
      verified === "false" ? eq(usersTable.emailVerified, false) : undefined,
      search ? ilike(usersTable.email, `%${search}%`) : undefined,
      dateFrom ? gte(usersTable.createdAt, new Date(dateFrom)) : undefined,
      dateTo ? lte(usersTable.createdAt, new Date(dateTo)) : undefined,
    );

    const docCountExpr = sql<number>`(SELECT COUNT(*) FROM documents WHERE user_id = ${usersTable.id})`;
    const appCountExpr = sql<number>`(SELECT COUNT(*) FROM applications WHERE user_id = ${usersTable.id})`;
    const profileCompExpr = sql<number>`COALESCE((SELECT
      (CASE WHEN profession IS NOT NULL THEN 25 ELSE 0 END +
       CASE WHEN specialty IS NOT NULL THEN 25 ELSE 0 END +
       CASE WHEN qualification_country IS NOT NULL THEN 25 ELSE 0 END +
       CASE WHEN registration_status IS NOT NULL THEN 25 ELSE 0 END)
      FROM profiles WHERE user_id = ${usersTable.id}), 0)`;
    const eligibilityExpr = sql<string | null>`(SELECT outcome FROM decision_records WHERE user_id = ${usersTable.id} ORDER BY created_at DESC LIMIT 1)`;
    const hasConsentedExpr = sql<boolean>`EXISTS(SELECT 1 FROM consent_logs WHERE user_id = ${usersTable.id})`;
    const consentedAtExpr = sql<string | null>`(SELECT consented_at FROM consent_logs WHERE user_id = ${usersTable.id} ORDER BY consented_at DESC LIMIT 1)`;

    const dir = (sortDir ?? "desc") === "asc" ? asc : desc;
    const orderExpr = (() => {
      switch (sortBy) {
        case "id": return dir(usersTable.id);
        case "email": return dir(usersTable.email);
        case "role": return dir(usersTable.role);
        case "emailVerified": return dir(usersTable.emailVerified);
        case "updatedAt": return dir(usersTable.updatedAt);
        case "lastLogin": return dir(sql`(SELECT max(created_at) FROM audit_events WHERE actor = ${usersTable.id} AND action = 'user_login')`);
        case "documentCount": return dir(docCountExpr);
        case "applicationCount": return dir(appCountExpr);
        case "profileCompletion": return dir(profileCompExpr);
        case "eligibilityStatus": return dir(eligibilityExpr);
        case "hasConsented": return dir(hasConsentedExpr);
        default: return dir(usersTable.createdAt);
      }
    })();

    const users = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        role: usersTable.role,
        emailVerified: usersTable.emailVerified,
        createdAt: usersTable.createdAt,
        updatedAt: usersTable.updatedAt,
        suspendedAt: usersTable.suspendedAt,
        lastLogin: sql<string | null>`(SELECT max(created_at) FROM audit_events WHERE actor = ${usersTable.id} AND action = 'user_login')`,
        documentCount: docCountExpr,
        applicationCount: appCountExpr,
        profileCompletion: profileCompExpr,
        eligibilityStatus: eligibilityExpr,
        hasConsented: hasConsentedExpr,
        consentedAt: consentedAtExpr,
      })
      .from(usersTable)
      .where(whereClause)
      .orderBy(orderExpr)
      .limit(PAGE_SIZE)
      .offset(offset);

    const [totalRow] = await db
      .select({ cnt: count(usersTable.id) })
      .from(usersTable)
      .where(whereClause);

    res.json({ users, total: Number(totalRow?.cnt ?? 0), page: pageNum, pageSize: PAGE_SIZE });
  },
);

router.get(
  "/admin/super/users/:id/full",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const targetId = req.params["id"] as string;
    writeAuditEvent(req.user!.id, "super_admin_view_user_detail", targetId).catch(() => {});

    const fullDetail = await fetchUserFull(targetId);
    if (!fullDetail) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    res.json(fullDetail);
  },
);

router.get(
  "/admin/super/impersonate/activate",
  async (req: Request, res: Response): Promise<void> => {
    const token = (req.query["token"] as string) ?? "";
    if (!token) {
      res.status(400).json({ error: "Token required." });
      return;
    }

    const impSession = await getSession(token);
    if (!impSession?.user?.id || !impSession.impersonating) {
      res.status(401).json({ error: "Invalid or expired impersonation token." });
      return;
    }

    const adminSid = getSessionId(req);
    if (!adminSid) {
      res.status(401).json({ error: "Admin session required." });
      return;
    }
    const adminSession = await getSession(adminSid);
    if (!adminSession?.user?.id || adminSession.user.role !== "super_admin") {
      res.status(403).json({ error: "Only super admins can activate impersonation." });
      return;
    }

    await updateSession(adminSid, { ...adminSession, impersonatingUserId: impSession.user.id });
    await deleteSession(token);

    res.json({
      user: impSession.user,
      adminId: adminSession.user.id,
    });
  },
);

router.post(
  "/admin/super/impersonate/stop",
  async (req: Request, res: Response): Promise<void> => {
    const sid = getSessionId(req);
    if (!sid) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }
    const session = await getSession(sid);
    if (!session?.user?.id) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }
    if (!session.impersonatingUserId) {
      res.status(400).json({ error: "Not currently impersonating." });
      return;
    }
    await updateSession(sid, { user: session.user });
    writeAuditEvent(session.user.id, "super_admin_impersonate_stop").catch(() => {});
    res.json({ ok: true });
  },
);

router.post(
  "/admin/super/impersonate/:id",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const targetId = req.params["id"] as string;
    const actorId = req.user!.id;

    const [targetUser] = await db
      .select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName, role: usersTable.role, emailVerified: usersTable.emailVerified })
      .from(usersTable)
      .where(eq(usersTable.id, targetId));

    if (!targetUser) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const IMPERSONATE_TTL = 15 * 60 * 1000;
    const sid = await createSession(
      {
        user: {
          id: targetUser.id,
          email: targetUser.email,
          firstName: targetUser.firstName,
          lastName: targetUser.lastName,
          role: targetUser.role as import("@workspace/api-zod").AuthUserRole,
          emailVerified: targetUser.emailVerified,
        },
        impersonating: true,
        adminId: actorId,
      },
      IMPERSONATE_TTL,
    );

    writeAuditEvent(actorId, "super_admin_impersonate", targetId, { targetEmail: targetUser.email }).catch(() => {});

    const expiresAt = new Date(Date.now() + IMPERSONATE_TTL);
    res.json({
      token: sid,
      expiresAt,
      targetUser: {
        id: targetUser.id,
        email: targetUser.email,
        displayName: [targetUser.firstName, targetUser.lastName].filter(Boolean).join(" ") || targetUser.email,
        role: targetUser.role,
      },
    });
  },
);

router.get(
  "/admin/super/health",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    writeAuditEvent(req.user!.id, "super_admin_view_health").catch(() => {});

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const dailyRegistrations = await db
      .select({
        date: sql<string>`DATE(${usersTable.createdAt})`.as("date"),
        count: count(usersTable.id),
      })
      .from(usersTable)
      .where(gte(usersTable.createdAt, thirtyDaysAgo))
      .groupBy(sql`DATE(${usersTable.createdAt})`)
      .orderBy(sql`DATE(${usersTable.createdAt})`);

    const dailyApplications = await db
      .select({
        date: sql<string>`DATE(${applicationsTable.appliedAt})`.as("date"),
        count: count(applicationsTable.id),
      })
      .from(applicationsTable)
      .where(gte(applicationsTable.appliedAt, thirtyDaysAgo))
      .groupBy(sql`DATE(${applicationsTable.appliedAt})`)
      .orderBy(sql`DATE(${applicationsTable.appliedAt})`);

    const syncLog = await db
      .select()
      .from(sponsorLicenceSyncLogTable)
      .orderBy(desc(sponsorLicenceSyncLogTable.createdAt))
      .limit(10);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [errorAuditCount] = await db
      .select({ cnt: count(auditEventsTable.id) })
      .from(auditEventsTable)
      .where(
        and(
          eq(auditEventsTable.action, "api_error_5xx"),
          gte(auditEventsTable.createdAt, sevenDaysAgo),
        ),
      );

    const dailyActiveUsers = await db
      .select({
        date: sql<string>`DATE(${auditEventsTable.createdAt})`.as("date"),
        count: sql<number>`COUNT(DISTINCT ${auditEventsTable.actor})`,
      })
      .from(auditEventsTable)
      .where(gte(auditEventsTable.createdAt, thirtyDaysAgo))
      .groupBy(sql`DATE(${auditEventsTable.createdAt})`)
      .orderBy(sql`DATE(${auditEventsTable.createdAt})`);

    res.json({
      dailyRegistrations: dailyRegistrations.map((r) => ({ date: r.date, count: Number(r.count) })),
      dailyApplications: dailyApplications.map((r) => ({ date: r.date, count: Number(r.count) })),
      dailyActiveUsers: dailyActiveUsers.map((r) => ({ date: r.date, count: Number(r.count) })),
      syncLog,
      serverErrors5xxLast7Days: Number(errorAuditCount?.cnt ?? 0),
    });
  },
);

async function fetchUserFull(userId: string) {
  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      role: usersTable.role,
      emailVerified: usersTable.emailVerified,
      createdAt: usersTable.createdAt,
      updatedAt: usersTable.updatedAt,
      suspendedAt: usersTable.suspendedAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user) return null;

  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId));
  const [employerProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));

  const documents = await db
    .select({ id: documentsTable.id, fileName: documentsTable.filename, fileType: documentsTable.mimeType, storageKey: documentsTable.storageKey, uploadedAt: documentsTable.uploadedAt })
    .from(documentsTable)
    .where(eq(documentsTable.userId, userId))
    .orderBy(desc(documentsTable.uploadedAt));

  const applications = await db
    .select({
      id: applicationsTable.id,
      roleId: applicationsTable.roleId,
      status: applicationsTable.status,
      appliedAt: applicationsTable.appliedAt,
      notes: applicationsTable.notes,
      roleTitle: rolesTable.title,
      roleEmployer: rolesTable.employer,
    })
    .from(applicationsTable)
    .leftJoin(rolesTable, eq(applicationsTable.roleId, rolesTable.id))
    .where(eq(applicationsTable.userId, userId))
    .orderBy(desc(applicationsTable.appliedAt));

  const eligibilityHistory = await db
    .select({ id: decisionRecordsTable.id, outcome: decisionRecordsTable.outcome, createdAt: decisionRecordsTable.createdAt })
    .from(decisionRecordsTable)
    .where(eq(decisionRecordsTable.userId, userId))
    .orderBy(desc(decisionRecordsTable.createdAt))
    .limit(10);

  const auditEvents = await db
    .select({
      id: auditEventsTable.id,
      actor: auditEventsTable.actor,
      action: auditEventsTable.action,
      target: auditEventsTable.target,
      details: auditEventsTable.details,
      createdAt: auditEventsTable.createdAt,
    })
    .from(auditEventsTable)
    .where(eq(auditEventsTable.actor, userId))
    .orderBy(desc(auditEventsTable.createdAt))
    .limit(20);

  const [consent] = await db
    .select()
    .from(consentLogsTable)
    .where(eq(consentLogsTable.userId, userId))
    .orderBy(desc(consentLogsTable.consentedAt))
    .limit(1);

  const [latestDecision] = await db
    .select({ outcome: decisionRecordsTable.outcome, createdAt: decisionRecordsTable.createdAt })
    .from(decisionRecordsTable)
    .where(eq(decisionRecordsTable.userId, userId))
    .orderBy(desc(decisionRecordsTable.createdAt))
    .limit(1);

  const [lastLoginRow] = await db
    .select({ lastLogin: max(auditEventsTable.createdAt) })
    .from(auditEventsTable)
    .where(and(eq(auditEventsTable.actor, userId), eq(auditEventsTable.action, "user_login")));

  return {
    user: { ...user, lastLogin: lastLoginRow?.lastLogin ?? null },
    profile: profile ?? null,
    employerProfile: employerProfile ?? null,
    documents,
    applications,
    eligibilityHistory,
    auditEvents,
    consent: consent ?? null,
    latestDecision: latestDecision ?? null,
  };
}

/**
 * GET /admin/super/documents
 *
 * Privileged document download for super admins. Bypasses per-user ACL checks.
 * Query param: storageKey (e.g. /objects/uploads/...)
 */
router.get(
  "/admin/super/documents",
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const storageKey = req.query.storageKey as string | undefined;
    if (!storageKey || !storageKey.startsWith("/objects/")) {
      res.status(400).json({ error: "Missing or invalid storageKey" });
      return;
    }
    try {
      writeAuditEvent(req.user!.id, "super_admin_document_download", undefined, { storageKey }).catch(() => {});
      const objectFile = await objectStorageService.getObjectEntityFile(storageKey);
      const response = await objectStorageService.downloadObject(objectFile);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) {
        const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      res.status(500).json({ error: "Failed to serve document" });
    }
  },
);

// ── Account management actions ───────────────────────────────────────────────

router.post(
  "/admin/super/users/:id/suspend",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const targetId = req.params["id"] as string;
    const actorId = req.user!.id;

    if (targetId === actorId) {
      res.status(400).json({ error: "You cannot suspend your own account." });
      return;
    }

    const [user] = await db.select({ id: usersTable.id, email: usersTable.email, role: usersTable.role, suspendedAt: usersTable.suspendedAt })
      .from(usersTable).where(eq(usersTable.id, targetId));
    if (!user) { res.status(404).json({ error: "User not found." }); return; }
    if (user.suspendedAt) { res.status(409).json({ error: "Account is already suspended." }); return; }
    if (user.role === "super_admin") { res.status(403).json({ error: "Cannot suspend another super admin." }); return; }

    const [updated] = await db.update(usersTable).set({ suspendedAt: new Date() }).where(eq(usersTable.id, targetId)).returning();
    writeAuditEvent(actorId, "super_admin_suspend_user", targetId, { email: user.email }).catch(() => {});
    res.json(updated);
  },
);

router.post(
  "/admin/super/users/:id/restore",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const targetId = req.params["id"] as string;
    const actorId = req.user!.id;

    const [user] = await db.select({ id: usersTable.id, email: usersTable.email, suspendedAt: usersTable.suspendedAt })
      .from(usersTable).where(eq(usersTable.id, targetId));
    if (!user) { res.status(404).json({ error: "User not found." }); return; }
    if (!user.suspendedAt) { res.status(409).json({ error: "Account is not suspended." }); return; }

    const [updated] = await db.update(usersTable).set({ suspendedAt: null }).where(eq(usersTable.id, targetId)).returning();
    writeAuditEvent(actorId, "super_admin_restore_user", targetId, { email: user.email }).catch(() => {});
    res.json(updated);
  },
);

router.delete(
  "/admin/super/users/:id",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const targetId = req.params["id"] as string;
    const actorId = req.user!.id;

    if (targetId === actorId) {
      res.status(400).json({ error: "You cannot delete your own account." });
      return;
    }

    const [user] = await db.select({ id: usersTable.id, email: usersTable.email, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, targetId));
    if (!user) { res.status(404).json({ error: "User not found." }); return; }
    if (user.role === "super_admin") { res.status(403).json({ error: "Cannot delete another super admin account." }); return; }

    writeAuditEvent(actorId, "super_admin_delete_user", targetId, { email: user.email }).catch(() => {});
    await db.delete(usersTable).where(eq(usersTable.id, targetId));
    res.json({ deleted: true, id: targetId });
  },
);

router.patch(
  "/admin/super/users/:id/role",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const targetId = req.params["id"] as string;
    const actorId = req.user!.id;
    const { role } = req.body as { role?: string };

    const VALID_ROLES = ["candidate", "employer", "reviewer", "admin", "super_admin"] as const;
    type AppRole = typeof VALID_ROLES[number];
    if (!role || !(VALID_ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}.` });
      return;
    }

    if (targetId === actorId && role !== "super_admin") {
      res.status(400).json({ error: "You cannot demote your own super admin account." });
      return;
    }

    const [user] = await db.select({ id: usersTable.id, email: usersTable.email, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, targetId));
    if (!user) { res.status(404).json({ error: "User not found." }); return; }

    const [updated] = await db.update(usersTable).set({ role: role as AppRole }).where(eq(usersTable.id, targetId)).returning();
    writeAuditEvent(actorId, "super_admin_change_role", targetId, { email: user.email, fromRole: user.role, toRole: role }).catch(() => {});
    res.json(updated);
  },
);

// ── Job listings management ───────────────────────────────────────────────────

router.get(
  "/admin/super/job-listings",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    writeAuditEvent(req.user!.id, "super_admin_view_job_listings").catch(() => {});

    const { search, status, page: pageStr = "1" } = req.query as Record<string, string | undefined>;
    const PAGE_SIZE = 25;
    const pageNum = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
    const offset = (pageNum - 1) * PAGE_SIZE;

    const whereClause = and(
      status ? eq(jobListingsTable.status, status as "draft" | "published" | "closed") : undefined,
      search ? sql`(${jobListingsTable.title} ILIKE ${"%" + search + "%"} OR ${employerProfilesTable.companyName} ILIKE ${"%" + search + "%"})` : undefined,
    );

    const rows = await db
      .select({
        id: jobListingsTable.id,
        title: jobListingsTable.title,
        status: jobListingsTable.status,
        location: jobListingsTable.location,
        regulator: jobListingsTable.regulator,
        sponsorshipOffered: jobListingsTable.sponsorshipOffered,
        requiredRegistration: jobListingsTable.requiredRegistration,
        createdAt: jobListingsTable.createdAt,
        employerProfileId: jobListingsTable.employerProfileId,
        companyName: employerProfilesTable.companyName,
        employerUserId: employerProfilesTable.userId,
      })
      .from(jobListingsTable)
      .innerJoin(employerProfilesTable, eq(jobListingsTable.employerProfileId, employerProfilesTable.id))
      .where(whereClause)
      .orderBy(desc(jobListingsTable.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset);

    const [totalRow] = await db
      .select({ cnt: count(jobListingsTable.id) })
      .from(jobListingsTable)
      .innerJoin(employerProfilesTable, eq(jobListingsTable.employerProfileId, employerProfilesTable.id))
      .where(whereClause);

    res.json({ listings: rows, total: Number(totalRow?.cnt ?? 0), page: pageNum, pageSize: PAGE_SIZE });
  },
);

router.patch(
  "/admin/super/job-listings/:id",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }

    const { status } = req.body as { status?: string };
    const VALID = ["draft", "published", "closed"] as const;
    if (!status || !(VALID as readonly string[]).includes(status)) {
      res.status(400).json({ error: "status must be draft, published, or closed." });
      return;
    }

    const [listing] = await db.select({ id: jobListingsTable.id }).from(jobListingsTable).where(eq(jobListingsTable.id, id));
    if (!listing) { res.status(404).json({ error: "Job listing not found." }); return; }

    const [updated] = await db.update(jobListingsTable).set({ status: status as "draft" | "published" | "closed" }).where(eq(jobListingsTable.id, id)).returning();
    writeAuditEvent(req.user!.id, "super_admin_update_job_listing", String(id), { status }).catch(() => {});
    res.json(updated);
  },
);

router.delete(
  "/admin/super/job-listings/:id",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }

    const [listing] = await db.select({ id: jobListingsTable.id, title: jobListingsTable.title }).from(jobListingsTable).where(eq(jobListingsTable.id, id));
    if (!listing) { res.status(404).json({ error: "Job listing not found." }); return; }

    writeAuditEvent(req.user!.id, "super_admin_delete_job_listing", String(id), { title: listing.title }).catch(() => {});
    await db.delete(jobListingsTable).where(eq(jobListingsTable.id, id));
    res.json({ deleted: true, id });
  },
);

// ── Employer accounts ─────────────────────────────────────────────────────────

router.get(
  "/admin/super/employers",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    writeAuditEvent(req.user!.id, "super_admin_view_employers").catch(() => {});

    const { search, page: pageStr = "1" } = req.query as Record<string, string | undefined>;
    const PAGE_SIZE = 25;
    const pageNum = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
    const offset = (pageNum - 1) * PAGE_SIZE;

    const whereClause = search
      ? sql`(${employerProfilesTable.companyName} ILIKE ${"%" + search + "%"} OR ${usersTable.email} ILIKE ${"%" + search + "%"})`
      : undefined;

    const listingCountExpr = sql<number>`(SELECT COUNT(*) FROM job_listings WHERE employer_profile_id = ${employerProfilesTable.id})`;
    const publishedCountExpr = sql<number>`(SELECT COUNT(*) FROM job_listings WHERE employer_profile_id = ${employerProfilesTable.id} AND status = 'published')`;

    const rows = await db
      .select({
        id: employerProfilesTable.id,
        userId: employerProfilesTable.userId,
        companyName: employerProfilesTable.companyName,
        industry: employerProfilesTable.industry,
        region: employerProfilesTable.region,
        sponsorLicenceNumber: employerProfilesTable.sponsorLicenceNumber,
        createdAt: employerProfilesTable.createdAt,
        email: usersTable.email,
        userRole: usersTable.role,
        emailVerified: usersTable.emailVerified,
        totalListings: listingCountExpr,
        publishedListings: publishedCountExpr,
      })
      .from(employerProfilesTable)
      .innerJoin(usersTable, eq(employerProfilesTable.userId, usersTable.id))
      .where(whereClause)
      .orderBy(desc(employerProfilesTable.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset);

    const [totalRow] = await db
      .select({ cnt: count(employerProfilesTable.id) })
      .from(employerProfilesTable)
      .innerJoin(usersTable, eq(employerProfilesTable.userId, usersTable.id))
      .where(whereClause);

    res.json({ employers: rows, total: Number(totalRow?.cnt ?? 0), page: pageNum, pageSize: PAGE_SIZE });
  },
);

router.get(
  "/admin/super/employers/:id",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }

    writeAuditEvent(req.user!.id, "super_admin_view_employer_detail", String(id)).catch(() => {});

    const [employer] = await db
      .select()
      .from(employerProfilesTable)
      .innerJoin(usersTable, eq(employerProfilesTable.userId, usersTable.id))
      .where(eq(employerProfilesTable.id, id));

    if (!employer) { res.status(404).json({ error: "Employer not found." }); return; }

    const listings = await db
      .select()
      .from(jobListingsTable)
      .where(eq(jobListingsTable.employerProfileId, id))
      .orderBy(desc(jobListingsTable.createdAt));

    res.json({ employer: employer.employer_profiles, user: employer.users, listings });
  },
);

/**
 * POST /admin/super/sponsor-licences/sync  (legacy — kept for backward compat)
 * POST /admin/super/sync/trigger-register  (new — returns 202 immediately)
 */
router.post(
  "/admin/super/sponsor-licences/sync",
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    try {
      writeAuditEvent(req.user!.id, "super_admin_sponsor_sync", undefined, {}).catch(() => {});
      const { runSponsorLicenceSync } = await import("../lib/sponsorLicenceSync");
      await runSponsorLicenceSync("manual");
      const [row] = await db.select({ cnt: count(sponsorLicencesTable.id) }).from(sponsorLicencesTable);
      res.json({ success: true, recordCount: Number(row?.cnt ?? 0), syncedAt: new Date().toISOString() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  },
);

// ── Sync Management Endpoints ─────────────────────────────────────────────────

router.get(
  "/admin/super/sync/register-logs",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    writeAuditEvent(req.user!.id, "super_admin_view_sync_logs").catch(() => {});

    const logs = await db
      .select()
      .from(sponsorLicenceSyncLogTable)
      .orderBy(desc(sponsorLicenceSyncLogTable.createdAt))
      .limit(20);

    const lastSuccess = logs.find((l) => l.status === "success") ?? null;
    const lastFailure = logs.find((l) => l.status === "error") ?? null;

    res.json({ logs, lastSuccess, lastFailure });
  },
);

router.get(
  "/admin/super/sync/vacancy-logs",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const { vacancySyncLogTable } = await import("@workspace/db");
    writeAuditEvent(req.user!.id, "super_admin_view_vacancy_sync_logs").catch(() => {});

    const logs = await db
      .select()
      .from(vacancySyncLogTable)
      .orderBy(desc(vacancySyncLogTable.createdAt))
      .limit(20);

    const lastSuccess = logs.find((l) => l.status === "success") ?? null;
    const lastFailure = logs.find((l) => l.status === "error") ?? null;

    res.json({ logs, lastSuccess, lastFailure });
  },
);

router.post(
  "/admin/super/sync/trigger-register",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    writeAuditEvent(req.user!.id, "super_admin_trigger_register_sync", undefined, {}).catch(() => {});
    res.status(202).json({ queued: true });

    setImmediate(async () => {
      try {
        const { runSponsorLicenceSync } = await import("../lib/sponsorLicenceSync");
        await runSponsorLicenceSync("manual");
      } catch (err) {
        console.error("[admin-sync] Manual register sync failed:", err instanceof Error ? err.message : err);
      }
    });
  },
);

router.post(
  "/admin/super/sync/trigger-vacancy",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    writeAuditEvent(req.user!.id, "super_admin_trigger_vacancy_sync", undefined, {}).catch(() => {});
    res.status(202).json({ queued: true });

    setImmediate(async () => {
      try {
        const { runVacancyCheckBatch } = await import("../lib/vacancyCheckScheduler");
        await runVacancyCheckBatch("manual");
      } catch (err) {
        console.error("[admin-sync] Manual vacancy sync failed:", err instanceof Error ? err.message : err);
      }
    });
  },
);

/**
 * POST /admin/super/contact-backfill
 * Trigger a contact-extraction backfill for sponsors that have no contact info.
 * Bypasses the 24h vacancy-check cache so pre-feature checked sponsors get re-processed.
 * Pass { limit: N } in the request body to control batch size (default 200, max 2000).
 */
router.post(
  "/admin/super/contact-backfill",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    writeAuditEvent(req.user!.id, "super_admin_trigger_contact_backfill", undefined, {}).catch(() => {});
    const rawLimit = typeof req.body?.limit === "number" ? req.body.limit : 200;
    const limit = Math.max(1, Math.min(2000, rawLimit));
    res.status(202).json({ queued: true, limit });

    setImmediate(async () => {
      try {
        const { startContactBackfill } = await import("../lib/contactBackfillRunner");
        startContactBackfill(limit);
      } catch (err) {
        console.error("[admin] Contact backfill failed:", err instanceof Error ? err.message : err);
      }
    });
  },
);

/**
 * GET /admin/super/contact-backfill/status
 * Poll the progress of an in-flight (or completed) contact backfill run.
 */
router.get(
  "/admin/super/contact-backfill/status",
  requireRole("super_admin"),
  async (_req: Request, res: Response): Promise<void> => {
    const { getContactBackfillStatus } = await import("../lib/contactBackfillRunner");
    res.json(getContactBackfillStatus());
  },
);

/**
 * POST /admin/super/dedup-sponsor-licences
 * One-time utility: removes duplicate organisation_name rows from sponsor_licences,
 * keeping the highest id per name. Checks FK safety first (no bookmarks on
 * to-be-deleted rows). Remove this endpoint once production data is confirmed clean.
 */
router.post(
  "/admin/super/dedup-sponsor-licences",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    writeAuditEvent(req.user!.id, "super_admin_dedup_sponsor_licences", undefined, {}).catch(() => {});

    // Safety check: confirm no bookmarks point at rows that would be deleted
    const fkResult = await db.execute(sql`
      SELECT COUNT(*) AS bookmarks_on_duplicates
      FROM sponsor_licence_bookmarks slb
      JOIN sponsor_licences sl ON sl.id = slb.sponsor_licence_id
      WHERE sl.id NOT IN (
        SELECT MAX(id)
        FROM sponsor_licences
        GROUP BY organisation_name
      )
    `) as any;

    const fkRow = fkResult.rows?.[0] ?? fkResult[0];
    const bookmarksAtRisk = Number(fkRow?.bookmarks_on_duplicates ?? 0);
    if (bookmarksAtRisk > 0) {
      res.status(409).json({
        success: false,
        error: `Cannot dedup: ${bookmarksAtRisk} bookmark(s) point at duplicate rows that would be deleted. Resolve manually first.`,
      });
      return;
    }

    const result = await db.execute(sql`
      DELETE FROM sponsor_licences
      WHERE id NOT IN (
        SELECT MAX(id)
        FROM sponsor_licences
        GROUP BY organisation_name
      )
    `) as any;

    const deleted = Number(result.rowCount ?? 0);
    const [countRow] = await db.select({ cnt: count(sponsorLicencesTable.id) }).from(sponsorLicencesTable);
    const remaining = Number(countRow?.cnt ?? 0);

    console.log(`[admin-dedup] Deduped sponsor_licences: ${deleted} rows removed, ${remaining} remaining`);

    res.json({ success: true, deleted, remaining });
  },
);

export default router;
