import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  CreateSupportTicketBody,
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
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import {
  candidateMessagesTable,
  db,
  supportTicketRepliesTable,
  supportTicketsTable,
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

  return { ticket, replies };
}

router.post("/support/ticket", async (req, res): Promise<void> => {
  const parsed = CreateSupportTicketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const ticketId = `JS-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  await db.insert(supportTicketsTable).values({
    ticketId,
    ...parsed.data,
    userId: req.user?.id ?? null,
  });

  const delivery = await sendSupportTicketNotification({ ticketId, ...parsed.data });
  if (!delivery.success) {
    req.log.error(
      { ticketId, error: delivery.error },
      "Support ticket was saved but its email notification could not be delivered",
    );
  }

  res.status(201).json(SupportTicketResultSchema.parse({
    success: true,
    ticketId,
  }));
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

    const [ticket] = await db
      .update(supportTicketsTable)
      .set({
        ...body.data,
        reviewedBy: req.user!.id,
        reviewedAt: new Date(),
      })
      .where(eq(supportTicketsTable.id, params.data.id))
      .returning();

    if (!ticket) {
      res.status(404).json({ error: "Support ticket not found." });
      return;
    }

    writeAuditEvent(req.user!.id, "admin_update_support_ticket", String(ticket.id), {
      status: ticket.status,
    }).catch(() => {});

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

    writeAuditEvent(admin.id, "admin_reply_support_ticket", String(params.data.id), {
      status: result.detail.ticket.status,
      deliveryChannel: result.detail.replies.at(-1)?.deliveryChannel,
    }).catch(() => {});

    res.json(ReplyToAdminSupportTicketResponse.parse(result.detail));
  },
);

export default router;
