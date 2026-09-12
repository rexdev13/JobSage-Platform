import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  marketerEventsTable,
  socialLeadsTable,
  usersTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/requireRole";

const router: IRouter = Router();
const calendarRoles = requireRole("marketing", "admin", "super_admin");

const eventStatusSchema = z.enum(["scheduled", "completed", "cancelled", "rescheduled", "no_show"]);
const eventSourceSchema = z.enum(["manual", "calendly"]);
const dateSchema = z.coerce.date();

const eventCreateSchema = z.object({
  leadId: z.coerce.number().int().positive().optional(),
  marketingUserId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(300),
  scheduledAt: dateSchema,
  endTime: dateSchema.optional(),
  meetingUrl: z.union([z.string().trim().url(), z.literal("")]).optional(),
  notes: z.string().trim().max(5000).optional(),
  source: eventSourceSchema.optional(),
});

const eventPatchSchema = z.object({
  scheduledAt: dateSchema.optional(),
  endTime: dateSchema.optional(),
  status: eventStatusSchema.optional(),
  meetingUrl: z.union([z.string().trim().url(), z.literal("")]).optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  title: z.string().trim().min(1).max(300).optional(),
});

const eventFields = {
  id: marketerEventsTable.id,
  marketingUserId: marketerEventsTable.marketingUserId,
  leadId: marketerEventsTable.leadId,
  title: marketerEventsTable.title,
  scheduledAt: marketerEventsTable.scheduledAt,
  endTime: marketerEventsTable.endTime,
  meetingUrl: marketerEventsTable.meetingUrl,
  status: marketerEventsTable.status,
  notes: marketerEventsTable.notes,
  source: marketerEventsTable.source,
  createdAt: marketerEventsTable.createdAt,
  leadFirstName: socialLeadsTable.firstName,
  leadLastName: socialLeadsTable.lastName,
  leadEmail: socialLeadsTable.email,
  leadPhone: socialLeadsTable.phone,
  leadIndustrySector: socialLeadsTable.industrySector,
  leadStatus: socialLeadsTable.status,
  marketerFirstName: usersTable.firstName,
  marketerLastName: usersTable.lastName,
  marketerEmail: usersTable.email,
};

const isAdminRole = (role: string | null | undefined): boolean =>
  role === "admin" || role === "super_admin";

function parseEventId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeEvent(row: typeof eventFields extends never ? never : Record<string, unknown>) {
  const {
    leadFirstName,
    leadLastName,
    leadEmail,
    leadPhone,
    leadIndustrySector,
    leadStatus,
    marketerFirstName,
    marketerLastName,
    marketerEmail,
    ...event
  } = row as Record<string, any>;
  return {
    ...event,
    lead: event.leadId
      ? {
          firstName: leadFirstName,
          lastName: leadLastName,
          email: leadEmail,
          phone: leadPhone,
          industrySector: leadIndustrySector,
          status: leadStatus,
        }
      : null,
    marketer: {
      name: [marketerFirstName, marketerLastName].filter(Boolean).join(" ") || marketerEmail,
      email: marketerEmail,
    },
  };
}

router.get(
  "/marketer/calendar/events",
  calendarRoles,
  async (req: Request, res: Response): Promise<void> => {
    const start = req.query.start ? new Date(String(req.query.start)) : new Date(Date.now() - 30 * 86400000);
    const end = req.query.end ? new Date(String(req.query.end)) : new Date(Date.now() + 90 * 86400000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      res.status(400).json({ error: "start and end must be valid ISO dates with start before end." });
      return;
    }

    const isAdmin = isAdminRole(req.user?.role);
    const requestedMarketer = String(req.query.marketingUserId ?? "").trim();
    const marketingUserId = isAdmin && requestedMarketer ? requestedMarketer : req.user!.id;
    const where = and(
      eq(marketerEventsTable.marketingUserId, marketingUserId),
      gte(marketerEventsTable.scheduledAt, start),
      lte(marketerEventsTable.scheduledAt, end),
    );

    const rows = await db
      .select(eventFields)
      .from(marketerEventsTable)
      .leftJoin(socialLeadsTable, eq(marketerEventsTable.leadId, socialLeadsTable.id))
      .innerJoin(usersTable, eq(marketerEventsTable.marketingUserId, usersTable.id))
      .where(where)
      .orderBy(asc(marketerEventsTable.scheduledAt));

    res.json({ events: rows.map(normalizeEvent) });
  },
);

