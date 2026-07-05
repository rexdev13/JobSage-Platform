import { Router, type IRouter } from "express";
import { requireAuthenticated } from "../middlewares/requireRole";
import { db } from "@workspace/db";
import { speculativeApplicationsTable, employerProfilesTable, documentsTable } from "@workspace/db";
import { eq, and, desc, ilike } from "drizzle-orm";
import { writeAuditEvent } from "../lib/audit";
import { sendSpeculativeCVNotification, sendSpeculativeCVToOps, OPS_INBOX } from "../lib/email";
import { ObjectStorageService } from "../lib/objectStorage";

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

  const user = req.user!;
  const candidateName =
    [(user as { firstName?: string }).firstName, (user as { lastName?: string }).lastName]
      .filter(Boolean)
      .join(" ") || "there";

  // Resolve the candidate's CV document (prefer documentType = "cv", fall back to most recent)
  const allDocs = await db
    .select({ id: documentsTable.id, filename: documentsTable.filename, storageKey: documentsTable.storageKey, documentType: documentsTable.documentType })
    .from(documentsTable)
    .where(eq(documentsTable.userId, userId))
    .orderBy(desc(documentsTable.uploadedAt));
  const cvDocument = allDocs.find((d) => d.documentType === "cv") ?? allDocs[0] ?? null;

  // Fetch CV file bytes from object storage for email attachment (best-effort)
  let cvContent: Buffer | null = null;
  if (cvDocument?.storageKey) {
    try {
      const storage = new ObjectStorageService();
      const gcsFile = await storage.getObjectEntityFile(cvDocument.storageKey);
      const [downloaded] = await gcsFile.download();
      cvContent = downloaded as Buffer;
    } catch (err: unknown) {
      console.error("[speculative] Could not fetch CV from storage:", err);
    }
  }

  // Fire outbound emails and persist delivery metadata
  const now = new Date();
  let emailDelivered = false;
  try {
    await Promise.all([
      // Candidate confirmation
      sendSpeculativeCVNotification({ candidateEmail: user.email, candidateName, companyName }),
      // JOBSAGE ops inbox — actual CV file attached where available
      sendSpeculativeCVToOps({
        candidateEmail: user.email,
        candidateName,
        candidateUserId: userId,
        companyName,
        applicationId: app!.id,
        cvFilename: cvDocument?.filename ?? null,
        cvContent,
        notes: notes ?? null,
      }),
    ]);
    emailDelivered = true;
  } catch (err: unknown) {
    console.error("[speculative] Failed to send CV emails:", err);
  }

  // Persist delivery metadata on the record
  await db
    .update(speculativeApplicationsTable)
    .set({
      cvDocumentId: cvDocument?.id ?? null,
      emailSent: emailDelivered,
      emailSentAt: emailDelivered ? now : null,
      emailRecipient: OPS_INBOX,
    })
    .where(eq(speculativeApplicationsTable.id, app!.id));

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
