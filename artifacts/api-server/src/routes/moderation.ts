import { createHash } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  applicationsTable,
  candidateMessagesTable,
  db,
  documentsTable,
  employerCandidateFeedbackTable,
  jobListingsTable,
  profilesTable,
  supportTicketRepliesTable,
  supportTicketsTable,
} from "@workspace/db";
import { z } from "zod/v4";
import { writeAuditEvent } from "../lib/audit";
import { sendSupportTicketReply } from "../lib/email";
import { requireRole } from "../middlewares/requireRole";

const router: IRouter = Router();
const moderatorRole = requireRole("moderator");
const moderatorOnly = (req: Request, res: import("express").Response, next: import("express").NextFunction) => {
  if (req.isImpersonating) {
    res.status(403).json({ error: "Moderation access is unavailable during impersonation." });
    return;
  }
  moderatorRole(req, res, next);
};
const reportIdSchema = z.object({ id: z.coerce.number().int().positive() });
const updateSchema = z.object({
  status: z.enum(["in_review", "attended", "resolved"]).optional(),
  severity: z.enum(["low", "normal", "high", "urgent"]).optional(),
  internalNote: z.string().trim().min(1).max(2000).optional(),
  decision: z.enum(["no_action", "escalate"]).optional(),
}).strict().refine(value => Object.keys(value).length > 0)
  .refine(value => value.decision !== "no_action" || !!value.internalNote)
  .refine(value => value.status !== "resolved" || value.decision === "no_action");

async function allowWrite(userId: string) {
  const key = `moderation-write:${createHash("sha256").update(userId).digest("hex")}`;
  const result = await db.execute(sql`
    INSERT INTO user_sessions(sid,sess,expire) VALUES (${key},'{"count":1}'::jsonb,now()+interval '1 hour')
    ON CONFLICT(sid) DO UPDATE SET
      sess=CASE WHEN user_sessions.expire<=now() THEN '{"count":1}'::jsonb
        ELSE jsonb_build_object('count',(user_sessions.sess->>'count')::int+1) END,
      expire=CASE WHEN user_sessions.expire<=now() THEN now()+interval '1 hour' ELSE user_sessions.expire END
    RETURNING (sess->>'count')::int AS count`);
  return Number(result.rows[0]?.count) <= 120;
}

function logAuditFailure(req: Request, ticketId: string) {
  req.log.error({ ticketId }, "Moderation action was saved but its audit event could not be recorded");
}

function reporterOutcomeMessage(ticketId: string, decision: "no_action" | "escalate") {
  const outcome = decision === "no_action"
    ? "We reviewed your report and will not take further action based on the information currently available."
    : "Your report has been escalated for additional review.";
  return [
    `Update for report ${ticketId}.`,
    outcome,
    "For privacy reasons, we cannot share details about other people or internal review.",
    "If you have new relevant information, contact JOBSAGE Support and include this reference.",
  ].join("\n\n");
}

type ReportSourceEvidence = {
  label: string;
  fields: Array<{ label: string; value: string }>;
  unavailable?: boolean;
};

function sourceEvidence(label: string, values: Array<[string, unknown]>): ReportSourceEvidence {
  const fields = values
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([fieldLabel, value]) => ({
      label: fieldLabel,
      value: value instanceof Date ? value.toISOString() : typeof value === "string" ? value : String(value),
    }));
  return fields.length ? { label, fields } : { label, fields: [], unavailable: true };
}

