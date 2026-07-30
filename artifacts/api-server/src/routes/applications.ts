import { Router, type IRouter, type Request, type Response } from "express";
import { db, jobListingsTable, rolesTable, candidateMessagesTable, documentsTable, employerProfilesTable, sponsorLicenceVacanciesTable, sponsorLicencesTable } from "@workspace/db";
import { applicationsTable, speculativeApplicationsTable, ApplicationStatus } from "@workspace/db";
import { eq, and, inArray, desc, or } from "drizzle-orm";
import { requireAuthenticated } from "../middlewares/requireRole";
import { createApplicationReceivedMessage } from "../lib/systemMessages";
import { isBlockedVacancyUrl, isValidVacancyDeepLink } from "../lib/vacancyUrlPolicy";
import {
  checkDestinationDead,
  isPrivateIp,
  isPubliclyRoutableHost,
} from "../lib/linkHealth";
import {
  RECENT_VERIFY_SKIP_MS,
  isRecentlyVerifiedLive,
  markSponsorVacanciesDeadByUrl,
} from "../lib/vacancyLiveness";

const router: IRouter = Router();

// Dead-link detection helpers live in ../lib/linkHealth (shared with the
// background vacancy liveness sweep). Re-export for existing test imports.
export { isPrivateIp, isPubliclyRoutableHost };

// Apply-workflow privacy note:
// POST /applications records a job application in the database only.
// No CV or cover letter is emailed to employers through this path.
// JOBSAGE alias masking (personal email/phone redaction) is therefore not applicable here;
// masking is enforced at the point of any outbound document delivery (speculative CV flow).

