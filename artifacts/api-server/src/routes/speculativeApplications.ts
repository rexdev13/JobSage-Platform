import { Router, type IRouter } from "express";
import { requireAuthenticated } from "../middlewares/requireRole";
import { db } from "@workspace/db";
import { speculativeApplicationsTable, employerProfilesTable, documentsTable, usersTable, candidateMessagesTable } from "@workspace/db";
import { eq, and, desc, ilike, sql } from "drizzle-orm";
import { writeAuditEvent } from "../lib/audit";
import { sendSpeculativeCVNotification, sendSpeculativeCVToOps, OPS_INBOX } from "../lib/email";
import { ObjectStorageService } from "../lib/objectStorage";
import { maskPersonalContactInfo, generateJobsageEmail } from "../lib/jobsageEmailGen";

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
  const { companyName, sponsorLicenceId, notes, vacancyTitle } = req.body as {
    companyName?: string;
    sponsorLicenceId?: number | null;
    notes?: string | null;
    vacancyTitle?: string | null;
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

  // Resolve alias and CV document BEFORE insert so we can validate and fail cleanly
  // without leaving orphan records in the database.
  const [userRow] = await db
    .select({ jobsageEmail: usersTable.jobsageEmail })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  let jobsageEmail = userRow?.jobsageEmail ?? null;

  // Defensive backfill: if somehow the alias is missing (pre-feature registration),
  // generate and persist it synchronously before sending so personal email is NEVER exposed.
  if (!jobsageEmail) {
    const generated = generateJobsageEmail(
      (user as { firstName?: string }).firstName ?? null,
      (user as { lastName?: string }).lastName ?? null,
    );
    try {
      await db
        .update(usersTable)
        .set({ jobsageEmail: sql`COALESCE(${usersTable.jobsageEmail}, ${generated})` })
        .where(eq(usersTable.id, userId));
    } catch {
      // Persist failure is non-critical; alias is used in-memory for this request
    }
    jobsageEmail = generated;
  }

  // Resolve the candidate's CV document (prefer documentType = "cv", fall back to most recent)
  const allDocs = await db
    .select({ id: documentsTable.id, filename: documentsTable.filename, storageKey: documentsTable.storageKey, documentType: documentsTable.documentType })
    .from(documentsTable)
    .where(eq(documentsTable.userId, userId))
    .orderBy(desc(documentsTable.uploadedAt));
  const cvDocument = allDocs.find((d) => d.documentType === "cv") ?? allDocs[0] ?? null;

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

  // Fire outbound emails and persist delivery metadata
  const now = new Date();
  let emailDelivered = false;
  try {
    await Promise.all([
      // Candidate confirmation (sent to personal email — this is intentional)
      sendSpeculativeCVNotification({ candidateEmail: user.email, candidateName, companyName }),
      // JOBSAGE ops inbox — contact shown as JOBSAGE alias, personal email never exposed to employer
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
        maskedCvTextExtract,
      }),
    ]);
    emailDelivered = true;
  } catch (err: unknown) {
    console.error("[speculative] Failed to send CV emails:", err);
  }

  // Persist delivery metadata on the record (including the JOBSAGE alias used)
  await db
    .update(speculativeApplicationsTable)
    .set({
      cvDocumentId: cvDocument?.id ?? null,
      emailSent: emailDelivered,
      emailSentAt: emailDelivered ? now : null,
      emailRecipient: OPS_INBOX,
      jobsageEmail,
    })
    .where(eq(speculativeApplicationsTable.id, app!.id));

  // Create inbox notification so the candidate can see the send confirmation in their Messages tab
  try {
    await db.insert(candidateMessagesTable).values({
      recipientUserId: userId,
      messageType: "system",
      subject: "Speculative CV sent",
      messageText: [
        `Your CV has been submitted to ${companyName}${vacancyTitle ? ` for the role "${vacancyTitle}"` : ""}.`,
        ``,
        `Contact identity used: ${jobsageEmail}`,
        `Sent at: ${now.toUTCString()}`,
        ``,
        `The JOBSAGE team will follow up with ${companyName} on your behalf where a direct contact is available.`,
        ``,
        `Track this application: ${APP_URL}/applications`,
      ].join("\n"),
    });
  } catch (msgErr) {
    // Inbox notification is best-effort — main response must not fail
    console.error("[speculative] Could not create inbox notification:", msgErr);
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

export default router;
