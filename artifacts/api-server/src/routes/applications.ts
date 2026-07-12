import { Router, type IRouter, type Request, type Response } from "express";
import { db, jobListingsTable, rolesTable, candidateMessagesTable } from "@workspace/db";
import { applicationsTable, speculativeApplicationsTable } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { requireAuthenticated } from "../middlewares/requireRole";
import { createApplicationReceivedMessage } from "../lib/systemMessages";

const router: IRouter = Router();

// Apply-workflow privacy note:
// POST /applications records a job application in the database only.
// No CV or cover letter is emailed to employers through this path.
// JOBSAGE alias masking (personal email/phone redaction) is therefore not applicable here;
// masking is enforced at the point of any outbound document delivery (speculative CV flow).

router.get("/applications", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;

  const [applications, speculativeApps] = await Promise.all([
    db
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.userId, userId))
      .orderBy(desc(applicationsTable.appliedAt)),
    db
      .select()
      .from(speculativeApplicationsTable)
      .where(eq(speculativeApplicationsTable.userId, userId))
      .orderBy(desc(speculativeApplicationsTable.createdAt)),
  ]);

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

  const enrichedFormal = applications.map((a) => ({
    ...a,
    roleTitle: jobTitleMap[a.roleId]?.title ?? null,
    roleLocation: jobTitleMap[a.roleId]?.location ?? null,
    applicationKind: "formal" as const,
    companyName: null as string | null,
  }));

  const enrichedSpeculative = speculativeApps.map((s) => ({
    id: s.id * -1,
    userId: s.userId,
    roleId: 0,
    status: "cv_sent" as const,
    appliedAt: s.createdAt.toISOString(),
    notes: s.notes ?? null,
    roleTitle: s.companyName,
    roleLocation: null as string | null,
    interviewDate: null as Date | null,
    interviewNotes: null as string | null,
    applicationKind: "speculative" as const,
    companyName: s.companyName,
  }));

  const merged = [...enrichedFormal, ...enrichedSpeculative].sort(
    (a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime(),
  );

  const stats = {
    total: applications.length + speculativeApps.length,
    interviews: applications.filter((a) => a.status === "interview").length,
    offers: applications.filter((a) => a.status === "offer").length,
    noResponse: applications.filter((a) => a.status === "no_response").length,
    cvSent: speculativeApps.length,
  };

  res.json({ applications: merged, stats });
});

router.post("/applications", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
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

router.patch("/applications/:id/interview-date", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid application ID" });
    return;
  }

  const { interviewDate, interviewNotes } = req.body as { interviewDate?: string | null; interviewNotes?: string | null };

  const [existing] = await db
    .select()
    .from(applicationsTable)
    .where(and(eq(applicationsTable.id, id), eq(applicationsTable.userId, userId)));

  if (!existing) {
    res.status(404).json({ error: "Application not found" });
    return;
  }

  const [updated] = await db
    .update(applicationsTable)
    .set({
      interviewDate: interviewDate ? new Date(interviewDate) : null,
      interviewNotes: interviewNotes ?? null,
    })
    .where(eq(applicationsTable.id, id))
    .returning();

  res.json(updated);
});

export default router;
