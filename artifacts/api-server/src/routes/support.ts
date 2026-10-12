import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  CreateSupportTicketBody,
  AppealContentReportBody,
  AppealContentReportParams,
  GetAdminSupportTicketParams,
  GetAdminSupportTicketResponse,
  ListAdminSupportTicketsQueryParams,
  ListAdminSupportTicketsResponse,
  ReplyToAdminSupportTicketBody,
  ReplyToAdminSupportTicketParams,
  ReplyToAdminSupportTicketResponse,
  UpdateAdminSupportTicketBody,
  UpdateAdminSupportTicketParams,
  UpdateAdminSupportTicketResponse,
} from "@workspace/api-zod";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  candidateMessagesTable,
  db,
  auditEventsTable,
  supportTicketRepliesTable,
  supportTicketsTable,
  usersTable,
} from "@workspace/db";
import { z } from "zod/v4";
import {
  sendSupportTicketNotification,
  sendSupportTicketReply,
} from "../lib/email";
import { requireRole } from "../middlewares/requireRole";
import { writeAuditEvent } from "../lib/audit";

const router: IRouter = Router();
const adminSupportRole = requireRole("admin", "super_admin");
const CONTENT_REPORTS_PER_DAY = 8;
const SupportTicketResultSchema = z.object({
  success: z.boolean(),
  ticketId: z.string(),
});

async function getTicketDetail(ticketId: number) {
  const [ticket] = await db
    .select()
    .from(supportTicketsTable)
    .where(eq(supportTicketsTable.id, ticketId));
  if (!ticket) return null;

  const replies = await db
    .select()
    .from(supportTicketRepliesTable)
    .where(eq(supportTicketRepliesTable.ticketId, ticketId))
    .orderBy(asc(supportTicketRepliesTable.createdAt), asc(supportTicketRepliesTable.id));

  const history = await db
    .select({
      id: auditEventsTable.id,
      actor: auditEventsTable.actor,
      action: auditEventsTable.action,
      details: auditEventsTable.details,
      createdAt: auditEventsTable.createdAt,
    })
    .from(auditEventsTable)
    .where(eq(auditEventsTable.target, ticket.ticketId))
    .orderBy(asc(auditEventsTable.createdAt), asc(auditEventsTable.id));

  return { ticket, replies, history };
}

router.post("/support/ticket", async (req, res): Promise<void> => {
  const parsed = CreateSupportTicketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { reportedMessageId, ...requestTicketData } = parsed.data;
  const isAIReport = req.get("x-jobsage-ai-report") === "1";
  const isMessageReport = req.get("x-jobsage-message-report") === "1";
  if (isAIReport && isMessageReport) {
    res.status(400).json({ error: "Choose one content-report type." });
    return;
  }
  const isContentReport = isAIReport || isMessageReport;
  if (isContentReport && (!req.user || req.isImpersonating
    || req.get("x-jobsage-report-user") !== req.user.id)) {
    res.status(403).json({ error: "Sign in with the reporting account before sending this report." });
    return;
  }
  if ((isMessageReport && !reportedMessageId) || (!isMessageReport && reportedMessageId !== undefined)) {
    res.status(400).json({ error: "A message report must identify exactly one inbox message." });
    return;
  }
  // Tagged reports bind contact details to the authenticated actor. Public
  // support submissions retain their existing alternative-contact behavior.
  let ticketData = requestTicketData;
  if (isContentReport) {
    const [actor] = await db.select({
      email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName,
    }).from(usersTable).where(eq(usersTable.id, req.user!.id));
    if (!actor?.email) {
      res.status(403).json({ error: "The reporting account is unavailable." }); return;
    }
    ticketData = {
      ...requestTicketData,
      name: [actor.firstName, actor.lastName].filter(Boolean).join(" ").slice(0, 120) || "JOBSAGE user",
      email: actor.email, category: "Other", subject: isMessageReport ? "Message content report" : "AI content report",
    };
  }

  const ticketId = `JS-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const newTicket = {
    ticketId,
    ...ticketData,
    userId: req.user?.id ?? null,
    isContentReport,
    reportedMessageId: isMessageReport ? reportedMessageId! : null,
    appealOfTicketId: null,
  };
  if (isContentReport) {
    const insertResult = await db.transaction(async (tx) => {
      if (isMessageReport) {
        const [reportedMessage] = await tx
          .select({ id: candidateMessagesTable.id })
          .from(candidateMessagesTable)
          .where(and(
            eq(candidateMessagesTable.id, reportedMessageId!),
            eq(candidateMessagesTable.recipientUserId, req.user!.id),
          ))
          .for("update");
        if (!reportedMessage) return "message_not_found" as const;
      }
      // Serialize per reporter so concurrent requests cannot bypass the daily cap.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`content-report:${req.user!.id}`}))`);
      const countResult = await tx.execute(sql`SELECT count(*)::int AS count
        FROM support_tickets
        WHERE user_id = ${req.user!.id}
          AND is_content_report = true
          AND created_at >= now() - interval '24 hours'`);
      const count = Number(countResult.rows[0]?.count ?? 0);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error("content_report_limit_check_failed");
      if (count >= CONTENT_REPORTS_PER_DAY) return "rate_limited" as const;
      await tx.insert(supportTicketsTable).values(newTicket);
      return "inserted" as const;
    });
    if (insertResult === "message_not_found") {
      res.status(404).json({ error: "That inbox message is not available to this account." });
      return;
    }
    if (insertResult === "rate_limited") {
      res.status(429).json({ error: "You have reached the content-report limit. Try again later." });
      return;
    }
  } else {
    await db.insert(supportTicketsTable).values(newTicket);
  }

  const delivery = await sendSupportTicketNotification({
    ticketId, ...ticketData,
    // Staff read supplied evidence in the access-controlled support queue.
    // Do not replicate AI draft text in the notification email.
    ...(isContentReport ? { message: "A content report was saved. Review its evidence in the JOBSAGE support queue." } : {}),
  });
  if (!delivery.success) {
    req.log.error(
      { ticketId, error: delivery.error },
      "Support ticket was saved but its email notification could not be delivered",
    );
  }
  if (isContentReport) {
    const recorded = await writeAuditEvent(req.user!.id, "candidate_content_report", ticketId, {
        reportType: isMessageReport ? "message" : "ai",
      });
    if (!recorded) {
      req.log.error({ ticketId }, "Content report was saved but its audit event could not be recorded");
    }
  }

  res.status(201).json(SupportTicketResultSchema.parse({
    success: true,
    ticketId,
  }));
});