// Outbound apply click tracking: records the click as a "website" application,
// then 302-redirects the candidate to the employer's page. Must be a same-origin
// navigation (plain <a href>) so the session cookie flows.
router.get("/applications/track-outbound", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const vacancyId = parseInt(String(req.query.vacancyId ?? ""), 10);
  const destinationUrl = typeof req.query.destinationUrl === "string" ? req.query.destinationUrl : "";
  // source=sponsor → vacancyId refers to the sponsor_licence_vacancies table
  // (AI-discovered sponsor vacancies) instead of the roles/job-listings id space.
  // source=careers → vacancyId refers to the sponsor_licences table; destination
  // must match that company's stored careers/website URL.
  // source=role-website → vacancyId is a roles/job-listings id, but the role has
  // no verified apply URL; destination must match its stored contact website.
  // Opportunities-page cards for AI-discovered sponsor vacancies carry ids of
  // sponsor_licence_vacancies.id + 2,000,000 — detect and unwrap that id space.
  const isDiscoveredSponsorVacancy = vacancyId > 2_000_000;
  const sponsorVacancyRowId = isDiscoveredSponsorVacancy ? vacancyId - 2_000_000 : vacancyId;
  const isSponsorSource = req.query.source === "sponsor" || (isDiscoveredSponsorVacancy && req.query.source !== "role-website");
  const isCareersSource = req.query.source === "careers";
  const isRoleWebsiteSource = req.query.source === "role-website";
  // Careers/company-website destinations are homepages by nature, so the
  // vacancy deep-link heuristics don't apply to them either.
  const skipDeepLinkChecks = isSponsorSource || isCareersSource || isRoleWebsiteSource;
  // Stored websites are sometimes saved without a protocol ("www.x.com").
  const normalizeStoredUrl = (u: string | null | undefined): string | null => {
    const t = u?.trim();
    if (!t) return null;
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
  };

  if (isNaN(vacancyId) || vacancyId <= 0) {
    res.status(400).json({ error: "vacancyId is required and must be a positive number." });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(destinationUrl);
  } catch {
    res.status(400).json({ error: "destinationUrl must be a valid absolute URL." });
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    res.status(400).json({ error: "destinationUrl must use http or https." });
    return;
  }
  // Sponsor vacancy leads are AI-discovered and may legitimately point at
  // aggregator/search-page URLs, so the aggregator blocklist and deep-link
  // heuristics are skipped for source=sponsor. The SSRF guard and the strict
  // canonical-URL exact-match check below still apply, so this cannot become
  // an open redirect.
  if (!skipDeepLinkChecks) {
    if (isBlockedVacancyUrl(destinationUrl)) {
      res.status(400).json({ error: "This destination is a third-party job aggregator and cannot be tracked. Please use the employer's own site." });
      return;
    }
    // Reject homepage-style destinations that are not deep-links to a specific vacancy.
    if (!isValidVacancyDeepLink(destinationUrl)) {
      res.status(400).json({
        error: "This apply link points to a generic page rather than a specific vacancy.",
        code: "INVALID_DEEP_LINK",
      });
      return;
    }
  }

  // SSRF guard: never health-check (or redirect to) private, loopback,
  // link-local, or unresolvable hosts.
  if (!(await isPubliclyRoutableHost(parsed.hostname))) {
    res.status(400).json({
      error: "This apply link does not point to a publicly reachable employer site.",
      code: "INVALID_DEEP_LINK",
    });
    return;
  }

  // Look up the role for the company name and its canonical stored apply URL
  // (handles both id ranges: >1M = employer job listings, otherwise imported roles).
  let companyName: string | null = null;
  let storedApplyUrl: string | null = null;
  if (isSponsorSource) {
    const [sv] = await db
      .select({ organisationName: sponsorLicenceVacanciesTable.organisationName, url: sponsorLicenceVacanciesTable.url })
      .from(sponsorLicenceVacanciesTable)
      .where(eq(sponsorLicenceVacanciesTable.id, sponsorVacancyRowId));
    companyName = sv?.organisationName ?? null;
    storedApplyUrl = sv?.url ?? null;
  } else if (isDiscoveredSponsorVacancy && isRoleWebsiteSource) {
    // "Apply via company website" fallback on a discovered sponsor vacancy card:
    // the website comes from the sponsor licence record, not a roles row.
    const [sv] = await db
      .select({ organisationName: sponsorLicenceVacanciesTable.organisationName })
      .from(sponsorLicenceVacanciesTable)
      .where(eq(sponsorLicenceVacanciesTable.id, sponsorVacancyRowId));
    companyName = sv?.organisationName ?? null;
    if (companyName) {
      const [sl] = await db
        .select({ website: sponsorLicencesTable.website })
        .from(sponsorLicencesTable)
        .where(eq(sponsorLicencesTable.organisationName, companyName));
      storedApplyUrl = normalizeStoredUrl(sl?.website);
    }
  } else if (isCareersSource) {
    const [sl] = await db
      .select({ organisationName: sponsorLicencesTable.organisationName, website: sponsorLicencesTable.website })
      .from(sponsorLicencesTable)
      .where(eq(sponsorLicencesTable.id, vacancyId));
    companyName = sl?.organisationName ?? null;
    storedApplyUrl = normalizeStoredUrl(sl?.website);
  } else if (vacancyId > 1_000_000) {
    const [job] = await db
      .select({ employerProfileId: jobListingsTable.employerProfileId, applyUrl: jobListingsTable.applyUrl })
      .from(jobListingsTable)
      .where(eq(jobListingsTable.id, vacancyId - 1_000_000));
    if (job) {
      storedApplyUrl = job.applyUrl ?? null;
      const [ep] = await db
        .select({ companyName: employerProfilesTable.companyName, contactWebsite: employerProfilesTable.contactWebsite })
        .from(employerProfilesTable)
        .where(eq(employerProfilesTable.id, job.employerProfileId));
      companyName = ep?.companyName ?? null;
      if (isRoleWebsiteSource) storedApplyUrl = normalizeStoredUrl(ep?.contactWebsite);
    }
  } else {
    const [role] = await db
      .select({ employer: rolesTable.employer, applyUrl: rolesTable.applyUrl, contactWebsite: rolesTable.contactWebsite })
      .from(rolesTable)
      .where(eq(rolesTable.id, vacancyId));
    companyName = role?.employer ?? null;
    storedApplyUrl = isRoleWebsiteSource ? normalizeStoredUrl(role?.contactWebsite) : (role?.applyUrl ?? null);
  }

  // Strict binding: the destination must exactly equal the vacancy's canonical
  // stored apply URL. Missing vacancy, missing/non-http stored URL, or any
  // mismatch is rejected — the query param must never be able to point the
  // server (or the candidate) somewhere the vacancy record does not.
  const canonical = storedApplyUrl?.trim() ?? "";
  if (!/^https?:\/\//i.test(canonical) || canonical !== destinationUrl) {
    res.status(400).json({
      error: "This apply link does not match the vacancy's registered apply URL.",
      code: "INVALID_DEEP_LINK",
    });
    return;
  }

  // Real-time health & expiration check. Timeouts and network/bot-block
  // failures are inconclusive: log a warning and let the redirect proceed.
  // Skip entirely when the background liveness sweep verified this exact URL
  // as live recently — the click-time check is only a last-resort safety net.
  let dead = false;
  let deadReason = "";
  const recentlyVerified = await isRecentlyVerifiedLive(destinationUrl).catch(() => false);
  if (recentlyVerified) {
    console.info(
      `[track-outbound] skipping health check for ${destinationUrl} — verified live by sweep within ${Math.round(RECENT_VERIFY_SKIP_MS / 3_600_000)}h`,
    );
  } else try {
    const result = await checkDestinationDead(destinationUrl);
    if (result.verdict === "unsafe") {
      console.warn(`[track-outbound] blocked unsafe redirect chain for ${destinationUrl}: ${result.reason}`);
      res.status(400).json({
        error: "This apply link does not point to a publicly reachable employer site.",
        code: "INVALID_DEEP_LINK",
      });
      return;
    }
    dead = result.verdict === "dead";
    deadReason = result.reason;
  } catch (err) {
    console.warn(
      `[track-outbound] health check inconclusive for ${destinationUrl}, allowing redirect:`,
      err instanceof Error ? err.message : err,
    );
  }
  if (dead) {
    if (isCareersSource || isRoleWebsiteSource) {
      // A dead careers/company homepage says nothing about a specific vacancy —
      // reject the redirect but do not mark anything closed.
      console.info(`[track-outbound] careers/website destination unreachable (${deadReason}) — ${destinationUrl}`);
      res.status(410).json({
        error: "The employer's website appears to be unreachable right now. Please try again later.",
        code: "SITE_UNREACHABLE",
      });
      return;
    }
    try {
      if (isSponsorSource) {
        // Sponsor vacancies live in their own table; mark all rows sharing
        // this URL dead so cards stop offering the link.
        await markSponsorVacanciesDeadByUrl(destinationUrl, deadReason).catch(() => {});
        console.info(`[track-outbound] sponsor vacancy ${vacancyId} marked dead (${deadReason}) — ${destinationUrl}`);
        res.status(410).json({
          error: "This vacancy is no longer accepting applications (closed by employer).",
          code: "JOB_EXPIRED",
        });
        return;
      }
      if (vacancyId > 1_000_000) {
        await db
          .update(jobListingsTable)
          .set({ status: "closed" })
          .where(eq(jobListingsTable.id, vacancyId - 1_000_000));
      } else {
        await db
          .update(rolesTable)
          .set({ active: false })
          .where(eq(rolesTable.id, vacancyId));
      }
      console.info(`[track-outbound] vacancy ${vacancyId} marked expired (${deadReason}) — ${destinationUrl}`);
      // Keep AI-discovered sponsor vacancies sharing this URL consistent too.
      await markSponsorVacanciesDeadByUrl(destinationUrl, deadReason).catch(() => {});
    } catch (expireErr) {
      console.warn(
        `[track-outbound] failed to mark vacancy ${vacancyId} expired:`,
        expireErr instanceof Error ? expireErr.message : expireErr,
      );
    }
    res.status(410).json({
      error: "This vacancy is no longer accepting applications (closed by employer).",
      code: "JOB_EXPIRED",
    });
    return;
  }

  // Upsert: repeat clicks on the same vacancy update the existing record instead of duplicating it.
  // Sponsor vacancies and sponsor licences have their own id spaces, which would collide
  // with roles ids — store roleId 0 for those and dedupe on the destination URL instead.
  const usesUrlDedupe = isSponsorSource || isCareersSource;
  const [existing] = await db
    .select({ id: applicationsTable.id })
    .from(applicationsTable)
    .where(
      usesUrlDedupe
        ? and(
            eq(applicationsTable.userId, userId),
            eq(applicationsTable.roleId, 0),
            eq(applicationsTable.applicationType, "website"),
            eq(applicationsTable.applicationUrl, destinationUrl),
          )
        : and(
            eq(applicationsTable.userId, userId),
            eq(applicationsTable.roleId, vacancyId),
            eq(applicationsTable.applicationType, "website"),
          ),
    );

  if (existing) {
    await db
      .update(applicationsTable)
      .set({ applicationUrl: destinationUrl, appliedAt: new Date(), ...(companyName ? { companyName } : {}) })
      .where(eq(applicationsTable.id, existing.id));
  } else {
    await db.insert(applicationsTable).values({
      userId,
      roleId: usesUrlDedupe ? 0 : vacancyId,
      applicationType: "website",
      applicationUrl: destinationUrl,
      companyName,
      // Clicking through to the employer site does not mean the candidate
      // completed the application — record "link_clicked"; they (or a future
      // browser extension) can upgrade it to "applied" later.
      status: "link_clicked",
    });
  }

  res.redirect(302, destinationUrl);
});

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
    deliveryRoute: s.deliveryRoute ?? null,
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
