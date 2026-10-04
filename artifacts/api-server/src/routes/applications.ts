import { Router, type IRouter, type Request, type Response } from "express";
import { db, jobListingsTable, rolesTable, candidateMessagesTable, documentsTable, employerProfilesTable, sponsorLicenceVacanciesTable, sponsorLicencesTable } from "@workspace/db";
import { applicationsTable, speculativeApplicationsTable, ApplicationStatus } from "@workspace/db";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { requireAuthenticated } from "../middlewares/requireRole";
import { createApplicationReceivedMessage } from "../lib/systemMessages";
import { resolveJobsageAlias } from "../lib/jobsageEmailGen";
import { SPONSOR_VACANCY_ID_OFFSET, isSponsorVacancyRoleId, sponsorVacancyIdFromRoleId } from "../lib/sponsorVacancyRoles";
import { getCandidateVacancyStatus } from "../lib/vacancyLiveness";

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
  const sponsorVacancyIds = platformApps
    .filter((a) => isSponsorVacancyRoleId(a.roleId))
    .map((a) => sponsorVacancyIdFromRoleId(a.roleId)!);
  const employerRoleIds = platformApps
    .filter((a) => a.roleId > 1_000_000 && !isSponsorVacancyRoleId(a.roleId))
    .map((a) => a.roleId - 1_000_000);
  const normalRoleIds = platformApps
    .filter((a) => a.roleId > 0 && a.roleId <= 1_000_000)
    .map((a) => a.roleId);

  const jobTitleMap: Record<number, {
    title: string;
    companyName?: string;
    location?: string;
    isClosed: boolean;
    livenessReason: string | null;
  }> = {};
  const [jobListingResults, normalRoleResults, sponsorVacancyResults] = await Promise.all([
    employerRoleIds.length > 0
      ? db
          .select({
            id: jobListingsTable.id,
            title: jobListingsTable.title,
            location: jobListingsTable.location,
            employerProfileId: jobListingsTable.employerProfileId,
            status: jobListingsTable.status,
            liveness: jobListingsTable.liveness,
            livenessReason: jobListingsTable.livenessReason,
          })
          .from(jobListingsTable)
          .where(inArray(jobListingsTable.id, employerRoleIds))
      : Promise.resolve([]),
    normalRoleIds.length > 0
      ? db
          .select({
            id: rolesTable.id,
            title: rolesTable.title,
            employer: rolesTable.employer,
            active: rolesTable.active,
            liveness: rolesTable.liveness,
            livenessReason: rolesTable.livenessReason,
          })
          .from(rolesTable)
          .where(inArray(rolesTable.id, normalRoleIds))
      : Promise.resolve([]),
    sponsorVacancyIds.length > 0
      ? db
          .select({
            id: sponsorLicenceVacanciesTable.id,
            title: sponsorLicenceVacanciesTable.title,
            location: sponsorLicenceVacanciesTable.location,
            organisationName: sponsorLicenceVacanciesTable.organisationName,
            companyName: sponsorLicencesTable.organisationName,
            liveness: sponsorLicenceVacanciesTable.liveness,
            lastVerifiedAt: sponsorLicenceVacanciesTable.lastVerifiedAt,
            sourceType: sponsorLicenceVacanciesTable.sourceType,
            livenessReason: sponsorLicenceVacanciesTable.livenessReason,
            closesAt: sponsorLicenceVacanciesTable.closesAt,
            expiresAt: sponsorLicenceVacanciesTable.expiresAt,
            closedReason: sponsorLicenceVacanciesTable.closedReason,
            sourceMissingSince: sponsorLicenceVacanciesTable.sourceMissingSince,
            sourceMissingObservations: sponsorLicenceVacanciesTable.sourceMissingObservations,
            companyVacancyEvidence: sponsorLicenceVacanciesTable.companyVacancyEvidence,
            companyEvidenceLegacyUntil: sponsorLicenceVacanciesTable.companyEvidenceLegacyUntil,
          })
          .from(sponsorLicenceVacanciesTable)
          .leftJoin(
            sponsorLicencesTable,
            eq(sponsorLicenceVacanciesTable.organisationName, sponsorLicencesTable.organisationName),
          )
          .where(inArray(sponsorLicenceVacanciesTable.id, sponsorVacancyIds))
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
      isClosed: job.status === "closed" || job.liveness === "dead",
      livenessReason: job.livenessReason ?? null,
    };
  }
  for (const role of normalRoleResults) {
    jobTitleMap[role.id] = {
      title: role.title,
      companyName: role.employer,
      isClosed: role.active === false || role.liveness === "dead",
      livenessReason: role.livenessReason ?? null,
    };
  }
  for (const vacancy of sponsorVacancyResults) {
    jobTitleMap[vacancy.id + SPONSOR_VACANCY_ID_OFFSET] = {
      title: vacancy.title,
      location: vacancy.location ?? undefined,
      companyName: vacancy.companyName ?? vacancy.organisationName,
       isClosed: getCandidateVacancyStatus({
         sourceType: vacancy.sourceType,
         lastVerifiedAt: vacancy.lastVerifiedAt,
         liveness: vacancy.liveness,
         closesAt: vacancy.closesAt,
         expiresAt: vacancy.expiresAt,
         closedReason: vacancy.closedReason,
         sourceMissingSince: vacancy.sourceMissingSince,
         sourceMissingObservations: vacancy.sourceMissingObservations,
         companyVacancyEvidence: vacancy.companyVacancyEvidence,
         companyEvidenceLegacyUntil: vacancy.companyEvidenceLegacyUntil,
       }) !== "visible",
      livenessReason: vacancy.livenessReason ?? null,
    };
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
    isClosed: jobTitleMap[a.roleId]?.isClosed ?? false,
    livenessReason: jobTitleMap[a.roleId]?.livenessReason ?? null,
  }));

  const enrichedWebsite = applications
    .filter((a) => (a.applicationType ?? "platform") === "website")
    .map((a) => ({
      ...a,
      roleTitle: a.jobTitle ?? a.companyName ?? "Website Application",
      roleLocation: null as string | null,
      applicationKind: "website" as const,
      companyName: a.companyName ?? null,
      jobsageEmail: null as string | null,
      vacancyTitle: null as string | null,
      emailSentAt: null as string | null,
      emailRecipient: null as string | null,
      cvLabel: a.cvDocumentId ? (cvLabelMap[a.cvDocumentId] ?? null) : null,
    isClosed: false,
    livenessReason: null as string | null,
    }));

  const enrichedSpeculative = speculativeApps.map((s) => ({
    id: s.id * -1,
    userId: s.userId,
    roleId: s.roleId ?? 0,
    applicationType: "speculative" as const,
    applicationUrl: s.vacancyUrl ?? null,
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
    deliveryRoute: s.deliveryRoute ?? null,
    deliveryStatus: s.deliveryStatus,
    deliveryError: s.deliveryError ?? null,
    boardName: s.boardName ?? null,
    sourceType: s.sourceType ?? null,
    vacancyRef: s.vacancyRef ?? null,
    cvLabel: s.cvDocumentId ? (cvLabelMap[s.cvDocumentId] ?? null) : null,
    isClosed: false,
    livenessReason: null as string | null,
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

router.delete("/applications/:id", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const rawId = String(req.params.id);
  const id = Number(rawId);

  if (!/^-?\d+$/.test(rawId) || !Number.isSafeInteger(id) || id === 0) {
    res.status(400).json({ error: "Invalid application ID" });
    return;
  }

  if (id < 0) {
    const [deleted] = await db
      .delete(speculativeApplicationsTable)
      .where(and(eq(speculativeApplicationsTable.id, Math.abs(id)), eq(speculativeApplicationsTable.userId, userId)))
      .returning({ id: speculativeApplicationsTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Application not found" });
      return;
    }
  } else {
    const [deleted] = await db
      .delete(applicationsTable)
      .where(and(eq(applicationsTable.id, id), eq(applicationsTable.userId, userId)))
      .returning({ id: applicationsTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Application not found" });
      return;
    }
  }

  res.status(204).send();
});

router.post("/applications", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const { roleId, notes, smartApply, applicationType, applicationUrl, pageUrl, companyName, jobTitle, status, cvDocumentId } = req.body as {
    roleId?: number;
    notes?: string;
    smartApply?: boolean;
    applicationType?: "platform" | "website";
    applicationUrl?: string;
    pageUrl?: string;
    companyName?: string;
    jobTitle?: string;
    status?: "link_clicked" | "in_progress" | "applied";
    cvDocumentId?: number | null;
  };

  const isWebsite = applicationType === "website";

  if (typeof roleId === "number" && isSponsorVacancyRoleId(roleId)) {
    const sponsorVacancyId = sponsorVacancyIdFromRoleId(roleId);
    const [sponsorVacancy] = await db
      .select({
        title: sponsorLicenceVacanciesTable.title,
        sourceType: sponsorLicenceVacanciesTable.sourceType,
        liveness: sponsorLicenceVacanciesTable.liveness,
        lastVerifiedAt: sponsorLicenceVacanciesTable.lastVerifiedAt,
        lastDiscoveredAt: sponsorLicenceVacanciesTable.lastDiscoveredAt,
        sourceMissingSince: sponsorLicenceVacanciesTable.sourceMissingSince,
        sourceMissingObservations: sponsorLicenceVacanciesTable.sourceMissingObservations,
        closesAt: sponsorLicenceVacanciesTable.closesAt,
        expiresAt: sponsorLicenceVacanciesTable.expiresAt,
        closedReason: sponsorLicenceVacanciesTable.closedReason,
        companyVacancyEvidence: sponsorLicenceVacanciesTable.companyVacancyEvidence,
        companyEvidenceLegacyUntil: sponsorLicenceVacanciesTable.companyEvidenceLegacyUntil,
      })
      .from(sponsorLicenceVacanciesTable)
      .where(eq(sponsorLicenceVacanciesTable.id, sponsorVacancyId!))
      .limit(1);
    if (!sponsorVacancy || getCandidateVacancyStatus(sponsorVacancy) !== "visible") {
      res.status(409).json({ error: "This vacancy is no longer available for applications." });
      return;
    }
  }

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

    // Extension confirmation logging sends pageUrl; first-party click tracking
    // sends applicationUrl. Both must converge on the same exact URL.
    const resolvedApplicationUrl =
      typeof applicationUrl === "string" && applicationUrl.length > 0
        ? applicationUrl
        : typeof pageUrl === "string" && pageUrl.length > 0
          ? pageUrl
          : null;
    const requestedStatus = status === "in_progress" ? "in_progress" : status === "link_clicked" ? "link_clicked" : "applied";

    const websiteApplication = await db.transaction(async (tx) => {
      // Serialise concurrent retries for the same candidate and exact outbound
      // URL. This avoids duplicate tracker rows without requiring a destructive
      // cleanup of any pre-existing manual website-application entries.
      if (resolvedApplicationUrl) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`website:${userId}:${resolvedApplicationUrl}`}))`,
        );
        const [existing] = await tx
          .select()
          .from(applicationsTable)
          .where(
            and(
              eq(applicationsTable.userId, userId),
              eq(applicationsTable.applicationType, "website"),
              eq(applicationsTable.applicationUrl, resolvedApplicationUrl),
            ),
          );

        if (existing) {
          const pending = existing.status === "link_clicked" || existing.status === "in_progress";
          const shouldUpgrade = requestedStatus === "applied" && pending;
          const isFirstPartyClick = requestedStatus === "link_clicked" || requestedStatus === "in_progress";
          const jobsageEmail = existing.jobsageEmail ?? await resolveJobsageAlias(userId);
          const [updated] = await tx
            .update(applicationsTable)
            .set({
              // First-party Opportunities metadata is authoritative. Extension
              // confirmation pages often expose generic success copy instead of
              // the original vacancy title and employer.
              roleId: isFirstPartyClick && typeof roleId === "number" && roleId > 0
                ? roleId
                : existing.roleId > 0
                ? existing.roleId
                : typeof roleId === "number" && roleId > 0
                  ? roleId
                  : 0,
              companyName: isFirstPartyClick ? companyName : existing.companyName || companyName,
              jobTitle: isFirstPartyClick
                ? typeof jobTitle === "string" && jobTitle.length > 0 ? jobTitle : existing.jobTitle
                : existing.jobTitle || (typeof jobTitle === "string" && jobTitle.length > 0 ? jobTitle : null),
              applicationUrl: resolvedApplicationUrl,
              notes: typeof notes === "string" ? notes : existing.notes,
              status: shouldUpgrade ? "applied" : pending && requestedStatus === "in_progress" ? "in_progress" : existing.status,
              appliedAt: pending && requestedStatus === "in_progress" ? new Date() : existing.appliedAt,
              cvDocumentId: cvDocumentId ?? existing.cvDocumentId,
              jobsageEmail,
            })
            .where(eq(applicationsTable.id, existing.id))
            .returning();

          return { application: updated, created: false };
        }
      }

      const jobsageEmail = await resolveJobsageAlias(userId);
      const [application] = await tx
        .insert(applicationsTable)
        .values({
          userId,
          roleId: typeof roleId === "number" && roleId > 0 ? roleId : 0,
          applicationType: "website",
          applicationUrl: resolvedApplicationUrl,
          companyName,
          jobTitle: typeof jobTitle === "string" && jobTitle.length > 0 ? jobTitle : null,
          notes: notes ?? null,
          status: requestedStatus,
          cvDocumentId: cvDocumentId ?? null,
          jobsageEmail,
        })
        .returning();

      return { application, created: true };
    });

    res.status(websiteApplication.created ? 201 : 200).json(websiteApplication.application);
    return;
  }

  if (!roleId || typeof roleId !== "number") {
    res.status(400).json({ error: "roleId is required and must be a number." });
    return;
  }

  if (isSponsorVacancyRoleId(roleId)) {
    const sponsorVacancyId = sponsorVacancyIdFromRoleId(roleId)!;
    const [vacancy] = await db
      .select({
        title: sponsorLicenceVacanciesTable.title,
        sourceType: sponsorLicenceVacanciesTable.sourceType,
        liveness: sponsorLicenceVacanciesTable.liveness,
        lastVerifiedAt: sponsorLicenceVacanciesTable.lastVerifiedAt,
        lastDiscoveredAt: sponsorLicenceVacanciesTable.lastDiscoveredAt,
        sourceMissingSince: sponsorLicenceVacanciesTable.sourceMissingSince,
        sourceMissingObservations: sponsorLicenceVacanciesTable.sourceMissingObservations,
        closesAt: sponsorLicenceVacanciesTable.closesAt,
        expiresAt: sponsorLicenceVacanciesTable.expiresAt,
        closedReason: sponsorLicenceVacanciesTable.closedReason,
        companyVacancyEvidence: sponsorLicenceVacanciesTable.companyVacancyEvidence,
        companyEvidenceLegacyUntil: sponsorLicenceVacanciesTable.companyEvidenceLegacyUntil,
      })
      .from(sponsorLicenceVacanciesTable)
      .where(eq(sponsorLicenceVacanciesTable.id, sponsorVacancyId));
    if (!vacancy || getCandidateVacancyStatus({ ...vacancy }) !== "visible") {
      res.status(409).json({ error: "This vacancy is no longer available for applications." });
      return;
    }
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
  if (isSponsorVacancyRoleId(roleId)) {
    const sponsorVacancyId = sponsorVacancyIdFromRoleId(roleId)!;
    const [vacancy] = await db
      .select({ title: sponsorLicenceVacanciesTable.title })
      .from(sponsorLicenceVacanciesTable)
      .where(eq(sponsorLicenceVacanciesTable.id, sponsorVacancyId));
    if (vacancy) roleTitle = vacancy.title;
  } else if (roleId > 1_000_000) {
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

router.post("/applications/confirm-submission", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const { applicationUrl } = req.body as { applicationUrl?: unknown };

  if (typeof applicationUrl !== "string" || applicationUrl.trim().length === 0) {
    res.status(400).json({ error: "applicationUrl is required." });
    return;
  }

  try {
    const url = new URL(applicationUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Unsupported protocol");
    }
  } catch {
    res.status(400).json({ error: "applicationUrl must be a valid HTTP(S) URL." });
    return;
  }

  const confirmation = await db.transaction(async (tx) => {
    // A confirmation page can be detected more than once while an ATS
    // redirects or re-renders. Lock the user/URL pair so retries converge on
    // one existing first-party click record and cannot create duplicates.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`website:${userId}:${applicationUrl}`}))`,
    );

    const [existing] = await tx
      .select()
      .from(applicationsTable)
      .where(
        and(
          eq(applicationsTable.userId, userId),
          eq(applicationsTable.applicationType, "website"),
          eq(applicationsTable.applicationUrl, applicationUrl),
        ),
      );

    if (!existing) return { application: null, updated: false };

    // Only the initial click state may be promoted. A later candidate or
    // employer update (for example interview, offer, or rejection) always
    // wins over a delayed confirmation event from the browser extension.
    if (existing.status !== "link_clicked" && existing.status !== "in_progress") {
      return { application: existing, updated: false };
    }

    const jobsageEmail = existing.jobsageEmail ?? await resolveJobsageAlias(userId);
    const [updated] = await tx
      .update(applicationsTable)
      .set({ status: "applied", jobsageEmail })
      .where(eq(applicationsTable.id, existing.id))
      .returning();

    return { application: updated, updated: true };
  });

  if (!confirmation.application) {
    res.status(404).json({
      error: "No tracked JOBSAGE application was found for this application URL.",
    });
    return;
  }

  res.json(confirmation);
});

router.patch("/applications/:id/status", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid application ID" });
    return;
  }

  const { status } = req.body as { status?: string };
  const validStatuses: string[] = Object.values(ApplicationStatus);
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
