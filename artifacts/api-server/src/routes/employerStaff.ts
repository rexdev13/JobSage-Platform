import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  db,
  employerProfilesTable,
  employerMembershipsTable,
  employerInvitationsTable,
  employerJobAssignmentsTable,
  jobListingsTable,
  usersTable,
} from "@workspace/db";
import { requireAuthenticated } from "../middlewares/requireRole";
import { getEmployerContext, requireEmployer } from "../middlewares/employerAccess";
import { employerInvitationRoles, employerStaffRoles } from "@workspace/db";
import { sendEmployerInvitationEmail } from "../lib/email";
import { writeAuditEvent } from "../lib/audit";

const router: IRouter = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const ORGANIZATION_RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function invitationUrl(token: string): string {
  const configured = process.env.APP_URL?.trim();
  const developmentDomain = process.env.NODE_ENV !== "production"
    ? process.env.REPLIT_DEV_DOMAIN?.trim()
    : undefined;
  const base = configured || (developmentDomain ? `https://${developmentDomain}` : undefined);
  if (!base) throw new Error("APP_URL must be configured before employer invitations can be sent.");
  const parsed = new URL(base);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error("APP_URL must use HTTPS.");
  }
  return new URL(`/employer/invitations/${encodeURIComponent(token)}`, parsed.origin).toString();
}

function contextOwnerOnly(req: Request, res: Response, next: NextFunction): void {
  const context = getEmployerContext(req);
  if (!context) {
    res.status(403).json({ error: "An employer organisation is required." });
    return;
  }
  if (context.role !== "employer_owner") {
    res.status(403).json({ error: "Only the organisation owner can perform this action." });
    return;
  }
  next();
}

function requireContext() {
  return [requireEmployer(), (req: Request, res: Response, next: NextFunction) => {
    if (!getEmployerContext(req)) {
      res.status(403).json({ error: "An employer organisation is required." });
      return;
    }
    next();
  }] as const;
}

router.get("/employer/organizations", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const restoreCutoff = new Date(Date.now() - ORGANIZATION_RESTORE_WINDOW_MS);
  const owned = await db.select({
    id: employerProfilesTable.id,
    companyName: employerProfilesTable.companyName,
    role: employerMembershipsTable.role,
  }).from(employerProfilesTable)
    .leftJoin(employerMembershipsTable, and(
      eq(employerMembershipsTable.employerProfileId, employerProfilesTable.id),
      eq(employerMembershipsTable.userId, userId),
      eq(employerMembershipsTable.status, "active"),
    ))
    .where(and(eq(employerProfilesTable.userId, userId), isNull(employerProfilesTable.deletedAt)));
  const archivedOwned = await db.select({
    id: employerProfilesTable.id,
    companyName: employerProfilesTable.companyName,
    archivedAt: employerProfilesTable.deletedAt,
  }).from(employerProfilesTable).where(and(
    eq(employerProfilesTable.userId, userId),
    gt(employerProfilesTable.deletedAt, restoreCutoff),
  ));
  const joined = await db.select({
    id: employerProfilesTable.id,
    companyName: employerProfilesTable.companyName,
    role: employerMembershipsTable.role,
  }).from(employerMembershipsTable)
    .innerJoin(employerProfilesTable, eq(employerProfilesTable.id, employerMembershipsTable.employerProfileId))
    .where(and(
      eq(employerMembershipsTable.userId, userId),
      eq(employerMembershipsTable.status, "active"),
      isNull(employerProfilesTable.deletedAt),
    ));
  const organizations = new Map<number, { id: number; companyName: string; role: string }>();
  for (const org of owned) organizations.set(org.id, { ...org, role: "employer_owner" });
  for (const org of joined) if (!organizations.has(org.id)) organizations.set(org.id, org);
  const cookieMatch = (req.get("cookie") ?? "").match(/(?:^|;\s*)jobsage-employer-context=(\d+)/);
  const requestedId = Number(req.get("x-jobsage-employer-profile-id") ?? cookieMatch?.[1]);
  const activeOrganizationId = organizations.has(requestedId) ? requestedId : null;
  res.json({
    organizations: [...organizations.values()],
    activeOrganizationId,
    archivedOrganizations: archivedOwned.flatMap(org => org.archivedAt
      ? [{
          id: org.id,
          companyName: org.companyName,
          archivedAt: org.archivedAt,
          restoreUntil: new Date(org.archivedAt.getTime() + ORGANIZATION_RESTORE_WINDOW_MS),
        }]
      : []),
  });
});

