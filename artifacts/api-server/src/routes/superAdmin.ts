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
import { createSession, getSession, SESSION_COOKIE } from "../lib/auth";
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

    const [profileCount] = await db.select({ cnt: count(profilesTable.id) }).from(profilesTable);

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
        case "email": return dir(usersTable.email);
        case "role": return dir(usersTable.role);
        case "emailVerified": return dir(usersTable.emailVerified);
        case "updatedAt": case "lastLogin": return dir(usersTable.updatedAt);
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
        lastLogin: usersTable.updatedAt,
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
  "/admin/super/impersonate/activate",
  async (req: Request, res: Response): Promise<void> => {
    const token = (req.query["token"] as string) ?? "";
    if (!token) {
      res.status(400).json({ error: "Token required." });
      return;
    }

    const session = await getSession(token);
    if (!session?.user?.id || !session.impersonating) {
      res.status(401).json({ error: "Invalid or expired impersonation token." });
      return;
    }

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 15 * 60 * 1000,
    });

    res.json({
      user: session.user,
      adminId: session.adminId ?? null,
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
    .where(eq(auditEventsTable.target, userId))
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

  return {
    user: { ...user, lastLogin: user.updatedAt },
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

export default router;
