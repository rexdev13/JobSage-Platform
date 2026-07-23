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

export type DeliveryRoute = "employer_account" | "sponsor_contact_email" | "ai_enrichment" | "ops_fallback";

interface RecipientResolution {
  email: string;
  route: DeliveryRoute;
}

/**
 * Resolve the employer recipient in priority order:
 *   1. Registered JOBSAGE employer account email
 *   2. Stored contactEmail on the sponsor licence record
 *   3. On-demand AI web-search enrichment (bounded timeout; result persisted for future sends)
 *   4. Ops inbox fallback (last resort)
 *
 * Returns a frozen result object. All mutations are local to this function,
 * so the Promise.race background IIFE cannot affect the returned value after resolution.
 */
export async function resolveEmployerRecipient(
  companyName: string,
  sponsorLicenceId: number | null | undefined,
  enrichTimeoutMs = 8000,
): Promise<RecipientResolution> {
  // Step 1: JOBSAGE employer account
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
      if (empUser?.email) return { email: empUser.email, route: "employer_account" };
    }
  } catch {
    // best-effort
  }

  if (sponsorLicenceId) {
    const { sponsorLicencesTable } = await import("@workspace/db");

    // Step 2: Stored contactEmail on the licence record
    try {
      const [licenceRow] = await db
        .select({ contactEmail: sponsorLicencesTable.contactEmail })
        .from(sponsorLicencesTable)
        .where(eq(sponsorLicencesTable.id, sponsorLicenceId))
        .limit(1);
      if (licenceRow?.contactEmail) {
        return { email: licenceRow.contactEmail, route: "sponsor_contact_email" };
      }
    } catch {
      // best-effort
    }

    // Step 3: On-demand AI enrichment with a bounded timeout.
    // The IIFE result is captured locally inside this function; it is returned
    // immediately or dropped if the timeout wins — outer send state is never mutated
    // by background completion.
    try {
      const enrichedEmail = await (async (): Promise<string | null> => {
        // Run enrichment and timeout in a race; whichever wins determines the result.
        // The enrichment IIFE mutates nothing outside itself.
        const enrichPromise: Promise<string | null> = (async () => {
          try {
            const [fullLicence] = await db
              .select()
              .from(sponsorLicencesTable)
              .where(eq(sponsorLicencesTable.id, sponsorLicenceId))
              .limit(1);
            if (!fullLicence) return null;

            const { openai } = await import("@workspace/integrations-openai-ai-server");
            const prompt = `You are a UK business researcher. Find publicly available contact details for the following UK company from their own website or reputable directories. Return ONLY a JSON object (no markdown, no commentary) with these exact keys:
- "website": the company's main website URL (must start with https:// or http://) or null
- "contactEmail": a contact or HR email address or null
- "contactPhone": a UK phone number (include country code if available) or null
- "address": the full business address including postcode or null

Company name: ${fullLicence.organisationName}
Location hint: ${[fullLicence.townCity, fullLicence.county].filter(Boolean).join(", ") || "United Kingdom"}

Only include information you are confident about. Return null for any field you cannot find.`;

            const response = await openai.responses.create({
              model: "gpt-4o",
              tools: [{ type: "web_search_preview" }],
              input: prompt,
            });
            const text = response.output_text?.trim() ?? "";
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;
            const parsed = JSON.parse(jsonMatch[0]) as Record<string, string | null>;
            const contactEmail = typeof parsed["contactEmail"] === "string" ? parsed["contactEmail"] : null;
            if (!contactEmail) return null;

            // Persist enriched details for future sends (fire-and-forget within this function)
            db.update(sponsorLicencesTable)
              .set({
                website: typeof parsed["website"] === "string" ? parsed["website"] : null,
                contactEmail,
                contactPhone: typeof parsed["contactPhone"] === "string" ? parsed["contactPhone"] : null,
                address: typeof parsed["address"] === "string" ? parsed["address"] : null,
              })
              .where(eq(sponsorLicencesTable.id, sponsorLicenceId))
              .catch((persistErr: unknown) => {
                console.error("[speculative] Failed to persist enriched contact:", persistErr);
              });

            return contactEmail;
          } catch {
            return null;
          }
        })();

        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), enrichTimeoutMs));
        // Promise.race settles once; the losing promise's later resolution is discarded.
        return Promise.race([enrichPromise, timeoutPromise]);
      })();

      if (enrichedEmail) {
        return { email: enrichedEmail, route: "ai_enrichment" };
      }
    } catch (enrichErr) {
      console.error("[speculative] AI enrichment error:", enrichErr);
    }
  }

  // Step 4: Ops inbox fallback
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

  // Resolve the employer recipient once, immutably.
  // resolveEmployerRecipient returns a frozen { email, route } result —
  // the layered lookup (employer account → stored contactEmail → AI enrichment → ops fallback)
  // is fully contained within the helper and cannot be affected by late-completing async work.
  const { email: employerContactEmail, route: deliveryRoute } = await resolveEmployerRecipient(
    companyName,
    sponsorLicenceId,
  );

  // Fire outbound emails and persist delivery metadata.
  // Step 1: Send the CV to the employer/ops — this determines actual delivery.
  // Step 2: Only after confirming success, send the candidate confirmation with accurate wording.
  const now = new Date();
  let emailDelivered = false;
  try {
    await sendSpeculativeCVToOps({
      candidateEmail: user.email as string,
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
    });
    emailDelivered = true;
  } catch (err: unknown) {
    console.error("[speculative] Failed to send CV to employer/ops:", err);
  }

  // Candidate confirmation: only sent when the employer/ops email actually succeeded.
  // If delivery failed we do not send a confirmation — the application is persisted in the
  // tracker and the candidate can retry. Wording reflects the confirmed delivery route.
  if (emailDelivered) {
    try {
      await sendSpeculativeCVNotification({
        candidateEmail: user.email as string,
        candidateName,
        companyName,
        deliveryRoute,
      });
    } catch (notifyErr: unknown) {
      console.error("[speculative] Failed to send candidate confirmation:", notifyErr);
    }
  }

  // Persist delivery metadata (alias used + actual recipient + delivery route)
  await db
    .update(speculativeApplicationsTable)
    .set({
      cvDocumentId: cvDocument?.id ?? null,
      emailSent: emailDelivered,
      emailSentAt: emailDelivered ? now : null,
      emailRecipient: employerContactEmail,
      jobsageEmail,
      deliveryRoute,
    })
    .where(eq(speculativeApplicationsTable.id, app!.id));

  // Create inbox notification only when email was actually delivered —
  // guards against false "sent" confirmations on delivery failure.
  if (emailDelivered) {
    const deliveryRouteLabels: Record<DeliveryRoute, string> = {
      employer_account: "direct to employer (JOBSAGE account)",
      sponsor_contact_email: "direct to employer (registered contact email)",
      ai_enrichment: "direct to employer (contact discovered automatically)",
      ops_fallback: "JOBSAGE ops team (no direct email found — they will forward)",
    };
    const isDirectSend = deliveryRoute !== "ops_fallback";
    try {
      await db.insert(candidateMessagesTable).values({
        recipientUserId: userId,
        messageType: "system",
        subject: "Speculative CV sent",
        messageText: [
          `Your CV has been submitted to ${companyName}${vacancyTitle ? ` for the role "${vacancyTitle}"` : ""}.`,
          ``,
          `Your contact identity: ${jobsageEmail}`,
          `Delivered: ${deliveryRouteLabels[deliveryRoute]}`,
          `Date sent: ${now.toUTCString()}`,
          ``,
          isDirectSend
            ? `Your CV was sent directly to ${companyName}. The employer can reply to your JOBSAGE alias.`
            : `No public contact email could be found for ${companyName}. The JOBSAGE team has been notified and will follow up on your behalf.`,
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
      .where(ilike(employerProfilesTable.companyName, companyName))
      .limit(1);

    if (empProfile) {
      // Employer has a JOBSAGE account — log for their future dashboard
      await writeAuditEvent(
        `user:${userId}`,
        "speculative_cv_sent_to_employer",
        `employer:${empProfile.userId}`,
        {
          companyName,
          applicationId: app!.id,
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
          companyName,
          applicationId: app!.id,
          hasEmployerAccount: false,
          deliveryRoute,
          needsAdminAction: true,
          lookupStepsAttempted: ["employer_account", sponsorLicenceId ? "sponsor_contact_email" : null, sponsorLicenceId ? "ai_enrichment" : null].filter(Boolean),
          adminNote: `Candidate sent a speculative CV to "${companyName}". No employer account or contact email found after all lookup steps. Admin should follow up or invite the company.`,
        },
      );
    } else {
      // No JOBSAGE account but we found a direct email — informational log only
      await writeAuditEvent(
        `user:${userId}`,
        "speculative_cv_sent_direct",
        undefined,
        {
          companyName,
          applicationId: app!.id,
          hasEmployerAccount: false,
          deliveryRoute,
          needsAdminAction: false,
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