async function getReportSourceEvidence(ticket: {
  reportedContentType: string | null;
  reportedContentId: string | null;
  reportedContextId: number | null;
  reportedMessageId: number | null;
  reporterUserId: string | null;
}): Promise<ReportSourceEvidence | null> {
  const contentId = ticket.reportedContentId;
  if (!ticket.reportedContentType) return null;
  switch (ticket.reportedContentType) {
    case "candidate_profile": {
      if (!contentId || !ticket.reportedContextId) return null;
      const [application] = await db.select({ jobTitle: jobListingsTable.title }).from(applicationsTable)
        .innerJoin(jobListingsTable, eq(applicationsTable.roleId, sql`${jobListingsTable.id} + 1000000`))
        .where(and(
          eq(applicationsTable.id, ticket.reportedContextId),
          eq(applicationsTable.userId, contentId),
        ));
      if (!application) return sourceEvidence("Candidate profile", []);
      const [profile] = await db.select({
        profession: profilesTable.profession,
        specialty: profilesTable.specialty,
        registrationStatus: profilesTable.registrationStatus,
        qualificationCountry: profilesTable.qualificationCountry,
        experienceYears: profilesTable.experienceYears,
        requiresSponsorship: profilesTable.requiresSponsorship,
      }).from(profilesTable).where(eq(profilesTable.userId, contentId));
      if (!profile) return sourceEvidence("Candidate profile", []);
      return sourceEvidence("Candidate profile", [
        ["Profession", profile.profession],
        ["Specialty", profile.specialty],
        ["Registration status", profile.registrationStatus],
        ["Qualification country", profile.qualificationCountry],
        ["Experience years", profile.experienceYears],
        ["Requires sponsorship", profile.requiresSponsorship ? "Yes" : "No"],
        ["Application context", application?.jobTitle],
      ]);
    }
    case "job_listing": {
      const id = Number(contentId);
      if (!Number.isSafeInteger(id) || id < 1 || ticket.reportedContextId !== id) return null;
      const [job] = await db.select({
        title: jobListingsTable.title,
        location: jobListingsTable.location,
        regulator: jobListingsTable.regulator,
        specialty: jobListingsTable.specialty,
        status: jobListingsTable.status,
        description: jobListingsTable.description,
        requirements: jobListingsTable.requirements,
        sponsorshipOffered: jobListingsTable.sponsorshipOffered,
      }).from(jobListingsTable).where(eq(jobListingsTable.id, id));
      if (!job) return sourceEvidence("Job listing", []);
      return sourceEvidence("Job listing", [
        ["Title", job.title],
        ["Location", job.location],
        ["Regulator", job.regulator],
        ["Specialty", job.specialty],
        ["Status", job.status],
        ["Description", job.description],
        ["Requirements", job.requirements],
        ["Sponsorship offered", job.sponsorshipOffered ? "Yes" : "No"],
      ]);
    }
    case "attachment": {
      const id = Number(contentId);
      if (!Number.isSafeInteger(id) || id < 1 || !ticket.reportedContextId) return null;
      const [document] = await db.select({
        documentType: documentsTable.documentType,
        mimeType: documentsTable.mimeType,
        fileSize: documentsTable.fileSize,
        uploadedAt: documentsTable.uploadedAt,
      }).from(documentsTable)
        .innerJoin(applicationsTable, and(
          eq(applicationsTable.cvDocumentId, documentsTable.id),
          eq(applicationsTable.userId, documentsTable.userId),
        ))
        .where(and(
          eq(documentsTable.id, id),
          eq(applicationsTable.id, ticket.reportedContextId),
        ));
      if (!document) return sourceEvidence("Application attachment", []);
      return sourceEvidence("Application attachment", [
        ["Document type", document.documentType],
        ["File type", document.mimeType],
        ["File size (bytes)", document.fileSize],
        ["Uploaded", document.uploadedAt],
      ]);
    }
    case "employer_feedback": {
      const id = Number(contentId);
      if (!Number.isSafeInteger(id) || id < 1 || !ticket.reportedContextId) return null;
      const [feedback] = await db.select({
        feedback: employerCandidateFeedbackTable.feedback,
        createdAt: employerCandidateFeedbackTable.createdAt,
        updatedAt: employerCandidateFeedbackTable.updatedAt,
      }).from(employerCandidateFeedbackTable).where(and(
        eq(employerCandidateFeedbackTable.id, id),
        eq(employerCandidateFeedbackTable.applicationId, ticket.reportedContextId),
      ));
      if (!feedback) return sourceEvidence("Employer feedback", []);
      return sourceEvidence("Employer feedback", [
        ["Feedback", feedback.feedback],
        ["Created", feedback.createdAt],
        ["Last updated", feedback.updatedAt],
      ]);
    }
    case "support_request": {
      if (!contentId) return null;
      const [request] = await db.select({
        subject: supportTicketsTable.subject,
        message: supportTicketsTable.message,
        category: supportTicketsTable.category,
        createdAt: supportTicketsTable.createdAt,
      }).from(supportTicketsTable).where(and(
        eq(supportTicketsTable.ticketId, contentId),
        eq(supportTicketsTable.isContentReport, false),
        eq(supportTicketsTable.userId, ticket.reporterUserId ?? ""),
      ));
      if (!request) return sourceEvidence("Support request", []);
      return sourceEvidence("Support request", [
        ["Subject", request.subject],
        ["Category", request.category],
        ["Message", request.message],
        ["Created", request.createdAt],
      ]);
    }
    case "inbox_message": {
      const id = ticket.reportedMessageId ?? Number(contentId);
      if (!Number.isSafeInteger(id) || id < 1) return null;
      const [message] = await db.select({
        companyName: candidateMessagesTable.companyName,
        subject: candidateMessagesTable.subject,
        messageText: candidateMessagesTable.messageText,
        createdAt: candidateMessagesTable.createdAt,
      }).from(candidateMessagesTable).where(and(
        eq(candidateMessagesTable.id, id),
        eq(candidateMessagesTable.recipientUserId, ticket.reporterUserId ?? ""),
      ));
      if (!message) return sourceEvidence("Inbox message", []);
      return sourceEvidence("Inbox message", [
        ["Sender", message.companyName],
        ["Subject", message.subject],
        ["Message", message.messageText],
        ["Sent", message.createdAt],
      ]);
    }
    case "ai_content":
      return { label: "AI-generated content", fields: [], unavailable: true };
    case "other":
      return { label: "Reported content", fields: [], unavailable: true };
    default:
      return null;
  }
}

