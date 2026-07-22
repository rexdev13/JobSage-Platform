import { Router, type IRouter, type Request, type Response } from "express";
import { db, jobListingsTable, rolesTable, candidateMessagesTable, documentsTable, employerProfilesTable } from "@workspace/db";
import { applicationsTable, speculativeApplicationsTable } from "@workspace/db";
import { eq, and, inArray, desc, or } from "drizzle-orm";
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

  const platformApps = applications.filter((a) => (a.applicationType ?? "platform") === "platform" && a.roleId > 0);
  const employerRoleIds = platformApps
    .filter((a) => a.roleId > 1_000_000)
    .map((a) => a.roleId - 1_000_000);
  const normalRoleIds = platformApps
    .filter((a) => a.roleId > 0 && a.roleId <= 1_000_000)
    .map((a) => a.roleId);

  const jobTitleMap: Record<number, { title: string; companyName?: string; location?: string }> = {};
  const [jobListingResults, normalRoleResults] = await Promise.all([
    employerRoleIds.length > 0
      ? db
          .select({ id: jobListingsTable.id, title: jobListingsTable.title, location: jobListingsTable.location, employerProfileId: jobListingsTable.employerProfileId })
          .from(jobListingsTable)
          .where(inArray(jobListingsTable.id, employerRoleIds))
      : Promise.resolve([]),
    normalRoleIds.length > 0
      ? db
          .select({ id: rolesTable.id, title: rolesTable.title, employer: rolesTable.employer })
          .from(rolesTable)
          .where(inArray(rolesTable.id, normalRoleIds))
      : Promise.resolve([]),
  ]);

  // Fetch employer profile company names for job listings
  const listingEmployerProfileIds = jobListingResults.map((j) => j.employerProfileId);
  const employerCompanyMap: Record<number, string> = {};
  if (listingEmployerProfileIds.length > 0) {
    const employerProfiles = await db
      .select({ id: employerProfilesTable.id, companyName: employerProfilesTable.companyName })
      .from(employerProfilesTable)
      .where(inArray(employerProfilesTable.id, listingEmployerProfileIds));
    for (const ep of employerProfiles) {
      employerCompanyMap[ep.id] = ep.companyName;
    }
  }

  for (const job of jobListingResults) {
    jobTitleMap[job.id + 1_000_000] = {
      title: job.title,
      location: job.location,
      companyName: employerCompanyMap[job.employerProfileId],
    };
  }
  for (const role of normalRoleResults) {
    jobTitleMap[role.id] = { title: role.title, companyName: role.employer };
  }

  // Fetch labels for CVs used in all application types
  const cvDocumentIds = [
    ...speculativeApps.map((s) => s.cvDocumentId),
    ...applications.map((a) => a.cvDocumentId),
  ].filter((id): id is number => id !== null && id !== undefined);
  const cvLabelMap: Record<number, string> = {};
  if (cvDocumentIds.length > 0) {
    const cvDocs = await db
      .select({ id: documentsTable.id, label: documentsTable.label, filename: documentsTable.filename })
      .from(documentsTable)
      .where(and(inArray(documentsTable.id, cvDocumentIds), eq(documentsTable.userId, userId)));
    for (const doc of cvDocs) {
      cvLabelMap[doc.id] = doc.label ?? doc.filename;
    }
  }

  const enrichedPlatform = platformApps.map((a) => ({
    ...a,
    roleTitle: jobTitleMap[a.roleId]?.title ?? null,
    roleLocation: jobTitleMap[a.roleId]?.location ?? null,
    applicationKind: "formal" as const,
    companyName: a.companyName ?? jobTitleMap[a.roleId]?.companyName ?? null,
    jobsageEmail: null as string | null,
    vacancyTitle: null as string | null,
    emailSentAt: null as string | null,
    emailRecipient: null as string | null,
    cvLabel: a.cvDocumentId ? (cvLabelMap[a.cvDocumentId] ?? null) : null,
  }));

  const enrichedWebsite = applications
    .filter((a) => (a.applicationType ?? "platform") === "website")
    .map((a) => ({
      ...a,
      roleTitle: a.companyName ?? "Website Application",
      roleLocation: null as string | null,
      applicationKind: "website" as const,
      companyName: a.companyName ?? null,
      jobsageEmail: null as string | null,
      vacancyTitle: null as string | null,
      emailSentAt: null as string | null,
      emailRecipient: null as string | null,
      cvLabel: a.cvDocumentId ? (cvLabelMap[a.cvDocumentId] ?? null) : null,
    }));

  const enrichedSpeculative = speculativeApps.map((s) => ({
    id: s.id * -1,
    userId: s.userId,
    roleId: 0,
    applicationType: "speculative" as const,
    applicationUrl: null as string | null,
    status: s.status as string,
    appliedAt: s.createdAt.toISOString(),
    notes: s.notes ?? null,
    roleTitle: s.vacancyTitle ?? s.companyName,
    roleLocation: null as string | null,
    interviewDate: null as Date | null,
    interviewNotes: null as string | null,
    applicationKind: "speculative" as const,
    companyName: s.companyName,
    jobsageEmail: s.jobsageEmail ?? null,
    vacancyTitle: s.vacancyTitle ?? null,
    emailSent: s.emailSent,
    emailSentAt: s.emailSentAt?.toISOString() ?? null,
    emailRecipient: s.emailRecipient ?? null,
    cvLabel: s.cvDocumentId ? (cvLabelMap[s.cvDocumentId] ?? null) : null,
  }));

  const merged = [...enrichedPlatform, ...enrichedWebsite, ...enrichedSpeculative].sort(
    (a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime(),
  );

  // Interviews: count both "interview" (legacy) and "interview_invited" across all types
  const interviewCount =
    applications.filter((a) => a.status === "interview" || a.status === "interview_invited").length +
    speculativeApps.filter((s) => s.status === "interview_invited").length;

  const stats = {
    total: applications.length + speculativeApps.length,
    interviews: interviewCount,
    offers: applications.filter((a) => a.status === "offer").length + speculativeApps.filter((s) => s.status === "offer").length,
    noResponse: applications.filter((a) => a.status === "no_response").length,
    cvSent: speculativeApps.length,
    platformCount: platformApps.length,
    websiteCount: enrichedWebsite.length,
    speculativeCount: speculativeApps.length,
  };

  res.json({ applications: merged, stats });
});

