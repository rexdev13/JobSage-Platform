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
} from "@workspace/db";
import { eq, and, desc, ilike, gte, count, sql } from "drizzle-orm";
import { writeAuditEvent } from "../lib/audit";
import { sendSpeculativeCVNotification, sendSpeculativeCVToOps, OPS_INBOX } from "../lib/email";
import { ObjectStorageService } from "../lib/objectStorage";
import { maskPersonalContactInfo, resolveJobsageAlias } from "../lib/jobsageEmailGen";

const APP_URL = process.env.APP_URL ?? "https://jobsage.co.uk";

export type DeliveryRoute = "employer_contact_email" | "employer_account" | "sponsor_contact_email" | "ops_fallback";

interface RecipientResolution {
  email: string;
  route: DeliveryRoute;
}

/**
 * Resolve the employer recipient in priority order:
 *   1. Stored contactEmail on the sponsor licence or employer profile
 *   2. Registered JOBSAGE employer account email
 *   3. Ops inbox fallback
 *
 * This action deliberately performs no AI contact enrichment. Sending remains
 * fast, predictable, and independent from the vacancy-discovery AI budget.
 */
export async function resolveEmployerRecipient(
  companyName: string,
  sponsorLicenceId: number | null | undefined,
  _legacyEnrichmentTimeoutMs?: number,
): Promise<RecipientResolution> {
  try {
    const [licenceRow] = await db
      .select({ contactEmail: sponsorLicencesTable.contactEmail })
      .from(sponsorLicencesTable)
      .where(
        sponsorLicenceId
          ? eq(sponsorLicencesTable.id, sponsorLicenceId)
          : ilike(sponsorLicencesTable.organisationName, companyName),
      )
      .limit(1);
    if (licenceRow?.contactEmail) {
      return { email: licenceRow.contactEmail, route: "sponsor_contact_email" };
    }
  } catch {
    // Best-effort. Employer profile lookup and ops fallback remain available.
  }

  try {
    const [empRow] = await db
      .select({
        empUserId: employerProfilesTable.userId,
        contactEmail: employerProfilesTable.contactEmail,
      })
      .from(employerProfilesTable)
      .where(ilike(employerProfilesTable.companyName, companyName))
      .limit(1);
    if (empRow?.contactEmail) {
      return { email: empRow.contactEmail, route: "employer_contact_email" };
    }
    if (empRow?.empUserId) {
      const [empUser] = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, empRow.empUserId));
      if (empUser?.email) return { email: empUser.email, route: "employer_account" };
    }
  } catch {
    // Best-effort. Ops fallback is intentionally always available.
  }

  return { email: OPS_INBOX, route: "ops_fallback" };
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
  };

  if (!companyName || typeof companyName !== "string" || companyName.trim().length === 0) {
    res.status(400).json({ error: "companyName is required." });
    return;
  }
  if (sourceType != null && sourceType !== "job_board" && sourceType !== "company_site") {
    res.status(400).json({ error: "sourceType must be job_board or company_site." });
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

  // Mask personal contact info in the cover note if we have a JOBSAGE alias
  const maskedNotes = notes && jobsageEmail ? maskPersonalContactInfo(notes, jobsageEmail) : (notes ?? null);

  const { email: employerContactEmail, route: deliveryRoute } = await resolveEmployerRecipient(
    normalizedCompanyName,
    sponsorLicenceId,
  );

  // Fire outbound emails and persist delivery metadata.
  // Step 1: Send the CV to the employer/ops — this determines actual delivery.
  // Step 2: Only after confirming success, send the candidate confirmation with accurate wording.
  const now = new Date();
  let emailDelivered = false;
  if (!deliveryFailure && cvContent) {
    try {
      await sendSpeculativeCVToOps({
      candidateEmail: user.email as string,
      candidateName,
      candidateUserId: userId,
      companyName: normalizedCompanyName,
      applicationId: app.id,
      cvFilename: cvDocument.filename,
      cvContent,
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
  } else if (!deliveryFailure) {
    deliveryFailure = "The selected PDF CV was empty.";
  }

  // Candidate confirmation: only sent when the employer/ops email actually succeeded.
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
      emailSent: emailDelivered,
      emailSentAt: emailDelivered ? now : null,
      emailRecipient: employerContactEmail,
      jobsageEmail,
      deliveryRoute,
      deliveryStatus: emailDelivered ? "delivered" : "failed",
      deliveryError: emailDelivered ? null : deliveryFailure,
    })
    .where(eq(speculativeApplicationsTable.id, app.id))
    .returning();
  await db
    .update(speculativeApplicationDeliveryAttemptsTable)
    .set({
      outcome: emailDelivered ? "delivered" : "failed",
      completedAt: now,
      error: emailDelivered ? null : deliveryFailure,
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

  if (!emailDelivered) {
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