router.post("/employer/context", requireAuthenticated, async (req, res): Promise<void> => {
  const employerProfileId = Number(req.body?.employerProfileId);
  if (!Number.isInteger(employerProfileId) || employerProfileId < 1) {
    res.status(400).json({ error: "A valid employer organisation is required." });
    return;
  }
  const userId = req.user!.id;
  const [organization] = await db.select({
    id: employerProfilesTable.id,
    companyName: employerProfilesTable.companyName,
    role: employerMembershipsTable.role,
  }).from(employerProfilesTable)
    .leftJoin(employerMembershipsTable, and(
      eq(employerMembershipsTable.employerProfileId, employerProfilesTable.id),
      eq(employerMembershipsTable.userId, userId),
      eq(employerMembershipsTable.status, "active"),
    ))
    .where(and(eq(employerProfilesTable.id, employerProfileId), isNull(employerProfilesTable.deletedAt)));
  if (!organization || (organization.role == null && !ownedBy(organization.id, userId))) {
    res.status(403).json({ error: "You are not an active member of this organisation." });
    return;
  }
  res.cookie("jobsage-employer-context", String(employerProfileId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  res.json({ organization: { ...organization, role: organization.role ?? "employer_owner" } });
});

async function ownedBy(employerProfileId: number, userId: string): Promise<boolean> {
  const [owner] = await db.select({ id: employerProfilesTable.id }).from(employerProfilesTable)
    .where(and(eq(employerProfilesTable.id, employerProfileId), eq(employerProfilesTable.userId, userId), isNull(employerProfilesTable.deletedAt)));
  return Boolean(owner);
}

router.get("/employer/staff", ...requireContext(), async (req, res): Promise<void> => {
  const context = getEmployerContext(req)!;
  if (!["employer_owner", "employer_admin"].includes(context.role)) {
    res.status(403).json({ error: "Only the owner or an organisation admin can manage staff." });
    return;
  }
  const [profile] = await db.select().from(employerProfilesTable)
    .where(eq(employerProfilesTable.id, context.employerProfileId));
  if (!profile) { res.status(404).json({ error: "Employer organisation not found." }); return; }

  const members = await db.select({
    userId: employerMembershipsTable.userId,
    role: employerMembershipsTable.role,
    status: employerMembershipsTable.status,
    createdAt: employerMembershipsTable.createdAt,
    email: usersTable.email,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
  }).from(employerMembershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, employerMembershipsTable.userId))
    .where(and(
      eq(employerMembershipsTable.employerProfileId, context.employerProfileId),
      eq(employerMembershipsTable.status, "active"),
    ));
  const ownerIsListed = members.some(member => member.userId === profile.userId);
  if (!ownerIsListed) {
    const [owner] = await db.select({
      userId: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    }).from(usersTable).where(eq(usersTable.id, profile.userId));
    if (owner) members.unshift({ ...owner, role: "employer_owner", status: "active", createdAt: profile.createdAt });
  }

  const invitations = await db.select({
    id: employerInvitationsTable.id,
    email: employerInvitationsTable.email,
    role: employerInvitationsTable.role,
    expiresAt: employerInvitationsTable.expiresAt,
    createdAt: employerInvitationsTable.createdAt,
  }).from(employerInvitationsTable).where(and(
    eq(employerInvitationsTable.employerProfileId, context.employerProfileId),
    isNull(employerInvitationsTable.acceptedAt),
    isNull(employerInvitationsTable.declinedAt),
    isNull(employerInvitationsTable.revokedAt),
    gt(employerInvitationsTable.expiresAt, new Date()),
  ));
  const assignments = await db.select({
    jobListingId: employerJobAssignmentsTable.jobListingId,
    userId: employerJobAssignmentsTable.userId,
    title: jobListingsTable.title,
  }).from(employerJobAssignmentsTable)
    .innerJoin(jobListingsTable, eq(jobListingsTable.id, employerJobAssignmentsTable.jobListingId))
    .where(eq(employerJobAssignmentsTable.employerProfileId, context.employerProfileId));
  res.json({ members, invitations, assignments });
});

router.post("/employer/staff/invitations", ...requireContext(), async (req, res): Promise<void> => {
  const context = getEmployerContext(req)!;
  if (!["employer_owner", "employer_admin"].includes(context.role)) {
    res.status(403).json({ error: "Only the owner or an organisation admin can invite staff." });
    return;
  }
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const role = req.body?.role;
  if (!emailPattern.test(email) || email.length > 254) {
    res.status(400).json({ error: "Enter a valid staff email address." });
    return;
  }
  if (!employerInvitationRoles.includes(role)) {
    res.status(400).json({ error: "Choose an allowed staff role. Ownership cannot be assigned by invitation." });
    return;
  }
  const [targetUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
  if (targetUser) {
    const [organization] = await db.select({ userId: employerProfilesTable.userId }).from(employerProfilesTable)
      .where(eq(employerProfilesTable.id, context.employerProfileId));
    if (organization?.userId === targetUser.id) {
      res.status(409).json({ error: "The current owner is already a member of this organisation." });
      return;
    }
    const [existingMember] = await db.select({ status: employerMembershipsTable.status })
      .from(employerMembershipsTable).where(and(
        eq(employerMembershipsTable.employerProfileId, context.employerProfileId),
        eq(employerMembershipsTable.userId, targetUser.id),
      ));
    if (existingMember?.status === "active") {
      res.status(409).json({ error: "This person is already a member of the organisation." });
      return;
    }
  }
  const pending = await db.select({ id: employerInvitationsTable.id }).from(employerInvitationsTable)
    .where(and(
      eq(employerInvitationsTable.employerProfileId, context.employerProfileId),
      eq(employerInvitationsTable.email, email),
      isNull(employerInvitationsTable.acceptedAt),
      isNull(employerInvitationsTable.declinedAt),
      isNull(employerInvitationsTable.revokedAt),
      gt(employerInvitationsTable.expiresAt, new Date()),
    ));
  if (pending.length) {
    res.status(409).json({ error: "There is already a pending invitation for this email." });
    return;
  }

  const token = randomBytes(32).toString("base64url");
  const [profile] = await db.select({
    id: employerProfilesTable.id,
    companyName: employerProfilesTable.companyName,
  }).from(employerProfilesTable).where(eq(employerProfilesTable.id, context.employerProfileId));
  if (!profile) { res.status(404).json({ error: "Employer organisation not found." }); return; }
  let acceptUrl: string;
  try {
    acceptUrl = invitationUrl(token);
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Invitation links are not configured." });
    return;
  }
  const [invitation] = await db.insert(employerInvitationsTable).values({
    employerProfileId: context.employerProfileId,
    email,
    role,
    tokenHash: hashToken(token),
    invitedByUserId: context.actingUserId,
    expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS),
  }).returning({ id: employerInvitationsTable.id });
  if (!invitation) { res.status(500).json({ error: "The invitation could not be created." }); return; }
  try {
    await sendEmployerInvitationEmail({ to: email, companyName: profile.companyName, role, acceptUrl });
  } catch (error) {
    await db.update(employerInvitationsTable)
      .set({ revokedAt: new Date() })
      .where(eq(employerInvitationsTable.id, invitation.id));
    await writeAuditEvent(context.actingUserId, "employer_invitation_delivery_failed", String(context.employerProfileId), { role });
    req.log.error(
      { err: error, employerProfileId: context.employerProfileId },
      "Employer staff invitation delivery failed",
    );
    res.status(503).json({ error: "The invitation was not sent. Try again after email delivery is available." });
    return;
  }
  await writeAuditEvent(context.actingUserId, "employer_staff_invited", String(context.employerProfileId), { role });
  res.status(201).json({ invitationId: invitation.id, role, expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS) });
});