// Queue rows deliberately omit reporter names, email addresses, user IDs, and report text.
router.get("/moderation/reports", moderatorOnly, async (req, res): Promise<void> => {
  const moderatorId = req.user!.id;
  const tickets = await db.select({
    id: supportTicketsTable.id,
    ticketId: supportTicketsTable.ticketId,
    category: supportTicketsTable.category,
    status: supportTicketsTable.status,
    severity: supportTicketsTable.severity,
    assignedModeratorId: supportTicketsTable.assignedModeratorId,
    createdAt: supportTicketsTable.createdAt,
  }).from(supportTicketsTable).where(and(
    eq(supportTicketsTable.isContentReport, true),
    or(eq(supportTicketsTable.assignedModeratorId, moderatorId), isNull(supportTicketsTable.assignedModeratorId)),
  )).orderBy(sql`CASE ${supportTicketsTable.severity}
    WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`,
    asc(supportTicketsTable.createdAt), asc(supportTicketsTable.id)).limit(100);
  res.json(tickets.map(ticket => ({
    id: ticket.id,
    ticketId: ticket.ticketId,
    category: ticket.category,
    status: ticket.status,
    severity: ticket.severity,
    assignedToMe: ticket.assignedModeratorId === moderatorId,
    createdAt: ticket.createdAt,
  })));
});

