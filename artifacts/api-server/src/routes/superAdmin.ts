import { Router, type IRouter, type Request, type Response } from "express";
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
} from "@workspace/db";
import { eq, and, desc, gte, count, max, ilike, sql, asc } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";
import { writeAuditEvent } from "../lib/audit";
import crypto from "crypto";

const router: IRouter = Router();

const impersonationTokens = new Map<string, { targetUserId: string; adminId: string; expiresAt: Date }>();

setInterval(() => {
  const now = new Date();
  for (const [token, data] of impersonationTokens) {
    if (data.expiresAt < now) impersonationTokens.delete(token);
  }
}, 5 * 60 * 1000);

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
    } = req.query as Record<string, string | undefined>;

    const PAGE_SIZE = 25;
    const pageNum = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
    const offset = (pageNum - 1) * PAGE_SIZE;

    const conditions: ReturnType<typeof eq>[] = [];
    if (role) conditions.push(eq(usersTable.role, role) as ReturnType<typeof eq>);
    if (verified === "true") conditions.push(eq(usersTable.emailVerified, true) as ReturnType<typeof eq>);
    if (verified === "false") conditions.push(eq(usersTable.emailVerified, false) as ReturnType<typeof eq>);
    if (search) conditions.push(ilike(usersTable.email, `%${search}%`) as ReturnType<typeof eq>);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const validSortCols: Record<string, typeof usersTable.createdAt | typeof usersTable.email | typeof usersTable.role> = {
      createdAt: usersTable.createdAt,
      email: usersTable.email,
      role: usersTable.role,
    };
    const sortCol = validSortCols[sortBy ?? "createdAt"] ?? usersTable.createdAt;
    const orderExpr = sortDir === "asc" ? asc(sortCol) : desc(sortCol);

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
      })
      .from(usersTable)
      .where(whereClause)
      .orderBy(orderExpr)
      .limit(PAGE_SIZE)
      .offset(offset);

    const enriched = await Promise.all(
      users.map(async (u) => {
        const [profile] = await db
          .select({ profession: profilesTable.profession, specialty: profilesTable.specialty, qualificationCountry: profilesTable.qualificationCountry, registrationStatus: profilesTable.registrationStatus })
          .from(profilesTable)
          .where(eq(profilesTable.userId, u.id));

        const [docCnt] = await db
          .select({ cnt: count(documentsTable.id) })
          .from(documentsTable)
          .where(eq(documentsTable.userId, u.id));

        const [appCnt] = await db
          .select({ cnt: count(applicationsTable.id) })
          .from(applicationsTable)
          .where(eq(applicationsTable.userId, u.id));

        const [latestDecision] = await db
          .select({ outcome: decisionRecordsTable.outcome })
          .from(decisionRecordsTable)
          .where(eq(decisionRecordsTable.userId, u.id))
          .orderBy(desc(decisionRecordsTable.createdAt))
          .limit(1);

        const [consent] = await db
          .select({ consentedAt: consentLogsTable.consentedAt })
          .from(consentLogsTable)
          .where(eq(consentLogsTable.userId, u.id))
          .orderBy(desc(consentLogsTable.consentedAt))
          .limit(1);

        const profileFieldsFilled = profile
          ? [profile.profession, profile.specialty, profile.qualificationCountry, profile.registrationStatus].filter(Boolean).length
          : 0;
        const profileCompletion = profile ? Math.round((profileFieldsFilled / 4) * 100) : 0;

        return {
          ...u,
          profileCompletion,
          documentCount: Number(docCnt?.cnt ?? 0),
          applicationCount: Number(appCnt?.cnt ?? 0),
          eligibilityStatus: latestDecision?.outcome ?? null,
          hasConsented: !!consent,
        };
      }),
    );

    const [totalRow] = await db
      .select({ cnt: count(usersTable.id) })
      .from(usersTable)
      .where(whereClause);

    res.json({ users: enriched, total: Number(totalRow?.cnt ?? 0), page: pageNum, pageSize: PAGE_SIZE });
  },
);