router.post("/support/ticket/:ticketId/appeal", async (req, res): Promise<void> => {
  const params = AppealContentReportParams.safeParse(req.params);
  const body = AppealContentReportBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const appealMessage = body.data.message.trim();
  if (appealMessage.length < 10) {
    res.status(400).json({ error: "Add at least 10 non-whitespace characters to the review request." });
    return;
  }
  if (!req.user || req.isImpersonating || req.get("x-jobsage-report-user") !== req.user.id) {
    res.status(403).json({ error: "Sign in with the reporting account before requesting another review." });
    return;
  }

  const [actor] = await db.select({
    email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName,
  }).from(usersTable).where(eq(usersTable.id, req.user.id));
  const actorEmail = actor?.email;
  if (!actorEmail) {
    res.status(403).json({ error: "The reporting account is unavailable." });
    return;
  }

  const appealTicketId = `JS-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const saved = await db.transaction(async (tx) => {
    const [original] = await tx.select().from(supportTicketsTable).where(and(
      eq(supportTicketsTable.ticketId, params.data.ticketId),
      eq(supportTicketsTable.userId, req.user!.id),
      eq(supportTicketsTable.isContentReport, true),
      isNull(supportTicketsTable.appealOfTicketId),
    )).for("update");
    if (
      !original
      || original.userId !== req.user!.id
      || !original.isContentReport
      || original.appealOfTicketId !== null
    ) {
      return { kind: "not_found" as const };
    }

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`content-report:${req.user!.id}`}))`);
    const countResult = await tx.execute(sql`SELECT count(*)::int AS count
      FROM support_tickets
      WHERE user_id = ${req.user!.id}
        AND is_content_report = true
        AND created_at >= now() - interval '24 hours'`);
    const count = Number(countResult.rows[0]?.count ?? 0);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("content_report_limit_check_failed");
    if (count >= CONTENT_REPORTS_PER_DAY) return { kind: "rate_limited" as const };

    await tx.insert(supportTicketsTable).values({
      ticketId: appealTicketId,
      name: [actor.firstName, actor.lastName].filter(Boolean).join(" ").slice(0, 120) || "JOBSAGE user",
      email: actorEmail,
      category: "Other",
      subject: `Appeal of content report ${original.ticketId}`,
      message: `The reporter requested another review of their content report.\n\n${appealMessage}`,
      userId: req.user!.id,
      isContentReport: true,
      reportedMessageId: original.reportedMessageId,
      appealOfTicketId: original.id,
    });
    return { kind: "saved" as const };
  });

  if (saved.kind === "not_found") {
    res.status(404).json({ error: "That report is not available to this account." });
    return;
  }
  if (saved.kind === "rate_limited") {
    res.status(429).json({ error: "You have reached the content-report limit. Try again later." });
    return;
  }

  const delivery = await sendSupportTicketNotification({
    ticketId: appealTicketId,
    name: [actor.firstName, actor.lastName].filter(Boolean).join(" ").slice(0, 120) || "JOBSAGE user",
    email: actorEmail,
    category: "Other",
    subject: "Content report appeal",
    message: "A content-report appeal was saved. Review its details in the JOBSAGE support queue.",
  });
  if (!delivery.success) {
    req.log.error(
      { ticketId: appealTicketId, error: delivery.error },
      "Content-report appeal was saved but its email notification could not be delivered",
    );
  }
  const recorded = await writeAuditEvent(req.user.id, "candidate_content_report_appeal", appealTicketId, {
    appealOfTicketId: params.data.ticketId,
  });
  if (!recorded) {
    req.log.error({ ticketId: appealTicketId }, "Content-report appeal was saved but its audit event could not be recorded");
  }
  res.status(201).json(SupportTicketResultSchema.parse({ success: true, ticketId: appealTicketId }));
});