router.post("/moderation/reports/:id/claim", moderatorOnly, async (req, res): Promise<void> => {
  const params = reportIdSchema.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid report ID." }); return; }
  const moderatorId = req.user!.id;
  if (!await allowWrite(moderatorId)) { res.status(429).json({ error: "Too many moderation updates. Try again later." }); return; }

  const [claimed] = await db.update(supportTicketsTable).set({
    assignedModeratorId: moderatorId,
    status: "in_review",
    reviewedBy: moderatorId,
    reviewedAt: new Date(),
  }).where(and(
    eq(supportTicketsTable.id, params.data.id),
    eq(supportTicketsTable.isContentReport, true),
    isNull(supportTicketsTable.assignedModeratorId),
  )).returning({ id: supportTicketsTable.id, ticketId: supportTicketsTable.ticketId });
  if (claimed) {
    const recorded = await writeAuditEvent(moderatorId, "moderator_claimed_report", claimed.ticketId);
    if (!recorded) logAuditFailure(req, claimed.ticketId);
    res.status(200).json({ success: true, assignedToMe: true });
    return;
  }

  const [current] = await db.select({
    assignedModeratorId: supportTicketsTable.assignedModeratorId,
    isContentReport: supportTicketsTable.isContentReport,
  }).from(supportTicketsTable).where(eq(supportTicketsTable.id, params.data.id));
  if (!current?.isContentReport) { res.status(404).json({ error: "Report not found." }); return; }
  if (current.assignedModeratorId === moderatorId) { res.json({ success: true, assignedToMe: true }); return; }
  res.status(409).json({ error: "This report has already been assigned." });
});

router.get("/moderation/reports/:id", moderatorOnly, async (req, res): Promise<void> => {
  const params = reportIdSchema.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid report ID." }); return; }
  const [ticket] = await db.select({
    id: supportTicketsTable.id,
    ticketId: supportTicketsTable.ticketId,
    category: supportTicketsTable.category,
    subject: supportTicketsTable.subject,
    message: supportTicketsTable.message,
    reportedMessageId: supportTicketsTable.reportedMessageId,
    reportedContentType: supportTicketsTable.reportedContentType,
    reportedContentId: supportTicketsTable.reportedContentId,
    reportedContextId: supportTicketsTable.reportedContextId,
    reporterUserId: supportTicketsTable.userId,
    appealOfTicketId: supportTicketsTable.appealOfTicketId,
    status: supportTicketsTable.status,
    severity: supportTicketsTable.severity,
    moderationDecision: supportTicketsTable.moderationDecision,
    adminNotes: supportTicketsTable.adminNotes,
    escalatedAt: supportTicketsTable.escalatedAt,
    createdAt: supportTicketsTable.createdAt,
    updatedAt: supportTicketsTable.updatedAt,
  }).from(supportTicketsTable).where(and(
    eq(supportTicketsTable.id, params.data.id),
    eq(supportTicketsTable.isContentReport, true),
    eq(supportTicketsTable.assignedModeratorId, req.user!.id),
  ));
  if (!ticket) { res.status(404).json({ error: "Assigned report not found." }); return; }
  const sourceEvidence = await getReportSourceEvidence(ticket);
  res.json({
    id: ticket.id,
    ticketId: ticket.ticketId,
    category: ticket.category,
    subject: ticket.subject,
    message: ticket.message,
    reportedMessageId: ticket.reportedMessageId,
    sourceEvidence,
    appealOfTicketId: ticket.appealOfTicketId,
    status: ticket.status,
    severity: ticket.severity,
    moderationDecision: ticket.moderationDecision,
    adminNotes: ticket.adminNotes,
    escalatedAt: ticket.escalatedAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  });
});