router.get(
  "/admin/super/users/:id/full",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const targetId = req.params["id"] as string;
    writeAuditEvent(req.user!.id, "super_admin_view_user_detail", targetId).catch(() => {});

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
      .where(eq(usersTable.id, targetId));

    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, targetId));
    const [employerProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, targetId));

    const documents = await db
      .select({ id: documentsTable.id, fileName: documentsTable.fileName, fileType: documentsTable.fileType, storageKey: documentsTable.storageKey, uploadedAt: documentsTable.uploadedAt })
      .from(documentsTable)
      .where(eq(documentsTable.userId, targetId))
      .orderBy(desc(documentsTable.uploadedAt));

    const applications = await db
      .select({ id: applicationsTable.id, roleId: applicationsTable.roleId, status: applicationsTable.status, appliedAt: applicationsTable.appliedAt, notes: applicationsTable.notes })
      .from(applicationsTable)
      .where(eq(applicationsTable.userId, targetId))
      .orderBy(desc(applicationsTable.appliedAt));

    const eligibilityHistory = await db
      .select({ id: decisionRecordsTable.id, outcome: decisionRecordsTable.outcome, createdAt: decisionRecordsTable.createdAt })
      .from(decisionRecordsTable)
      .where(eq(decisionRecordsTable.userId, targetId))
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
      .where(eq(auditEventsTable.target, targetId))
      .orderBy(desc(auditEventsTable.createdAt))
      .limit(20);

    const [consent] = await db
      .select()
      .from(consentLogsTable)
      .where(eq(consentLogsTable.userId, targetId))
      .orderBy(desc(consentLogsTable.consentedAt))
      .limit(1);

    res.json({
      user,
      profile: profile ?? null,
      employerProfile: employerProfile ?? null,
      documents,
      applications,
      eligibilityHistory,
      auditEvents,
      consent: consent ?? null,
    });
  },
);

router.post(
  "/admin/super/impersonate/:id",
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const targetId = req.params["id"] as string;

    const [targetUser] = await db
      .select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, targetId));

    if (!targetUser) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    impersonationTokens.set(token, { targetUserId: targetId, adminId: req.user!.id, expiresAt });

    writeAuditEvent(req.user!.id, "super_admin_impersonate", targetId, { targetEmail: targetUser.email }).catch(() => {});

    res.json({
      token,
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
  "/admin/super/impersonate/validate",
  async (req: Request, res: Response): Promise<void> => {
    const token = (req.query["token"] as string) ?? "";
    if (!token) {
      res.status(400).json({ error: "Token required." });
      return;
    }

    const record = impersonationTokens.get(token);
    if (!record || record.expiresAt < new Date()) {
      impersonationTokens.delete(token);
      res.status(401).json({ error: "Invalid or expired impersonation token." });
      return;
    }

    const fullDetail = await fetchUserFull(record.targetUserId);
    if (!fullDetail) {
      res.status(404).json({ error: "Target user not found." });
      return;
    }

    res.json({ ...fullDetail, impersonating: true, adminId: record.adminId });
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

    const [errorCount] = await db
      .select({ cnt: count(auditEventsTable.id) })
      .from(auditEventsTable)
      .where(ilike(auditEventsTable.action, "%error%"));

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
      errorCount: Number(errorCount?.cnt ?? 0),
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
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user) return null;

  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId));
  const [employerProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));

  const documents = await db
    .select({ id: documentsTable.id, fileName: documentsTable.fileName, fileType: documentsTable.fileType, storageKey: documentsTable.storageKey, uploadedAt: documentsTable.uploadedAt })
    .from(documentsTable)
    .where(eq(documentsTable.userId, userId))
    .orderBy(desc(documentsTable.uploadedAt));

  const applications = await db
    .select({ id: applicationsTable.id, roleId: applicationsTable.roleId, status: applicationsTable.status, appliedAt: applicationsTable.appliedAt })
    .from(applicationsTable)
    .where(eq(applicationsTable.userId, userId))
    .orderBy(desc(applicationsTable.appliedAt));

  const [latestDecision] = await db
    .select({ outcome: decisionRecordsTable.outcome, createdAt: decisionRecordsTable.createdAt })
    .from(decisionRecordsTable)
    .where(eq(decisionRecordsTable.userId, userId))
    .orderBy(desc(decisionRecordsTable.createdAt))
    .limit(1);

  return { user, profile: profile ?? null, employerProfile: employerProfile ?? null, documents, applications, latestDecision: latestDecision ?? null };
}

export default router;