router.post("/employer/invitations/:token/accept", requireAuthenticated, async (req, res): Promise<void> => {
  const token = typeof req.params.token === "string" ? req.params.token : "";
  if (token.length < 32 || token.length > 128) { res.status(400).json({ error: "Invalid invitation." }); return; }
  const [user] = await db.select({ id: usersTable.id, email: usersTable.email, emailVerified: usersTable.emailVerified })
    .from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user?.email || !user.emailVerified) {
    res.status(403).json({ error: "Verify the invited email address before accepting." });
    return;
  }
  const [invitation] = await db.select().from(employerInvitationsTable)
    .where(eq(employerInvitationsTable.tokenHash, hashToken(token)));
  if (!invitation || invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    res.status(404).json({ error: "Invitation not found for this account." });
    return;
  }
  if (invitation.acceptedAt) {
    res.json({ accepted: true, alreadyAccepted: true, employerProfileId: invitation.employerProfileId });
    return;
  }
  const now = new Date();
  if (invitation.revokedAt || invitation.declinedAt || invitation.expiresAt <= now) {
    res.status(410).json({ error: "This invitation is no longer active." });
    return;
  }
  const [activeOrganization] = await db.select({ id: employerProfilesTable.id }).from(employerProfilesTable)
    .where(and(
      eq(employerProfilesTable.id, invitation.employerProfileId),
      isNull(employerProfilesTable.deletedAt),
    ));
  if (!activeOrganization) { res.status(410).json({ error: "This organisation is no longer active." }); return; }
  try {
    await db.transaction(async tx => {
      const [updated] = await tx.update(employerInvitationsTable).set({ acceptedAt: now })
        .where(and(
          eq(employerInvitationsTable.id, invitation.id),
          isNull(employerInvitationsTable.acceptedAt),
          isNull(employerInvitationsTable.revokedAt),
          isNull(employerInvitationsTable.declinedAt),
          gt(employerInvitationsTable.expiresAt, now),
        )).returning({ id: employerInvitationsTable.id });
      if (!updated) throw new Error("INVITATION_ALREADY_USED");
      await tx.insert(employerMembershipsTable).values({
        employerProfileId: invitation.employerProfileId,
        userId: user.id,
        role: invitation.role,
        status: "active",
        invitedByUserId: invitation.invitedByUserId,
      }).onConflictDoUpdate({
        target: [employerMembershipsTable.employerProfileId, employerMembershipsTable.userId],
        set: { role: invitation.role, status: "active", invitedByUserId: invitation.invitedByUserId, updatedAt: now },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INVITATION_ALREADY_USED") {
      res.status(409).json({ error: "This invitation has already been used." });
      return;
    }
    throw error;
  }
  await writeAuditEvent(user.id, "employer_invitation_accepted", String(invitation.employerProfileId), { role: invitation.role });
  res.cookie("jobsage-employer-context", String(invitation.employerProfileId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  res.json({ accepted: true, employerProfileId: invitation.employerProfileId });
});

router.get("/employer/invitations/:token", requireAuthenticated, async (req, res): Promise<void> => {
  const token = typeof req.params.token === "string" ? req.params.token : "";
  if (token.length < 32 || token.length > 128) { res.status(400).json({ error: "Invalid invitation." }); return; }
  const [user] = await db.select({ email: usersTable.email, emailVerified: usersTable.emailVerified })
    .from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user?.email || !user.emailVerified) {
    res.status(403).json({ error: "Verify your email before reviewing this invitation." });
    return;
  }
  const [invitation] = await db.select({
    id: employerInvitationsTable.id,
    email: employerInvitationsTable.email,
    role: employerInvitationsTable.role,
    expiresAt: employerInvitationsTable.expiresAt,
    acceptedAt: employerInvitationsTable.acceptedAt,
    declinedAt: employerInvitationsTable.declinedAt,
    revokedAt: employerInvitationsTable.revokedAt,
    companyName: employerProfilesTable.companyName,
    deletedAt: employerProfilesTable.deletedAt,
  }).from(employerInvitationsTable)
    .innerJoin(employerProfilesTable, eq(employerProfilesTable.id, employerInvitationsTable.employerProfileId))
    .where(eq(employerInvitationsTable.tokenHash, hashToken(token)));
  if (!invitation || invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    res.status(404).json({ error: "Invitation not found for this account." });
    return;
  }
  if (invitation.revokedAt || invitation.declinedAt || invitation.expiresAt <= new Date() || invitation.deletedAt) {
    res.status(410).json({ error: "This invitation is no longer active." });
    return;
  }
  res.json({
    invitation: {
      companyName: invitation.companyName,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      accepted: Boolean(invitation.acceptedAt),
    },
  });
});

router.post("/employer/invitations/:token/decline", requireAuthenticated, async (req, res): Promise<void> => {
  const token = typeof req.params.token === "string" ? req.params.token : "";
  const [user] = await db.select({ id: usersTable.id, email: usersTable.email, emailVerified: usersTable.emailVerified })
    .from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user?.email || !user.emailVerified || token.length < 32 || token.length > 128) {
    res.status(403).json({ error: "Verify the invited email address before declining." });
    return;
  }
  const [invitation] = await db.update(employerInvitationsTable).set({ declinedAt: new Date() })
    .where(and(
      eq(employerInvitationsTable.tokenHash, hashToken(token)),
      eq(employerInvitationsTable.email, user.email.toLowerCase()),
      isNull(employerInvitationsTable.acceptedAt),
      isNull(employerInvitationsTable.declinedAt),
      isNull(employerInvitationsTable.revokedAt),
      gt(employerInvitationsTable.expiresAt, new Date()),
    )).returning({ id: employerInvitationsTable.id, employerProfileId: employerInvitationsTable.employerProfileId });
  if (!invitation) { res.status(404).json({ error: "Active invitation not found for this account." }); return; }
  await writeAuditEvent(user.id, "employer_invitation_declined", String(invitation.employerProfileId));
  res.json({ declined: true });
});

router.delete("/employer/staff/invitations/:id", ...requireContext(), async (req, res): Promise<void> => {
  const context = getEmployerContext(req)!;
  if (!["employer_owner", "employer_admin"].includes(context.role)) {
    res.status(403).json({ error: "Only the owner or an organisation admin can revoke invitations." });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Invalid invitation ID." }); return; }
  const [revoked] = await db.update(employerInvitationsTable).set({ revokedAt: new Date() })
    .where(and(
      eq(employerInvitationsTable.id, id),
      eq(employerInvitationsTable.employerProfileId, context.employerProfileId),
      isNull(employerInvitationsTable.acceptedAt),
      isNull(employerInvitationsTable.revokedAt),
    )).returning({ id: employerInvitationsTable.id });
  if (!revoked) { res.status(404).json({ error: "Pending invitation not found." }); return; }
  await writeAuditEvent(context.actingUserId, "employer_invitation_revoked", String(context.employerProfileId), { invitationId: id });
  res.json({ revoked: true });
});

router.put("/employer/staff/:userId/role", ...requireContext(), async (req, res): Promise<void> => {
  const context = getEmployerContext(req)!;
  if (!["employer_owner", "employer_admin"].includes(context.role)) {
    res.status(403).json({ error: "Only the owner or an organisation admin can change staff roles." });
    return;
  }
  const targetUserId = String(req.params.userId);
  const role = req.body?.role;
  if (!employerStaffRoles.includes(role) || role === "employer_owner") {
    res.status(400).json({ error: "The owner role can only be assigned by an ownership transfer." });
    return;
  }
  if (targetUserId === context.ownerUserId) { res.status(409).json({ error: "Transfer ownership before changing the current owner's role." }); return; }
  const [updated] = await db.update(employerMembershipsTable).set({ role })
    .where(and(
      eq(employerMembershipsTable.employerProfileId, context.employerProfileId),
      eq(employerMembershipsTable.userId, targetUserId),
      eq(employerMembershipsTable.status, "active"),
    )).returning({ userId: employerMembershipsTable.userId, role: employerMembershipsTable.role });
  if (!updated) { res.status(404).json({ error: "Active staff member not found." }); return; }
  await writeAuditEvent(context.actingUserId, "employer_staff_role_changed", String(context.employerProfileId), { role });
  res.json({ member: updated });
});

router.delete("/employer/staff/:userId", ...requireContext(), async (req, res): Promise<void> => {
  const context = getEmployerContext(req)!;
  if (!["employer_owner", "employer_admin"].includes(context.role)) {
    res.status(403).json({ error: "Only the owner or an organisation admin can remove staff." });
    return;
  }
  const targetUserId = String(req.params.userId);
  if (targetUserId === context.ownerUserId) {
    res.status(409).json({ error: "The sole owner cannot be removed. Transfer ownership first." });
    return;
  }
  const [removed] = await db.update(employerMembershipsTable).set({ status: "removed", updatedAt: new Date() })
    .where(and(
      eq(employerMembershipsTable.employerProfileId, context.employerProfileId),
      eq(employerMembershipsTable.userId, targetUserId),
      eq(employerMembershipsTable.status, "active"),
    )).returning({ userId: employerMembershipsTable.userId });
  if (!removed) { res.status(404).json({ error: "Active staff member not found." }); return; }
  await db.delete(employerJobAssignmentsTable).where(and(
    eq(employerJobAssignmentsTable.employerProfileId, context.employerProfileId),
    eq(employerJobAssignmentsTable.userId, targetUserId),
  ));
  await writeAuditEvent(context.actingUserId, "employer_staff_removed", String(context.employerProfileId));
  res.json({ removed: true });
});

router.put("/employer/staff/assignments", ...requireContext(), async (req, res): Promise<void> => {
  const context = getEmployerContext(req)!;
  if (!["employer_owner", "employer_admin"].includes(context.role)) {
    res.status(403).json({ error: "Only the owner or an organisation admin can assign resources." });
    return;
  }
  const jobListingId = Number(req.body?.jobListingId);
  const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
  const assigned = req.body?.assigned;
  if (!Number.isInteger(jobListingId) || jobListingId < 1 || !userId || typeof assigned !== "boolean") {
    res.status(400).json({ error: "Provide a job, staff account, and assigned state." });
    return;
  }
  const [job] = await db.select({ id: jobListingsTable.id }).from(jobListingsTable)
    .where(and(eq(jobListingsTable.id, jobListingId), eq(jobListingsTable.employerProfileId, context.employerProfileId)));
  const [membership] = await db.select({ userId: employerMembershipsTable.userId })
    .from(employerMembershipsTable).where(and(
      eq(employerMembershipsTable.employerProfileId, context.employerProfileId),
      eq(employerMembershipsTable.userId, userId),
      eq(employerMembershipsTable.status, "active"),
    ));
  if (!job || !membership) { res.status(404).json({ error: "Job or active staff member not found in this organisation." }); return; }
  if (assigned) {
    await db.insert(employerJobAssignmentsTable).values({
      employerProfileId: context.employerProfileId,
      jobListingId,
      userId,
      assignedByUserId: context.actingUserId,
    }).onConflictDoNothing();
  } else {
    await db.delete(employerJobAssignmentsTable).where(and(
      eq(employerJobAssignmentsTable.employerProfileId, context.employerProfileId),
      eq(employerJobAssignmentsTable.jobListingId, jobListingId),
      eq(employerJobAssignmentsTable.userId, userId),
    ));
  }
  await writeAuditEvent(context.actingUserId, assigned ? "employer_resource_assigned" : "employer_resource_unassigned",
    String(context.employerProfileId), { jobListingId });
  res.json({ assigned });
});

router.post("/employer/staff/transfer-ownership", ...requireContext(), contextOwnerOnly, async (req, res): Promise<void> => {
  const context = getEmployerContext(req)!;
  const newOwnerUserId = typeof req.body?.userId === "string" ? req.body.userId : "";
  if (!newOwnerUserId || newOwnerUserId === context.ownerUserId) {
    res.status(400).json({ error: "Choose a different active staff member." });
    return;
  }
  const [target] = await db.select({ userId: employerMembershipsTable.userId })
    .from(employerMembershipsTable).where(and(
      eq(employerMembershipsTable.employerProfileId, context.employerProfileId),
      eq(employerMembershipsTable.userId, newOwnerUserId),
      eq(employerMembershipsTable.status, "active"),
    ));
  if (!target) { res.status(404).json({ error: "The new owner must be an active staff member." }); return; }
  const [otherOwnedProfile] = await db.select({ id: employerProfilesTable.id }).from(employerProfilesTable)
    .where(eq(employerProfilesTable.userId, newOwnerUserId));
  if (otherOwnedProfile) { res.status(409).json({ error: "The selected account already owns this organisation." }); return; }
  try {
    await db.transaction(async tx => {
      const [changed] = await tx.update(employerProfilesTable).set({ userId: newOwnerUserId })
        .where(and(
          eq(employerProfilesTable.id, context.employerProfileId),
          eq(employerProfilesTable.userId, context.ownerUserId),
          isNull(employerProfilesTable.deletedAt),
        )).returning({ id: employerProfilesTable.id });
      if (!changed) throw new Error("OWNERSHIP_CHANGED");
      await tx.insert(employerMembershipsTable).values({
        employerProfileId: context.employerProfileId,
        userId: context.ownerUserId,
        role: "employer_admin",
        status: "active",
        invitedByUserId: context.actingUserId,
      }).onConflictDoUpdate({
        target: [employerMembershipsTable.employerProfileId, employerMembershipsTable.userId],
        set: { role: "employer_admin", status: "active", updatedAt: new Date() },
      });
      await tx.insert(employerMembershipsTable).values({
        employerProfileId: context.employerProfileId,
        userId: newOwnerUserId,
        role: "employer_owner",
        status: "active",
        invitedByUserId: context.actingUserId,
      }).onConflictDoUpdate({
        target: [employerMembershipsTable.employerProfileId, employerMembershipsTable.userId],
        set: { role: "employer_owner", status: "active", updatedAt: new Date() },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "OWNERSHIP_CHANGED") {
      res.status(409).json({ error: "Ownership has changed. Refresh the staff list and try again." });
      return;
    }
    throw error;
  }
  await writeAuditEvent(context.actingUserId, "employer_ownership_transferred", String(context.employerProfileId));
  res.json({ transferred: true, ownerUserId: newOwnerUserId });
});

router.post("/employer/staff/delete-organization", ...requireContext(), contextOwnerOnly, async (req, res): Promise<void> => {
  const context = getEmployerContext(req)!;
  const [profile] = await db.select().from(employerProfilesTable)
    .where(and(eq(employerProfilesTable.id, context.employerProfileId), isNull(employerProfilesTable.deletedAt)));
  if (!profile) { res.status(404).json({ error: "Active organisation not found." }); return; }
  if (req.body?.confirmCompanyName !== profile.companyName) {
    res.status(400).json({ error: "Enter the exact organisation name to confirm this reversible deletion." });
    return;
  }
  const requestedAt = new Date();
  const [archived] = await db.update(employerProfilesTable).set({
    deletionRequestedAt: requestedAt,
    deletedAt: requestedAt,
  }).where(and(
    eq(employerProfilesTable.id, context.employerProfileId),
    eq(employerProfilesTable.userId, context.ownerUserId),
    isNull(employerProfilesTable.deletedAt),
  )).returning({ id: employerProfilesTable.id });
  if (!archived) { res.status(409).json({ error: "The organisation has already been archived." }); return; }
  await writeAuditEvent(context.actingUserId, "employer_organization_archived", String(context.employerProfileId));
  res.json({ archived: true, restoreUntil: new Date(requestedAt.getTime() + ORGANIZATION_RESTORE_WINDOW_MS) });
});

router.post("/employer/organizations/:id/restore", requireAuthenticated, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Invalid organisation ID." }); return; }
  const cutoff = new Date(Date.now() - ORGANIZATION_RESTORE_WINDOW_MS);
  const [restored] = await db.update(employerProfilesTable).set({
    deletionRequestedAt: null,
    deletedAt: null,
  }).where(and(
    eq(employerProfilesTable.id, id),
    eq(employerProfilesTable.userId, req.user!.id),
    gt(employerProfilesTable.deletedAt, cutoff),
  )).returning({ id: employerProfilesTable.id });
  if (!restored) { res.status(404).json({ error: "No restorable organisation deletion was found." }); return; }
  await writeAuditEvent(req.user!.id, "employer_organization_restored", String(id));
  res.cookie("jobsage-employer-context", String(id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  res.json({ restored: true });
});

export default router;
