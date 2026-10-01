import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  CreateSupportTicketBody,
  ListAdminSupportTicketsQueryParams,
  ListAdminSupportTicketsResponse,
  UpdateAdminSupportTicketBody,
  UpdateAdminSupportTicketParams,
  UpdateAdminSupportTicketResponse,
} from "@workspace/api-zod";
import { desc, eq } from "drizzle-orm";
import { db, supportTicketsTable } from "@workspace/db";
import { z } from "zod/v4";
import { sendSupportTicketNotification } from "../lib/email";
import { requireRole } from "../middlewares/requireRole";
import { writeAuditEvent } from "../lib/audit";

const router: IRouter = Router();
const SupportTicketResultSchema = z.object({
  success: z.boolean(),
  ticketId: z.string(),
});

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
  requireRole("super_admin"),
  async (req, res): Promise<void> => {
    const query = ListAdminSupportTicketsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }

    const filter = query.data.status
      ? eq(supportTicketsTable.status, query.data.status)
      : undefined;
    const tickets = await db
      .select()
      .from(supportTicketsTable)
      .where(filter)
      .orderBy(desc(supportTicketsTable.createdAt))
      .limit(query.data.limit)
      .offset(query.data.offset);

    res.json(ListAdminSupportTicketsResponse.parse(tickets));
  },
);

router.patch(
  "/admin/super/support-tickets/:id",
  requireRole("super_admin"),
  async (req, res): Promise<void> => {
    const params = UpdateAdminSupportTicketParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = UpdateAdminSupportTicketBody.safeParse(req.body);
    if (!body.success || Object.keys(body.data).length === 0) {
      res.status(400).json({ error: body.success ? "Provide a status or admin note to update." : body.error.message });
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

export default router;