router.post(
  "/marketer/calendar/events",
  calendarRoles,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = eventCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid calendar event." });
      return;
    }

    const isAdmin = isAdminRole(req.user?.role);
    const targetMarketingUserId = isAdmin && parsed.data.marketingUserId
      ? parsed.data.marketingUserId
      : req.user!.id;
    const endTime = parsed.data.endTime ?? new Date(parsed.data.scheduledAt.getTime() + 30 * 60000);
    if (endTime <= parsed.data.scheduledAt) {
      res.status(400).json({ error: "endTime must be after scheduledAt." });
      return;
    }

    const [targetUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.id, targetMarketingUserId), eq(usersTable.role, "marketing")))
      .limit(1);
    if (!targetUser) {
      res.status(400).json({ error: "The selected calendar owner is not a marketing user." });
      return;
    }

    if (parsed.data.leadId) {
      const [lead] = await db
        .select({ id: socialLeadsTable.id, marketingUserId: socialLeadsTable.marketingUserId, status: socialLeadsTable.status })
        .from(socialLeadsTable)
        .where(eq(socialLeadsTable.id, parsed.data.leadId))
        .limit(1);
      if (!lead) {
        res.status(404).json({ error: "Lead not found." });
        return;
      }
      if (!isAdmin && lead.marketingUserId && lead.marketingUserId !== req.user!.id) {
        res.status(403).json({ error: "You can only schedule calls for your own leads." });
        return;
      }
      if (lead.status === "new") {
        await db
          .update(socialLeadsTable)
          .set({ status: "contacted", contactedAt: new Date() })
          .where(eq(socialLeadsTable.id, lead.id));
      }
    }

    const [created] = await db
      .insert(marketerEventsTable)
      .values({
        marketingUserId: targetMarketingUserId,
        leadId: parsed.data.leadId ?? null,
        title: parsed.data.title,
        scheduledAt: parsed.data.scheduledAt,
        endTime,
        meetingUrl: parsed.data.meetingUrl || null,
        notes: parsed.data.notes || null,
        source: parsed.data.source ?? "manual",
      })
      .returning();

    res.status(201).json({ event: created });
  },
);

router.patch(
  "/marketer/calendar/events/:id",
  calendarRoles,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseEventId(String(req.params.id));
    if (!id) {
      res.status(400).json({ error: "Invalid event ID." });
      return;
    }
    const parsed = eventPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid event update." });
      return;
    }

    const existingWhere = isAdminRole(req.user?.role)
      ? eq(marketerEventsTable.id, id)
      : and(eq(marketerEventsTable.id, id), eq(marketerEventsTable.marketingUserId, req.user!.id));
    const [existing] = await db.select().from(marketerEventsTable).where(existingWhere).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Calendar event not found." });
      return;
    }

    const scheduledAt = parsed.data.scheduledAt ?? existing.scheduledAt;
    const endTime = parsed.data.endTime ?? existing.endTime;
    if (endTime <= scheduledAt) {
      res.status(400).json({ error: "endTime must be after scheduledAt." });
      return;
    }

    const [updated] = await db
      .update(marketerEventsTable)
      .set({
        ...parsed.data,
        meetingUrl: parsed.data.meetingUrl === "" ? null : parsed.data.meetingUrl,
        notes: parsed.data.notes === undefined ? undefined : parsed.data.notes,
        scheduledAt,
        endTime,
      })
      .where(eq(marketerEventsTable.id, id))
      .returning();

    res.json({ event: updated });
  },
);

router.delete(
  "/marketer/calendar/events/:id",
  calendarRoles,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseEventId(String(req.params.id));
    if (!id) {
      res.status(400).json({ error: "Invalid event ID." });
      return;
    }
    const where = isAdminRole(req.user?.role)
      ? eq(marketerEventsTable.id, id)
      : and(eq(marketerEventsTable.id, id), eq(marketerEventsTable.marketingUserId, req.user!.id));
    const [deleted] = await db.delete(marketerEventsTable).where(where).returning({ id: marketerEventsTable.id });
    if (!deleted) {
      res.status(404).json({ error: "Calendar event not found." });
      return;
    }
    res.json({ id: deleted.id });
  },
);

export default router;