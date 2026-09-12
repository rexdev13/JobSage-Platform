import { Router, type IRouter } from "express";
import { requireAuthenticated } from "../middlewares/requireRole";
import { db } from "@workspace/db";
import {
  speculativeApplicationsTable,
  speculativeApplicationDeliveryAttemptsTable,
  employerProfilesTable,
  sponsorLicencesTable,
  documentsTable,
  candidateMessagesTable,
  usersTable,
  sponsorLicenceVacanciesTable,
  rolesTable,
} from "@workspace/db";
import { eq, and, desc, ilike, gte, count, sql } from "drizzle-orm";
import { writeAuditEvent } from "../lib/audit";
import { sendSpeculativeCVNotification, sendSpeculativeCVToOps } from "../lib/email";
import { ObjectStorageService } from "../lib/objectStorage";
import { maskPersonalContactInfo, resolveJobsageAlias } from "../lib/jobsageEmailGen";
import {
  isUsableEmployerEmail,
  resolveEmployerRecipient,
  type DeliveryRoute,
  type RecipientResolution,
} from "../lib/employerRecipient";
import { SPONSOR_VACANCY_ID_OFFSET } from "../lib/sponsorVacancyRoles";
import { getVacancyLinkStatus } from "../lib/vacancyLiveness";
import { buildCoverLetterPdf, safeCoverLetterFilename } from "../lib/coverLetterPdf";

const APP_URL = process.env.APP_URL ?? "https://jobsage.co.uk";

export { isUsableEmployerEmail, resolveEmployerRecipient };
export type { DeliveryRoute, RecipientResolution };

export function shouldRejectOperationsFallback(
  requireDirectContact: boolean | undefined,
  deliveryRoute: DeliveryRoute,
): boolean {
  return requireDirectContact === true && deliveryRoute === "ops_fallback";
}

export function getSendCvDeliveryState(input: {
  hasEmailDestination: boolean;
  emailDelivered: boolean;
  deliveryFailure: string | null;
}): "delivered" | "pending" | "failed" {
  if (input.emailDelivered) return "delivered";
  if (!input.deliveryFailure && !input.hasEmailDestination) return "pending";
  return "failed";
}

export function getVacancySubmissionError(
  storedUrl: string | null,
  submittedUrl: string | null,
  linkStatus: ReturnType<typeof getVacancyLinkStatus>,
): string | null {
  if (storedUrl !== submittedUrl) {
    return "The submitted vacancy link does not match the stored vacancy. Please refresh and try again.";
  }
  if (linkStatus === "none" || linkStatus === "live") return null;
  return linkStatus === "dead"
    ? "This vacancy is no longer open, so a vacancy-specific CV cannot be sent."
    : "This vacancy link is not currently verified live. Please refresh after it has been checked.";
}

const router: IRouter = Router();

router.get("/speculative-applications", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const apps = await db
    .select()
    .from(speculativeApplicationsTable)
    .where(eq(speculativeApplicationsTable.userId, userId))
    .orderBy(desc(speculativeApplicationsTable.createdAt));

  res.json({ applications: apps });
});