router.get(
  "/admin/super/support-tickets",
  adminSupportRole,
  async (req, res): Promise<void> => {
    const query = ListAdminSupportTicketsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }

    const filters = [];
    if (query.data.status === "needs_attention") {
      filters.push(inArray(supportTicketsTable.status, ["new", "in_review"]));
    } else if (query.data.status) {
      filters.push(eq(supportTicketsTable.status, query.data.status));
    }
    if (query.data.category) {
      filters.push(eq(supportTicketsTable.category, query.data.category));
    }
    if (query.data.isContentReport !== undefined) {
      filters.push(eq(supportTicketsTable.isContentReport, query.data.isContentReport));
    }

    const tickets = await db
      .select()
      .from(supportTicketsTable)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(
        query.data.sort === "oldest" ? asc(supportTicketsTable.createdAt) : desc(supportTicketsTable.createdAt),
        query.data.sort === "oldest" ? asc(supportTicketsTable.id) : desc(supportTicketsTable.id),
      )
      .limit(query.data.limit)
      .offset(query.data.offset);

    res.json(ListAdminSupportTicketsResponse.parse(tickets));
  },
);

router.get(
  "/admin/super/support-tickets/:id",
  adminSupportRole,
  async (req, res): Promise<void> => {
    const params = GetAdminSupportTicketParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const detail = await getTicketDetail(params.data.id);
    if (!detail) {
      res.status(404).json({ error: "Support ticket not found." });
      return;
    }
    res.json(GetAdminSupportTicketResponse.parse(detail));
  },
);

router.patch(
  "/admin/super/support-tickets/:id",
  adminSupportRole,
  async (req, res): Promise<void> => {
    const params = UpdateAdminSupportTicketParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = UpdateAdminSupportTicketBody.safeParse(req.body);
    if (!body.success || Object.keys(body.data).length === 0) {
      res.status(400).json({
        error: body.success ? "Provide a status or admin note to update." : body.error.message,
      });
      return;
    }

    const [currentTicket] = await db
      .select()
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.id, params.data.id));
    if (!currentTicket) {
      res.status(404).json({ error: "Support ticket not found." });
      return;
    }
    if (body.data.status === "resolved" && currentTicket.isContentReport && currentTicket.status !== "resolved") {
      res.status(400).json({ error: "Send a reply to the reporter before resolving a content report." });
      return;
    }

    if (body.data.assignment === "unassigned"
      && currentTicket.assignedModeratorId
      && currentTicket.assignedModeratorId !== req.user!.id
      && req.user!.role !== "super_admin") {
      res.status(403).json({ error: "Only the assigned moderator or a super admin can unassign this ticket." });
      return;
    }
    if (body.data.assignment === "me"
      && currentTicket.assignedModeratorId
      && currentTicket.assignedModeratorId !== req.user!.id
      && req.user!.role !== "super_admin") {
      res.status(403).json({ error: "Only a super admin can reassign another moderator's ticket." });
      return;
    }

    const { assignment, escalate, ...ticketFields } = body.data;
    const update: Record<string, unknown> = { ...ticketFields };
    if (assignment === "me") update.assignedModeratorId = req.user!.id;
    if (assignment === "unassigned") update.assignedModeratorId = null;
    if (escalate) {
      update.escalatedAt = currentTicket.escalatedAt ?? new Date();
      update.severity = "urgent";
    }

    const [ticket] = await db
      .update(supportTicketsTable)
      .set({
        ...update,
        reviewedBy: req.user!.id,
        reviewedAt: new Date(),
      })
      .where(eq(supportTicketsTable.id, params.data.id))
      .returning();

    if (!ticket) {
      res.status(404).json({ error: "Support ticket not found." });
      return;
    }

    const recorded = await writeAuditEvent(req.user!.id, "admin_update_support_ticket", ticket.ticketId, {
        status: ticket.status,
        severity: ticket.severity,
        assignedModeratorId: ticket.assignedModeratorId,
        escalatedAt: ticket.escalatedAt?.toISOString() ?? null,
        changedFields: Object.keys(body.data).filter((field) => field !== "adminNotes"),
      });
    if (!recorded) {
      req.log.error({ ticketId: ticket.id }, "Support ticket was updated but its audit event could not be recorded");
    }

    res.json(UpdateAdminSupportTicketResponse.parse(ticket));
  },
);