router.patch("/moderation/reports/:id", moderatorOnly, async (req, res): Promise<void> => {
  const params = reportIdSchema.safeParse(req.params);
  const body = updateSchema.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid moderation update." }); return; }
  const moderatorId = req.user!.id;
  if (!await allowWrite(moderatorId)) { res.status(429).json({ error: "Too many moderation updates. Try again later." }); return; }

  const now = new Date();
  const result = await db.transaction(async tx => {
    const [current] = await tx.select({
      id: supportTicketsTable.id,
      ticketId: supportTicketsTable.ticketId,
      email: supportTicketsTable.email,
      status: supportTicketsTable.status,
      severity: supportTicketsTable.severity,
      moderationDecision: supportTicketsTable.moderationDecision,
      escalatedAt: supportTicketsTable.escalatedAt,
      adminNotes: supportTicketsTable.adminNotes,
    }).from(supportTicketsTable).where(and(
      eq(supportTicketsTable.id, params.data.id),
      eq(supportTicketsTable.isContentReport, true),
      eq(supportTicketsTable.assignedModeratorId, moderatorId),
    )).for("update");
    if (!current) return { kind: "not_found" as const };

    const repeatedDecision = body.data.decision === current.moderationDecision
      && (body.data.decision === "no_action" ? current.status === "resolved" : body.data.decision === "escalate");
    if (body.data.decision && !repeatedDecision) {
      const replyText = reporterOutcomeMessage(current.ticketId, body.data.decision);
      const delivery = await sendSupportTicketReply({
        to: current.email,
        ticketId: current.ticketId,
        subject: "JOBSAGE report update",
        replyText,
      });
      await tx.insert(supportTicketRepliesTable).values({
        ticketId: current.id,
        adminUserId: moderatorId,
        adminDisplayName: "JOBSAGE Moderation",
        replyText,
        deliveryChannel: "email",
        deliveryStatus: delivery.success ? "sent" : "failed",
        candidateMessageId: null,
      });
      if (!delivery.success) return { kind: "delivery_failed" as const, ticketId: current.ticketId };
    }

    const update: Record<string, unknown> = {
      reviewedBy: moderatorId,
      reviewedAt: now,
      updatedAt: now,
    };
    if (body.data.status) update.status = body.data.status;
    if (body.data.severity) update.severity = body.data.severity;
    if (body.data.internalNote) {
      const stamp = `[moderator ${moderatorId} ${now.toISOString()}]`;
      update.adminNotes = [current.adminNotes, `${stamp} ${body.data.internalNote}`].filter(Boolean).join("\n");
    }
    if (body.data.decision === "no_action") {
      update.moderationDecision = "no_action";
      update.status = "resolved";
    } else if (body.data.decision === "escalate") {
      update.moderationDecision = "escalated";
      update.status = "attended";
      update.severity = "urgent";
      update.escalatedAt = current.escalatedAt ?? now;
    }

    const [updated] = await tx.update(supportTicketsTable).set(update).where(and(
      eq(supportTicketsTable.id, current.id),
      eq(supportTicketsTable.assignedModeratorId, moderatorId),
      eq(supportTicketsTable.isContentReport, true),
    )).returning({
      ticketId: supportTicketsTable.ticketId,
      status: supportTicketsTable.status,
      severity: supportTicketsTable.severity,
      moderationDecision: supportTicketsTable.moderationDecision,
    });
    if (!updated) return { kind: "assignment_changed" as const };
    return { kind: "updated" as const, updated };
  });

  if (result.kind === "not_found") { res.status(404).json({ error: "Assigned report not found." }); return; }
  if (result.kind === "delivery_failed") {
    req.log.error({ ticketId: result.ticketId }, "Moderation outcome email failed; report decision was not saved");
    res.status(502).json({ error: "The reporter could not be notified. The decision was not saved." });
    return;
  }
  if (result.kind === "assignment_changed") {
    res.status(409).json({ error: "The report assignment changed. Reload and try again." });
    return;
  }
  const updated = result.updated;
  const action = body.data.decision === "no_action" ? "moderator_decided_no_action"
    : body.data.decision === "escalate" ? "moderator_escalated_report" : "moderator_updated_report";
  const recorded = await writeAuditEvent(moderatorId, action, updated.ticketId, {
    status: updated.status,
    severity: updated.severity,
    decision: updated.moderationDecision,
    noteChanged: !!body.data.internalNote,
  });
  if (!recorded) logAuditFailure(req, updated.ticketId);
  res.json({ success: true, ...updated });
});

export default router;
