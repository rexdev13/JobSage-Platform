import { Router, type IRouter } from "express";
import { requireAuthenticated } from "../middlewares/requireRole";
import { db } from "@workspace/db";
import { speculativeApplicationsTable, employerProfilesTable, documentsTable, candidateMessagesTable, usersTable } from "@workspace/db";
import { eq, and, desc, ilike } from "drizzle-orm";
import { writeAuditEvent } from "../lib/audit";
import { sendSpeculativeCVNotification, sendSpeculativeCVToOps, OPS_INBOX } from "../lib/email";
import { ObjectStorageService } from "../lib/objectStorage";
import { maskPersonalContactInfo, resolveJobsageAlias } from "../lib/jobsageEmailGen";

const APP_URL = process.env.APP_URL ?? "https://jobsage.co.uk";

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
  const { companyName, sponsorLicenceId, notes, vacancyTitle, cvDocumentId } = req.body as {
    companyName?: string;
    sponsorLicenceId?: number | null;
    notes?: string | null;
    vacancyTitle?: string | null;
    cvDocumentId?: number | null;
  };

  if (!companyName || typeof companyName !== "string") {
    res.status(400).json({ error: "companyName is required." });
    return;
  }

  // Deduplicate per vacancy (if provided) or per company (speculative/no vacancy)
  const [existing] = await db
    .select()
    .from(speculativeApplicationsTable)
    .where(
      vacancyTitle
        ? and(
            eq(speculativeApplicationsTable.userId, userId),
            eq(speculativeApplicationsTable.companyName, companyName),
            eq(speculativeApplicationsTable.vacancyTitle, vacancyTitle),
          )
        : and(
            eq(speculativeApplicationsTable.userId, userId),
            eq(speculativeApplicationsTable.companyName, companyName),
          ),
    )
    .limit(1);

  if (existing) {
    res.json({ application: existing, alreadySent: true });
    return;
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

  // Resolve the candidate's CV document:
  // 1. If the caller explicitly chose a CV (cvDocumentId), use that document.
  // 2. Otherwise prefer isPrimary=true CV, then any documentType="cv", then most recent.
  const allDocs = await db
    .select({ id: documentsTable.id, filename: documentsTable.filename, storageKey: documentsTable.storageKey, documentType: documentsTable.documentType, isPrimary: documentsTable.isPrimary, label: documentsTable.label })
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

  // Validate BEFORE insert: non-PDF CVs cannot be redacted when alias is active.
  // Returning 422 here does NOT create a database record, so deduplication is unaffected.
  if (jobsageEmail && cvDocument && !cvDocument.filename?.toLowerCase().endsWith(".pdf")) {
    res.status(422).json({
      error: "Your CV must be in PDF format to send a speculative application. Please upload a PDF CV and try again.",
    });
    return;
  }

  const [app] = await db
    .insert(speculativeApplicationsTable)
    .values({
      userId,
      companyName,
      sponsorLicenceId: sponsorLicenceId ?? null,
      status: "cv_sent",
      notes: notes ?? null,
      vacancyTitle: vacancyTitle ?? null,
    })
    .returning();

  let cvContent: Buffer | null = null;
  let maskedCvTextExtract: string | null = null;
  if (cvDocument?.storageKey) {
    try {
      const storage = new ObjectStorageService();
      const gcsFile = await storage.getObjectEntityFile(cvDocument.storageKey);
      const [downloaded] = await gcsFile.download();
      cvContent = downloaded as Buffer;

      // For PDF CVs with alias: extract text and mask personal contact info.
      // The masked text becomes the sole transmitted document content.
      if (cvDocument.filename?.toLowerCase().endsWith(".pdf") && jobsageEmail) {
        try {
          const pdfParse = (await import("pdf-parse")).default;
          const parsed = await pdfParse(cvContent);
          maskedCvTextExtract = maskPersonalContactInfo(parsed.text.slice(0, 5000), jobsageEmail);
        } catch {
          // Parse failure — proceed; email.ts will attach safe placeholder
        }
      }
    } catch (err: unknown) {
      console.error("[speculative] Could not fetch CV from storage:", err);
    }
  }

  // Mask personal contact info in the cover note if we have a JOBSAGE alias
  const maskedNotes = notes && jobsageEmail ? maskPersonalContactInfo(notes, jobsageEmail) : (notes ?? null);

  // Resolve employer contact email:
  // - When the company has a JOBSAGE employer account, send directly to their registered email.
  // - Otherwise fall back to OPS_INBOX so the ops team can forward manually.
  let employerContactEmail: string = OPS_INBOX;
  try {
    const [empRow] = await db
      .select({ empUserId: employerProfilesTable.userId })
      .from(employerProfilesTable)
      .where(ilike(employerProfilesTable.companyName, companyName))
      .limit(1);
    if (empRow?.empUserId) {
      const [empUser] = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, empRow.empUserId));
      if (empUser?.email) employerContactEmail = empUser.email;
    }
  } catch {
    // Employer resolution is best-effort; fall back to OPS_INBOX
  }

  // Fire outbound emails and persist delivery metadata
  const now = new Date();
  let emailDelivered = false;
  try {
    await Promise.all([
      // Candidate confirmation (sent to personal email — this is intentional)
      sendSpeculativeCVNotification({ candidateEmail: user.email, candidateName, companyName }),
      // CV send — FROM candidate's JOBSAGE alias, TO employer or OPS_INBOX as fallback
      sendSpeculativeCVToOps({
        candidateEmail: user.email,
        candidateName,
        candidateUserId: userId,
        companyName,
        applicationId: app!.id,
        cvFilename: cvDocument?.filename ?? null,
        cvContent,
        notes: maskedNotes,
        jobsageEmail,
        recipientEmail: employerContactEmail,
        maskedCvTextExtract,
      }),
    ]);
    emailDelivered = true;
  } catch (err: unknown) {
    console.error("[speculative] Failed to send CV emails:", err);
  }

  // Persist delivery metadata (alias used + actual recipient)
  await db
    .update(speculativeApplicationsTable)
    .set({
      cvDocumentId: cvDocument?.id ?? null,
      emailSent: emailDelivered,
      emailSentAt: emailDelivered ? now : null,
      emailRecipient: employerContactEmail,
      jobsageEmail,
    })
    .where(eq(speculativeApplicationsTable.id, app!.id));

  // Create inbox notification only when email was actually delivered —
  // guards against false "sent" confirmations on delivery failure.
  if (emailDelivered) {
    const isDirectSend = employerContactEmail !== OPS_INBOX;
    try {
      await db.insert(candidateMessagesTable).values({
        recipientUserId: userId,
        messageType: "system",
        subject: "Speculative CV sent",
        messageText: [
          `Your CV has been submitted to ${companyName}${vacancyTitle ? ` for the role "${vacancyTitle}"` : ""}.`,
          ``,
          `Your contact identity: ${jobsageEmail}`,
          `Sent to: ${employerContactEmail}${isDirectSend ? " (employer direct)" : " (JOBSAGE ops — will forward)"}`,
          `Date sent: ${now.toUTCString()}`,
          ``,
          isDirectSend
            ? `The employer can reply directly to your JOBSAGE alias.`
            : `The JOBSAGE team will follow up with ${companyName} on your behalf where a direct contact is available.`,
          ``,
          `Follow up or track this application: ${APP_URL}/applications`,
        ].join("\n"),
      });
    } catch (msgErr) {
      // Inbox notification is best-effort — main response must not fail
      console.error("[speculative] Could not create inbox notification:", msgErr);
    }
  }

  // Employer notification / admin follow-up logging
  try {
    const [empProfile] = await db
      .select({ userId: employerProfilesTable.userId, id: employerProfilesTable.id })
      .from(employerProfilesTable)
      .where(ilike(employerProfilesTable.companyName, companyName))
      .limit(1);

    if (empProfile) {
      // Employer has an account — log so they can surface it on their dashboard in a future feature
      await writeAuditEvent(
        `user:${userId}`,
        "speculative_cv_sent_to_employer",
        `employer:${empProfile.userId}`,
        {
          companyName,
          applicationId: app!.id,
          employerProfileId: empProfile.id,
          hasEmployerAccount: true,
        },
      );
    } else {
      // No employer account — flag for admin follow-up to contact the company
      await writeAuditEvent(
        `user:${userId}`,
        "speculative_cv_admin_followup",
        undefined,
        {
          companyName,
          applicationId: app!.id,
          hasEmployerAccount: false,
          needsAdminAction: true,
          adminNote: `Candidate sent a speculative CV to "${companyName}" which has no employer account. Admin should follow up or invite the company.`,
        },
      );
    }
  } catch {
    // Notification logging is best-effort — don't fail the main request
  }

  res.status(201).json({ application: app, alreadySent: false });
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