router.post("/applications", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const { roleId, notes, smartApply, applicationType, applicationUrl, companyName, cvDocumentId } = req.body as {
    roleId?: number;
    notes?: string;
    smartApply?: boolean;
    applicationType?: "platform" | "website";
    applicationUrl?: string;
    companyName?: string;
    cvDocumentId?: number | null;
  };

  const isWebsite = applicationType === "website";

  // Verify cvDocumentId belongs to the authenticated user (prevent IDOR / metadata disclosure)
  if (cvDocumentId) {
    const [cvDoc] = await db
      .select({ id: documentsTable.id })
      .from(documentsTable)
      .where(and(eq(documentsTable.id, cvDocumentId), eq(documentsTable.userId, userId)));
    if (!cvDoc) {
      res.status(403).json({ error: "Document not found or does not belong to you." });
      return;
    }
  }

  if (isWebsite) {
    if (!companyName || typeof companyName !== "string") {
      res.status(400).json({ error: "companyName is required for website applications." });
      return;
    }

    const [app] = await db
      .insert(applicationsTable)
      .values({
        userId,
        roleId: 0,
        applicationType: "website",
        applicationUrl: applicationUrl ?? null,
        companyName,
        notes: notes ?? null,
        status: "applied",
        cvDocumentId: cvDocumentId ?? null,
      })
      .returning();

    res.status(201).json(app);
    return;
  }

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
    .values({ userId, roleId, notes: notes ?? null, status: "applied", applicationType: "platform", cvDocumentId: cvDocumentId ?? null })
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

router.patch("/applications/:id/status", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid application ID" });
    return;
  }

  const { status } = req.body as { status?: string };
  const validStatuses = ["applied", "shortlisted", "interview", "interview_invited", "under_review", "offer", "rejected", "no_response"];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    return;
  }

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
    .set({ status: status as typeof existing.status })
    .where(eq(applicationsTable.id, id))
    .returning();

  res.json(updated);
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