router.post(
  "/admin/super/support-tickets/:id/replies",
  adminSupportRole,
  async (req, res): Promise<void> => {
    const params = ReplyToAdminSupportTicketParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const rawExpectedUpdatedAt = req.body?.expectedUpdatedAt;
    const expectedUpdatedAt =
      typeof rawExpectedUpdatedAt === "string" && Number.isFinite(Date.parse(rawExpectedUpdatedAt))
        ? new Date(rawExpectedUpdatedAt)
        : rawExpectedUpdatedAt;
    const body = ReplyToAdminSupportTicketBody.safeParse({
      ...req.body,
      expectedUpdatedAt,
    });
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    if (!body.data.replyText.trim()) {
      res.status(400).json({ error: "Reply text cannot be blank." });
      return;
    }

    const admin = req.user!;
    const adminDisplayName =
      [admin.firstName, admin.lastName].filter(Boolean).join(" ").trim() ||
      admin.email ||
      admin.id;

    const result = await db.transaction(async (tx) => {
      const [ticket] = await tx
        .select()
        .from(supportTicketsTable)
        .where(eq(supportTicketsTable.id, params.data.id))
        .for("update");

      if (!ticket) return { kind: "not_found" as const };
      if (ticket.updatedAt.getTime() !== body.data.expectedUpdatedAt.getTime()) {
        return { kind: "conflict" as const };
      }

      let deliveryChannel: "inbox" | "email";
      let deliveryStatus: "sent" | "failed" = "sent";
      let deliveryError: string | undefined;
      let candidateMessageId: number | null = null;

      if (ticket.userId) {
        deliveryChannel = "inbox";
        const [candidateMessage] = await tx
          .insert(candidateMessagesTable)
          .values({
            recipientUserId: ticket.userId,
            companyName: "JOBSAGE Support",
            messageType: "support",
            messageText: body.data.replyText,
            subject: `Reply to your support inquiry: ${ticket.subject}`,
            supportTicketId: ticket.id,
          })
          .returning({ id: candidateMessagesTable.id });
        candidateMessageId = candidateMessage.id;
      } else {
        deliveryChannel = "email";
        const delivery = await sendSupportTicketReply({
          to: ticket.email,
          ticketId: ticket.ticketId,
          subject: ticket.subject,
          replyText: body.data.replyText,
        });
        if (!delivery.success) {
          deliveryStatus = "failed";
          deliveryError = delivery.error;
        }
      }

      await tx.insert(supportTicketRepliesTable).values({
        ticketId: ticket.id,
        adminUserId: admin.id,
        adminDisplayName,
        replyText: body.data.replyText,
        deliveryChannel,
        deliveryStatus,
        candidateMessageId,
      });

      if (deliveryStatus === "failed") {
        return { kind: "delivery_failed" as const, error: deliveryError };
      }

      const [updatedTicket] = await tx
        .update(supportTicketsTable)
        .set({
          status: body.data.status,
          reviewedBy: admin.id,
          reviewedAt: new Date(),
        })
        .where(eq(supportTicketsTable.id, ticket.id))
        .returning();

      const replies = await tx
        .select()
        .from(supportTicketRepliesTable)
        .where(eq(supportTicketRepliesTable.ticketId, ticket.id))
        .orderBy(asc(supportTicketRepliesTable.createdAt), asc(supportTicketRepliesTable.id));

      return { kind: "success" as const, detail: { ticket: updatedTicket, replies } };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: "Support ticket not found." });
      return;
    }
    if (result.kind === "conflict") {
      res.status(409).json({ error: "This ticket changed after it was loaded. Refresh it before replying." });
      return;
    }
    if (result.kind === "delivery_failed") {
      req.log.error(
        { ticketId: params.data.id, error: result.error },
        "Support ticket reply email could not be delivered",
      );
      res.status(502).json({ error: "Email delivery failed. The ticket was not marked attended or resolved." });
      return;
    }

    const recorded = await writeAuditEvent(admin.id, "admin_reply_support_ticket", result.detail.ticket.ticketId, {
        status: result.detail.ticket.status,
        deliveryChannel: result.detail.replies.at(-1)?.deliveryChannel,
      });
    if (!recorded) {
      req.log.error({ ticketId: params.data.id }, "Support reply was saved but its audit event could not be recorded");
    }

    const refreshedDetail = await getTicketDetail(params.data.id);
    res.json(ReplyToAdminSupportTicketResponse.parse(refreshedDetail ?? {
      ...result.detail,
      history: [],
    }));
  },
);

export default router;
