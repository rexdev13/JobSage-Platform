import { Router, type IRouter } from "express";
import { db, jobListingsTable, rolesTable, candidateMessagesTable } from "@workspace/db";
import { applicationsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuthenticated } from "../middlewares/requireRole";
import { createApplicationReceivedMessage } from "../lib/systemMessages";

const router: IRouter = Router();

router.get("/applications", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const applications = await db
    .select()
    .from(applicationsTable)
    .where(eq(applicationsTable.userId, userId))
    .orderBy(applicationsTable.appliedAt);

  const employerRoleIds = applications
    .filter((a) => a.roleId > 1_000_000)
    .map((a) => a.roleId - 1_000_000);

  const jobTitleMap: Record<number, { title: string; employer?: string; location?: string }> = {};
  if (employerRoleIds.length > 0) {
    const jobs = await db
      .select({ id: jobListingsTable.id, title: jobListingsTable.title, location: jobListingsTable.location })
      .from(jobListingsTable)
      .where(inArray(jobListingsTable.id, employerRoleIds));
    for (const job of jobs) {
      jobTitleMap[job.id + 1_000_000] = { title: job.title, location: job.location };
    }
  }

  const enriched = applications.map((a) => ({
    ...a,
    roleTitle: jobTitleMap[a.roleId]?.title ?? null,
    roleLocation: jobTitleMap[a.roleId]?.location ?? null,
  }));

  const stats = {
    total: applications.length,
    interviews: applications.filter((a) => a.status === "interview").length,
    offers: applications.filter((a) => a.status === "offer").length,
    noResponse: applications.filter((a) => a.status === "no_response").length,
  };

  res.json({ applications: enriched, stats });
});

router.post("/applications", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { roleId, notes, smartApply } = req.body as { roleId?: number; notes?: string; smartApply?: boolean };

  if (!roleId || typeof roleId !== "number") {
    res.status(400).json({ error: "roleId is required and must be a number." });
    return;
  }

  const [existing] = await db
    .select()
    .from(applicationsTable)
    .where(and(eq(applicationsTable.userId, userId), eq(applicationsTable.roleId, roleId)));

  if (existing) {
    res.json(existing);
    return;
  }

  const [application] = await db
    .insert(applicationsTable)
    .values({ userId, roleId, notes: notes ?? null, status: "applied" })
    .returning();

  let roleTitle = `Role #${roleId}`;
  if (roleId > 1_000_000) {
    const [job] = await db.select({ title: jobListingsTable.title }).from(jobListingsTable).where(eq(jobListingsTable.id, roleId - 1_000_000));
    if (job) roleTitle = job.title;
  } else {
    const [role] = await db.select({ title: rolesTable.title }).from(rolesTable).where(eq(rolesTable.id, roleId));
    if (role) roleTitle = role.title;
  }

  if (smartApply) {
    db.insert(candidateMessagesTable).values({
      senderEmployerProfileId: null,
      recipientUserId: userId,
      applicationId: application.id,
      messageType: "system",
      subject: "Application submitted via Smart Apply",
      messageText: `Your Smart Apply submission for ${roleTitle} was sent successfully. Your answers have been captured and forwarded to the hiring team. We'll notify you here of any updates.`,
    }).catch((err: unknown) => {
      console.error("[inbox] Failed to create Smart Apply message:", err);
    });
  } else {
    createApplicationReceivedMessage({
      recipientUserId: userId,
      applicationId: application.id,
      roleTitle,
    }).catch((err: unknown) => {
      console.error("[inbox] Failed to create application received message:", err);
    });
  }

  res.json(application);
});

export default router;