router.post("/speculative-applications", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const {
    companyName,
    sponsorLicenceId,
    notes,
    vacancyTitle,
    cvDocumentId,
    vacancyRef,
    roleId,
    vacancyUrl,
    sourceType,
    boardName,
    includeCoverLetter,
    coverLetterGeneratedText,
    coverLetterText,
  } = req.body as {
    companyName?: string;
    sponsorLicenceId?: number | null;
    notes?: string | null;
    vacancyTitle?: string | null;
    cvDocumentId?: number | null;
    vacancyRef?: string | null;
    roleId?: number | null;
    vacancyUrl?: string | null;
    sourceType?: "job_board" | "company_site" | null;
    boardName?: string | null;
    requireDirectContact?: boolean;
    includeCoverLetter?: boolean;
    coverLetterGeneratedText?: string | null;
    coverLetterText?: string | null;
  };

  if (!companyName || typeof companyName !== "string" || companyName.trim().length === 0) {
    res.status(400).json({ error: "companyName is required." });
    return;
  }
  if (sourceType != null && sourceType !== "job_board" && sourceType !== "company_site") {
    res.status(400).json({ error: "sourceType must be job_board or company_site." });
    return;
  }
  if (includeCoverLetter === true && (typeof coverLetterText !== "string" || !coverLetterText.trim())) {
    res.status(400).json({ error: "A completed cover letter is required when includeCoverLetter is true." });
    return;
  }
  if (
    (coverLetterText != null && typeof coverLetterText !== "string") ||
    (coverLetterGeneratedText != null && typeof coverLetterGeneratedText !== "string")
  ) {
    res.status(400).json({ error: "Cover letter text must be a string." });
    return;
  }
  if (vacancyUrl) {
    try {
      const parsed = new URL(vacancyUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
    } catch {
      res.status(400).json({ error: "vacancyUrl must be a valid HTTP(S) URL." });
      return;
    }
  }

  const normalizedCompanyName = companyName.trim();
  const normalizedVacancyTitle = vacancyTitle?.trim() || null;
  const normalizedVacancyRef =
    vacancyRef?.trim() ||
    (roleId ? `role:${roleId}` : sponsorLicenceId ? `sponsor:${sponsorLicenceId}:general` : `company:${normalizedCompanyName.toLowerCase()}`);

  if (roleId != null || vacancyUrl != null || vacancyRef?.startsWith("sponsor-vacancy:")) {
    let storedUrl: string | null = null;
    let linkStatus: ReturnType<typeof getVacancyLinkStatus> = "none";
    const rawSponsorVacancyId = vacancyRef?.startsWith("sponsor-vacancy:")
      ? Number(vacancyRef.slice("sponsor-vacancy:".length))
      : roleId != null && roleId > SPONSOR_VACANCY_ID_OFFSET
        ? roleId - SPONSOR_VACANCY_ID_OFFSET
        : null;
    if (rawSponsorVacancyId != null && Number.isInteger(rawSponsorVacancyId) && rawSponsorVacancyId > 0) {
      const [stored] = await db
        .select({
          url: sponsorLicenceVacanciesTable.url,
          liveness: sponsorLicenceVacanciesTable.liveness,
          lastVerifiedAt: sponsorLicenceVacanciesTable.lastVerifiedAt,
          livenessReason: sponsorLicenceVacanciesTable.livenessReason,
        })
        .from(sponsorLicenceVacanciesTable)
        .where(eq(sponsorLicenceVacanciesTable.id, rawSponsorVacancyId))
        .limit(1);
      if (!stored) {
        res.status(422).json({ error: "This vacancy could not be found. Please refresh and try again." });
        return;
      }
      storedUrl = stored.url?.trim() || null;
      linkStatus = getVacancyLinkStatus(storedUrl, stored.liveness, stored.lastVerifiedAt, stored.livenessReason);
    } else if (roleId != null) {
      const [stored] = await db
        .select({
          applyUrl: rolesTable.applyUrl,
          liveness: rolesTable.liveness,
          lastVerifiedAt: rolesTable.lastVerifiedAt,
          livenessReason: rolesTable.livenessReason,
        })
        .from(rolesTable)
        .where(eq(rolesTable.id, roleId))
        .limit(1);
      storedUrl = stored?.applyUrl?.trim() || null;
      linkStatus = getVacancyLinkStatus(
        storedUrl,
        stored?.liveness,
        stored?.lastVerifiedAt,
        stored?.livenessReason,
      );
    }
    const submissionError = getVacancySubmissionError(
      storedUrl,
      vacancyUrl?.trim() || null,
      linkStatus,
    );
    if (submissionError) {
      res.status(422).json({ error: submissionError });
      return;
    }
  }

  const user = req.user!;
  const candidateName =
    [(user as { firstName?: string }).firstName, (user as { lastName?: string }).lastName]
      .filter(Boolean)
      .join(" ") || "there";

  // Resolve the candidate's JOBSAGE alias (users table first, profiles table fallback).
  // Must exist before we can send — personal email must never be exposed to employers.
  // Alias is assigned at registration; login-time backfill covers legacy accounts.
  const jobsageEmail = await resolveJobsageAlias(userId);
  if (!jobsageEmail) {
    res.status(400).json({
      error: "No JOBSAGE email alias found. Please visit your Profile page to set one up before sending a speculative application.",
    });
    return;
  }

  // Resolve only persisted employer/sponsor contact evidence. When no
  // destination exists, the Send CV record is retained and left pending
  // rather than guessing an address or routing the candidate's documents to
  // the operations inbox.
  const resolvedRecipient = await resolveEmployerRecipient(
    normalizedCompanyName,
    sponsorLicenceId,
  );

  // Resolve the candidate's CV document:
  // 1. If the caller explicitly chose a CV (cvDocumentId), use that document.
  // 2. Otherwise prefer isPrimary=true CV, then any documentType="cv", then most recent.
  const allDocs = await db
    .select({
      id: documentsTable.id,
      filename: documentsTable.filename,
      mimeType: documentsTable.mimeType,
      storageKey: documentsTable.storageKey,
      documentType: documentsTable.documentType,
      isPrimary: documentsTable.isPrimary,
      label: documentsTable.label,
    })
    .from(documentsTable)
    .where(eq(documentsTable.userId, userId))
    .orderBy(desc(documentsTable.uploadedAt));
  // Only consider documentType="cv" documents for CV resolution
  const cvDocs = allDocs.filter((d) => d.documentType === "cv");
  let cvDocument: (typeof cvDocs)[0] | null = null;
  if (cvDocumentId) {
    // Explicit pick: must be a CV document owned by this user
    cvDocument = cvDocs.find((d) => d.id === cvDocumentId) ?? null;
    if (!cvDocument) {
      res.status(400).json({ error: "Selected CV document not found or is not a CV. Please choose a valid CV and try again." });
      return;
    }
  } else {
    // Fallback order: primary CV → first CV → none
    cvDocument = cvDocs.find((d) => d.isPrimary) ?? cvDocs[0] ?? null;
  }

  if (!cvDocument) {
    res.status(400).json({ error: "A CV is required. Please upload a PDF CV and try again." });
    return;
  }
  if (cvDocument.mimeType !== "application/pdf" || !cvDocument.filename.toLowerCase().endsWith(".pdf")) {
    res.status(422).json({
      error: "Your CV must be in PDF format. Please upload a PDF CV and try again.",
    });
    return;
  }

  const SEND_CV_DAILY_LIMIT = 25;
  const DUPLICATE_CLICK_WINDOW_MS = 2 * 60 * 1000;
  let app: typeof speculativeApplicationsTable.$inferSelect;
  let attemptId: number;
  let alreadySent = false;
  try {
    const prepared = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`send-cv:${userId}:${normalizedVacancyRef}`}))`);
      const [rateRow] = await tx
        .select({ attempts: count() })
        .from(speculativeApplicationDeliveryAttemptsTable)
        .where(
          and(
            eq(speculativeApplicationDeliveryAttemptsTable.userId, userId),
            gte(speculativeApplicationDeliveryAttemptsTable.attemptedAt, new Date(Date.now() - 86_400_000)),
          ),
        );
      if ((rateRow?.attempts ?? 0) >= SEND_CV_DAILY_LIMIT) {
        throw Object.assign(new Error("Daily Send CV limit reached. Please try again later."), { statusCode: 429 });
      }

      const [existing] = await tx
        .select()
        .from(speculativeApplicationsTable)
        .where(and(
          eq(speculativeApplicationsTable.userId, userId),
          eq(speculativeApplicationsTable.vacancyRef, normalizedVacancyRef),
        ))
        .limit(1);
      if (
        existing?.deliveryStatus === "pending" &&
        existing.lastDeliveryAttemptAt &&
        Date.now() - existing.lastDeliveryAttemptAt.getTime() < DUPLICATE_CLICK_WINDOW_MS
      ) {
        throw Object.assign(new Error("This CV is already being sent. Please wait before trying again."), { statusCode: 409 });
      }

      const pendingValues = {
        companyName: normalizedCompanyName,
        sponsorLicenceId: sponsorLicenceId ?? null,
        status: "cv_sent" as const,
        notes: notes ?? null,
        vacancyTitle: normalizedVacancyTitle,
        vacancyRef: normalizedVacancyRef,
        roleId: roleId ?? null,
        vacancyUrl: vacancyUrl ?? null,
        sourceType: sourceType ?? null,
        boardName: boardName ?? null,
        cvDocumentId: cvDocument.id,
        coverLetterDocumentId: null,
        coverLetterFilename: null,
        coverLetterIncluded: false,
        jobsageEmail,
        deliveryStatus: "pending" as const,
        deliveryError: null,
        deliveryAttempts: (existing?.deliveryAttempts ?? 0) + 1,
        lastDeliveryAttemptAt: new Date(),
        attachmentType: "pdf" as const,
        emailSent: false,
      };
      const [pendingApp] = existing
        ? await tx.update(speculativeApplicationsTable).set(pendingValues).where(eq(speculativeApplicationsTable.id, existing.id)).returning()
        : await tx.insert(speculativeApplicationsTable).values({ userId, ...pendingValues }).returning();
      const [attempt] = await tx
        .insert(speculativeApplicationDeliveryAttemptsTable)
        .values({ speculativeApplicationId: pendingApp!.id, userId, outcome: "pending" })
        .returning({ id: speculativeApplicationDeliveryAttemptsTable.id });
      return { app: pendingApp!, attemptId: attempt!.id, alreadySent: Boolean(existing) };
    });
    app = prepared.app;
    attemptId = prepared.attemptId;
    alreadySent = prepared.alreadySent;
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 409 || statusCode === 429) {
      if (statusCode === 429) res.setHeader("Retry-After", "86400");
      res.status(statusCode).json({ error: error instanceof Error ? error.message : "Could not start CV delivery." });
      return;
    }
    throw error;
  }

  let cvContent: Buffer | null = null;
  let coverLetterContent: Buffer | null = null;
  let coverLetterDocumentId: number | null = null;
  let coverLetterFilename: string | null = null;
  let persistedGeneratedCoverLetterText: string | null = null;
  let persistedFinalCoverLetterText: string | null = null;
  let deliveryFailure: string | null = null;
  if (cvDocument.storageKey) {
    try {
      const storage = new ObjectStorageService();
      const gcsFile = await storage.getObjectEntityFile(cvDocument.storageKey);
      const [downloaded] = await gcsFile.download();
      cvContent = downloaded as Buffer;
    } catch (err: unknown) {
      console.error("[speculative] Could not fetch CV from storage:", err);
      deliveryFailure = "The selected PDF CV could not be loaded from secure storage.";
    }
  }

  if (!deliveryFailure && cvContent && includeCoverLetter === true) {
    try {
      const storage = new ObjectStorageService();
      persistedFinalCoverLetterText = maskPersonalContactInfo(coverLetterText!.trim(), jobsageEmail);
      persistedGeneratedCoverLetterText = coverLetterGeneratedText?.trim()
        ? maskPersonalContactInfo(coverLetterGeneratedText.trim(), jobsageEmail)
        : persistedFinalCoverLetterText;
      coverLetterFilename = safeCoverLetterFilename(normalizedCompanyName, normalizedVacancyTitle);
      coverLetterContent = await buildCoverLetterPdf({
        candidateName,
        jobsageEmail,
        companyName: normalizedCompanyName,
        vacancyTitle: normalizedVacancyTitle,
        finalText: persistedFinalCoverLetterText,
        date: new Date(),
      });

      if (
        coverLetterContent.length > 2 * 1024 * 1024 ||
        cvContent.length + coverLetterContent.length > 10 * 1024 * 1024
      ) {
        throw new Error("The CV and cover letter exceed the safe email attachment size.");
      }

      const storageKey = await storage.saveFileBuffer({
        buffer: coverLetterContent,
        contentType: "application/pdf",
      });
      await storage.trySetObjectEntityAclPolicy(storageKey, {
        owner: userId,
        visibility: "private",
      });
      const [coverLetterDocument] = await db
        .insert(documentsTable)
        .values({
          userId,
          filename: coverLetterFilename,
          mimeType: "application/pdf",
          storageKey,
          fileSize: coverLetterContent.length,
          documentType: "cover_letter",
          label: `Cover letter for ${normalizedVacancyTitle ?? normalizedCompanyName}`,
          isPrimary: false,
          parsedData: {
            generatedText: persistedGeneratedCoverLetterText,
            finalText: persistedFinalCoverLetterText,
            sourceCvDocumentId: cvDocument.id,
            companyName: normalizedCompanyName,
            sponsorLicenceId: sponsorLicenceId ?? null,
            vacancyTitle: normalizedVacancyTitle,
            vacancyRef: normalizedVacancyRef,
            roleId: roleId ?? null,
            applicationId: app.id,
            includedInSend: false,
          },
        } as any)
        .returning({ id: documentsTable.id });
      coverLetterDocumentId = coverLetterDocument?.id ?? null;
      if (coverLetterDocumentId == null) {
        throw new Error("The cover letter could not be persisted.");
      }
    } catch (err: unknown) {
      console.error("[speculative] Could not build the cover letter attachment:", err);
      deliveryFailure = err instanceof Error
        ? err.message
        : "The cover letter attachment could not be prepared.";
      coverLetterContent = null;
    }
  }

  // Mask personal contact info in the cover note if we have a JOBSAGE alias
  const maskedNotes = notes && jobsageEmail ? maskPersonalContactInfo(notes, jobsageEmail) : (notes ?? null);

  const { email: employerContactEmail, route: deliveryRoute } = resolvedRecipient;
  const hasEmailDestination = deliveryRoute !== "ops_fallback";

  // Fire outbound emails and persist delivery metadata.
  // Step 1: Send the CV to the employer/ops — this determines actual delivery.
  // Step 2: Only after confirming success, send the candidate confirmation with accurate wording.
  const now = new Date();
  let emailDelivered = false;
  if (!deliveryFailure && cvContent && hasEmailDestination) {
    try {
      await sendSpeculativeCVToOps({
      candidateEmail: user.email as string,
      candidateName,
      candidateUserId: userId,
      companyName: normalizedCompanyName,
      applicationId: app.id,
      cvFilename: cvDocument.filename,
      cvContent,
       coverLetterFilename,
       coverLetterContent,
      vacancyTitle: normalizedVacancyTitle,
      vacancyUrl: vacancyUrl ?? null,
      notes: maskedNotes,
      jobsageEmail,
      recipientEmail: employerContactEmail,
      });
      emailDelivered = true;
    } catch (err: unknown) {
      console.error("[speculative] Failed to send CV to employer/ops:", err);
      deliveryFailure = err instanceof Error ? err.message : "Email delivery failed.";
    }
  } else if (!deliveryFailure && !cvContent) {
    deliveryFailure = "The selected PDF CV was empty.";
  }
  const deliveryState = getSendCvDeliveryState({
    hasEmailDestination,
    emailDelivered,
    deliveryFailure,
  });
  const deliveryDeferred = deliveryState === "pending";

  // Candidate confirmation: only sent when the employer email actually succeeded.
  // If delivery failed we do not send a confirmation — the application is persisted in the
  // tracker and the candidate can retry. Wording reflects the confirmed delivery route.
  if (emailDelivered) {
    try {
      await sendSpeculativeCVNotification({
        candidateEmail: user.email as string,
        candidateName,
        companyName: normalizedCompanyName,
        deliveryRoute,
      });
    } catch (notifyErr: unknown) {
      console.error("[speculative] Failed to send candidate confirmation:", notifyErr);
    }
  }

  const [finalApp] = await db
    .update(speculativeApplicationsTable)
    .set({
      cvDocumentId: cvDocument.id,
      coverLetterDocumentId,
      coverLetterFilename,
      coverLetterIncluded: emailDelivered && coverLetterDocumentId != null,
      emailSent: emailDelivered,
      emailSentAt: emailDelivered ? now : null,
      emailRecipient: hasEmailDestination ? employerContactEmail : null,
      jobsageEmail,
      deliveryRoute: hasEmailDestination ? deliveryRoute : null,
      deliveryStatus: deliveryState,
      deliveryError: emailDelivered || deliveryDeferred ? null : deliveryFailure,
    })
    .where(eq(speculativeApplicationsTable.id, app.id))
    .returning();
  if (
    coverLetterDocumentId != null &&
    persistedGeneratedCoverLetterText != null &&
    persistedFinalCoverLetterText != null
  ) {
    await db
      .update(documentsTable)
      .set({
        parsedData: {
          generatedText: persistedGeneratedCoverLetterText,
          finalText: persistedFinalCoverLetterText,
          sourceCvDocumentId: cvDocument.id,
          companyName: normalizedCompanyName,
          sponsorLicenceId: sponsorLicenceId ?? null,
          vacancyTitle: normalizedVacancyTitle,
          vacancyRef: normalizedVacancyRef,
          roleId: roleId ?? null,
          applicationId: app.id,
          includedInSend: emailDelivered,
          sentAt: emailDelivered ? now.toISOString() : null,
        },
      } as any)
      .where(
        and(
          eq(documentsTable.id, coverLetterDocumentId),
          eq(documentsTable.userId, userId),
        ),
      );
  }
  await db
    .update(speculativeApplicationDeliveryAttemptsTable)
    .set({
      outcome: deliveryState,
      completedAt: deliveryDeferred ? null : now,
      error: emailDelivered || deliveryDeferred ? null : deliveryFailure,
    })
    .where(eq(speculativeApplicationDeliveryAttemptsTable.id, attemptId));

  // Create inbox notification only when email was actually delivered —
  // guards against false "sent" confirmations on delivery failure.
  if (emailDelivered) {
    const deliveryRouteLabels: Record<DeliveryRoute, string> = {
      employer_contact_email: "direct to employer (stored contact email)",
      employer_account: "direct to employer (JOBSAGE account)",
      sponsor_contact_email: "direct to employer (registered contact email)",
      ops_fallback: "JOBSAGE ops team (no direct email found — they will forward)",
    };
    const isDirectSend = deliveryRoute !== "ops_fallback";
    try {
      await db.insert(candidateMessagesTable).values({
        recipientUserId: userId,
        messageType: "system",
        subject: "Speculative CV sent",
        messageText: [
          `Your CV has been submitted to ${normalizedCompanyName}${normalizedVacancyTitle ? ` for the role "${normalizedVacancyTitle}"` : ""}.`,
          ``,
          `Your contact identity: ${jobsageEmail}`,
          `Delivered: ${deliveryRouteLabels[deliveryRoute]}`,
          `Date sent: ${now.toUTCString()}`,
          ``,
          isDirectSend
            ? `Your CV was sent directly to ${normalizedCompanyName}. The employer can reply to your JOBSAGE alias.`
            : `No stored contact email was available for ${normalizedCompanyName}. The JOBSAGE team has been notified and will follow up on your behalf.`,
          ``,
          `Follow up or track this application: ${APP_URL}/applications`,
        ].join("\n"),
      });
    } catch (msgErr) {
      // Inbox notification is best-effort — main response must not fail
      console.error("[speculative] Could not create inbox notification:", msgErr);
    }
  }

  // Audit logging: record the delivery route taken and flag for admin action
  // only when we truly had to fall back to the ops inbox.
  try {
    const [empProfile] = await db
      .select({ userId: employerProfilesTable.userId, id: employerProfilesTable.id })
      .from(employerProfilesTable)
      .where(ilike(employerProfilesTable.companyName, normalizedCompanyName))
      .limit(1);

    if (empProfile) {
      // Employer has a JOBSAGE account — log for their future dashboard
      await writeAuditEvent(
        `user:${userId}`,
        "speculative_cv_sent_to_employer",
        `employer:${empProfile.userId}`,
        {
          companyName: normalizedCompanyName,
          applicationId: app.id,
          vacancyRef: normalizedVacancyRef,
          employerProfileId: empProfile.id,
          hasEmployerAccount: true,
          deliveryRoute,
        },
      );
    } else if (deliveryRoute === "ops_fallback") {
      // True fallback: no email found anywhere — ops must follow up
      await writeAuditEvent(
        `user:${userId}`,
        "speculative_cv_admin_followup",
        undefined,
        {
          companyName: normalizedCompanyName,
          applicationId: app.id,
          vacancyRef: normalizedVacancyRef,
          hasEmployerAccount: false,
          deliveryRoute,
          needsAdminAction: true,
          lookupStepsAttempted: ["sponsor_contact_email", "employer_contact_email", "employer_account"],
          adminNote: `Candidate sent a CV to "${normalizedCompanyName}". No employer account or stored contact email was available. Admin should follow up or invite the company.`,
        },
      );
    } else {
      // No JOBSAGE account but we found a direct email — informational log only
      await writeAuditEvent(
        `user:${userId}`,
        "speculative_cv_sent_direct",
        undefined,
        {
          companyName: normalizedCompanyName,
          applicationId: app.id,
          vacancyRef: normalizedVacancyRef,
          hasEmployerAccount: false,
          deliveryRoute,
          needsAdminAction: false,
        },
      );
    }
  } catch {
    // Notification logging is best-effort — don't fail the main request
  }

  if (deliveryState === "failed") {
    res.status(502).json({
      error: "CV delivery failed. The attempt is saved and can be retried.",
      application: finalApp ?? app,
    });
    return;
  }

  res.status(201).json({ application: finalApp ?? app, alreadySent, resent: alreadySent });
});

router.patch("/speculative-applications/:id/status", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid application ID" });
    return;
  }

  const { status } = req.body as { status?: string };
  const validStatuses = ["cv_sent", "sent", "acknowledged", "no_account", "under_review", "interview_invited", "offer", "rejected"];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    return;
  }

  const [existing] = await db
    .select()
    .from(speculativeApplicationsTable)
    .where(and(eq(speculativeApplicationsTable.id, id), eq(speculativeApplicationsTable.userId, userId)));

  if (!existing) {
    res.status(404).json({ error: "Speculative application not found" });
    return;
  }

  const [updated] = await db
    .update(speculativeApplicationsTable)
    .set({ status: status as typeof existing.status })
    .where(eq(speculativeApplicationsTable.id, id))
    .returning();

  res.json(updated);
});

export default router;
