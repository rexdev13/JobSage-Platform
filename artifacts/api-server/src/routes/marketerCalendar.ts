import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  marketerEventsTable,
  socialLeadsTable,
  usersTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/requireRole";
import { getCalendlySyncStatus, syncCalendlyEvents } from "../lib/calendlySync";
import {
  assertGoogleCalendarSlotAvailable,
  createGoogleMeetBooking,
  deleteGoogleCalendarEvent,
  getGoogleCalendarStatus,
  type GoogleCalendarAuth,
  GoogleCalendarRequestError,
  listGoogleCalendarAvailableSlots,
  parseGoogleExternalEventUri,
  updateGoogleCalendarEvent,
} from "../lib/googleCalendar";
import {
  createGoogleOAuthState,
  decryptGoogleRefreshToken,
  encryptGoogleRefreshToken,
  exchangeGoogleAuthorizationCode,
  googleCalendarAuthorizationUrl,
  verifyGoogleOAuthState,
} from "../lib/googleCalendarOAuth";

const router: IRouter = Router();
const calendarRoles = requireRole("marketing", "admin", "super_admin");
const calendarAdminRoles = requireRole("admin", "super_admin");

const eventStatusSchema = z.enum(["scheduled", "completed", "cancelled", "rescheduled", "no_show"]);
const dateSchema = z.coerce.date();

const eventCreateSchema = z.object({
  leadId: z.coerce.number().int().positive().optional(),
  marketingUserId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(300),
  scheduledAt: dateSchema,
  endTime: dateSchema.optional(),
  meetingUrl: z.union([z.string().trim().url(), z.literal("")]).optional(),
  notes: z.string().trim().max(5000).optional(),
  provider: z.enum(["manual", "google_calendar"]).optional().default("manual"),
  timeZone: z.string().trim().min(1).max(100).optional().default("UTC"),
});

const eventPatchSchema = z.object({
  scheduledAt: dateSchema.optional(),
  endTime: dateSchema.optional(),
  status: eventStatusSchema.optional(),
  meetingUrl: z.union([z.string().trim().url(), z.literal("")]).optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  title: z.string().trim().min(1).max(300).optional(),
});
const publicBookingSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254),
  start: z.coerce.date(),
  notes: z.string().trim().max(2000).optional(),
  consent: z.literal(true),
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
  calendlySyncedAt: marketerEventsTable.calendlySyncedAt,
  googleSyncedAt: marketerEventsTable.googleSyncedAt,
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

function googleCalendarErrorResponse(
  error: unknown,
  res: Response,
  fallback: string,
): void {
  if (error instanceof GoogleCalendarRequestError) {
    const status = error.status === 409
      ? 409
      : error.status === 401 || error.status === 403
        ? 503
        : error.status >= 500
          ? 502
          : 400;
    res.status(status).json({ error: error.message });
    return;
  }
  console.error("[google-calendar] Booking operation failed:", error);
  res.status(502).json({ error: fallback });
}

async function getGoogleCalendarAuth(marketingUserId: string): Promise<{
  auth: GoogleCalendarAuth;
  accountEmail: string | null;
}> {
  const [user] = await db
    .select({
      refreshToken: usersTable.googleCalendarRefreshToken,
      accountEmail: usersTable.googleCalendarAccountEmail,
    })
    .from(usersTable)
    .where(eq(usersTable.id, marketingUserId))
    .limit(1);
  if (!user?.refreshToken) {
    throw new GoogleCalendarRequestError(
      "This marketer must connect their own Google Calendar before booking.",
      409,
    );
  }
  try {
    return {
      auth: { refreshToken: decryptGoogleRefreshToken(user.refreshToken) },
      accountEmail: user.accountEmail,
    };
  } catch {
    throw new GoogleCalendarRequestError(
      "This marketer's Google Calendar connection needs to be reconnected.",
      503,
    );
  }
}

function validTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-GB", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  ) - date.getTime();
}

function zonedDateTime(date: string, hour: number, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const wallClockUtc = Date.UTC(year!, month! - 1, day!, hour, 0, 0);
  let result = new Date(wallClockUtc - timeZoneOffsetMs(new Date(wallClockUtc), timeZone));
  result = new Date(wallClockUtc - timeZoneOffsetMs(result, timeZone));
  return result;
}

function publicBookingWindow(
  date: string,
  timeZone: string,
): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !validTimeZone(timeZone)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const day = parsed.getUTCDay();
  if (day === 0 || day === 6) return null;
  const start = zonedDateTime(date, 9, timeZone);
  const end = zonedDateTime(date, 17, timeZone);
  const earliest = new Date(Date.now() - 24 * 60 * 60_000);
  const latest = new Date(Date.now() + 90 * 24 * 60 * 60_000);
  if (start < earliest || start > latest || end <= start) return null;
  return { start, end };
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
    const dateRange = and(
      gte(marketerEventsTable.scheduledAt, start),
      lte(marketerEventsTable.scheduledAt, end),
    );
    const where = isAdmin
      ? requestedMarketer
        ? and(eq(marketerEventsTable.marketingUserId, requestedMarketer), dateRange)
        : dateRange
      : and(eq(marketerEventsTable.marketingUserId, req.user!.id), dateRange);

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
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
      })
      .from(usersTable)
      .where(and(eq(usersTable.id, targetMarketingUserId), eq(usersTable.role, "marketing")))
      .limit(1);
    if (!targetUser) {
      res.status(400).json({ error: "The selected calendar owner is not a marketing user." });
      return;
    }

    let selectedLead: {
      id: number;
      marketingUserId: string | null;
      status: string;
      firstName: string | null;
      lastName: string | null;
      email: string;
    } | null = null;
    if (parsed.data.leadId) {
      const [lead] = await db
        .select({
          id: socialLeadsTable.id,
          marketingUserId: socialLeadsTable.marketingUserId,
          status: socialLeadsTable.status,
          firstName: socialLeadsTable.firstName,
          lastName: socialLeadsTable.lastName,
          email: socialLeadsTable.email,
        })
        .from(socialLeadsTable)
        .where(eq(socialLeadsTable.id, parsed.data.leadId))
        .limit(1);
      if (!lead) {
        res.status(404).json({ error: "Lead not found." });
        return;
      }
      selectedLead = lead;
      if (!isAdmin && lead.marketingUserId && lead.marketingUserId !== req.user!.id) {
        res.status(403).json({ error: "You can only schedule calls for your own leads." });
        return;
      }
    }

    let googleBooking: Awaited<ReturnType<typeof createGoogleMeetBooking>> | null = null;
    let googleCalendarId: string | null = null;
    let googleAuth: GoogleCalendarAuth | null = null;
    if (parsed.data.provider === "google_calendar") {
      try {
        googleAuth = (await getGoogleCalendarAuth(targetMarketingUserId)).auth;
        const calendar = await getGoogleCalendarStatus(googleAuth);
        googleCalendarId = calendar.calendarId;
        await assertGoogleCalendarSlotAvailable(
          googleAuth,
          calendar.calendarId,
          parsed.data.scheduledAt,
          endTime,
          parsed.data.timeZone,
        );
        const marketerName = [targetUser.firstName, targetUser.lastName].filter(Boolean).join(" ");
        const leadName = selectedLead
          ? [selectedLead.firstName, selectedLead.lastName].filter(Boolean).join(" ")
          : "";
        googleBooking = await createGoogleMeetBooking({
          auth: googleAuth,
          calendarId: calendar.calendarId,
          title: parsed.data.title,
          description: [
            parsed.data.notes,
            marketerName ? `JOBSAGE marketer: ${marketerName}` : null,
            leadName ? `Lead: ${leadName}` : null,
          ].filter(Boolean).join("\n\n"),
          start: parsed.data.scheduledAt,
          end: endTime,
          timeZone: parsed.data.timeZone,
          attendeeEmails: [selectedLead?.email, targetUser.email],
          marketingUserId: targetMarketingUserId,
          leadId: selectedLead?.id ?? null,
        });
      } catch (error) {
        googleCalendarErrorResponse(
          error,
          res,
          "Google Calendar could not create this booking. Please try again.",
        );
        return;
      }
    }

    try {
      const [created] = await db
        .insert(marketerEventsTable)
        .values({
          marketingUserId: targetMarketingUserId,
          leadId: parsed.data.leadId ?? null,
          title: parsed.data.title,
          scheduledAt: parsed.data.scheduledAt,
          endTime,
          meetingUrl: googleBooking?.meetingUrl ?? (parsed.data.meetingUrl || null),
          notes: parsed.data.notes || null,
          source: parsed.data.provider,
          externalEventUri: googleBooking?.externalEventUri ?? null,
          externalInviteeEmail: googleBooking ? selectedLead?.email ?? null : null,
          googleSyncedAt: googleBooking ? new Date() : null,
        })
        .returning();

      if (selectedLead?.status === "new") {
        await db
          .update(socialLeadsTable)
          .set({ status: "contacted", contactedAt: new Date() })
          .where(eq(socialLeadsTable.id, selectedLead.id));
      }
      res.status(201).json({ event: created });
    } catch (error) {
      if (googleBooking && googleCalendarId && googleAuth) {
        await deleteGoogleCalendarEvent(googleAuth, googleCalendarId, googleBooking.eventId).catch(
          (cleanupError) => console.error("[google-calendar] Could not roll back orphan event:", cleanupError),
        );
      }
      throw error;
    }
  },
);

router.get(
  "/marketer/calendar/google/status",
  calendarRoles,
  async (req: Request, res: Response): Promise<void> => {
    const isAdmin = isAdminRole(req.user?.role);
    const requestedMarketer = String(req.query.marketingUserId ?? "").trim();
    const marketingUserId = isAdmin ? requestedMarketer : req.user!.id;
    if (!marketingUserId) {
      res.json({ connected: false });
      return;
    }
    try {
      const [user] = await db
        .select({
          refreshToken: usersTable.googleCalendarRefreshToken,
          accountEmail: usersTable.googleCalendarAccountEmail,
        })
        .from(usersTable)
        .where(eq(usersTable.id, marketingUserId))
        .limit(1);
      if (!user?.refreshToken) {
        res.json({ connected: false, accountEmail: null });
        return;
      }
      const googleAuth = await getGoogleCalendarAuth(marketingUserId);
      const status = await getGoogleCalendarStatus(googleAuth.auth);
      res.json({ ...status, accountEmail: googleAuth.accountEmail });
    } catch (error) {
      googleCalendarErrorResponse(
        error,
        res,
        "Google Calendar is not available for automated bookings.",
      );
    }
  },
);

router.get(
  "/marketer/calendar/google/connect",
  calendarRoles,
  async (req: Request, res: Response): Promise<void> => {
    if (req.user?.role !== "marketing") {
      res.status(403).json({ error: "Each marketer must connect their own Google Calendar." });
      return;
    }
    try {
      const state = createGoogleOAuthState({
        userId: req.user.id,
        returnPath: "/admin/calendar",
      });
      res.redirect(googleCalendarAuthorizationUrl(state));
    } catch (error) {
      console.error("[google-calendar] OAuth setup failed:", error);
      res.status(503).json({ error: "Google Calendar OAuth is not configured yet." });
    }
  },
);

router.get(
  "/marketer/calendar/google/oauth/callback",
  async (req: Request, res: Response): Promise<void> => {
    const stateValue = String(req.query.state ?? "");
    let state: ReturnType<typeof verifyGoogleOAuthState>;
    try {
      state = verifyGoogleOAuthState(stateValue);
    } catch {
      res.status(400).send("Invalid or expired Google Calendar connection request.");
      return;
    }
    const returnPath = state.returnPath.startsWith("/") ? state.returnPath : "/admin/calendar";
    if (req.query.error || typeof req.query.code !== "string") {
      res.redirect(`${returnPath}?googleCalendar=cancelled`);
      return;
    }
    try {
      const [user] = await db
        .select({ id: usersTable.id, role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, state.userId))
        .limit(1);
      if (!user || user.role !== "marketing") {
        res.status(403).send("Only a marketer can connect a Google Calendar.");
        return;
      }
      const tokens = await exchangeGoogleAuthorizationCode(req.query.code);
      const auth = { refreshToken: tokens.refreshToken };
      await getGoogleCalendarStatus(auth);
      await db
        .update(usersTable)
        .set({
          googleCalendarRefreshToken: encryptGoogleRefreshToken(tokens.refreshToken),
          googleCalendarAccountEmail: tokens.accountEmail,
          googleCalendarConnectedAt: new Date(),
        })
        .where(eq(usersTable.id, state.userId));
      res.redirect(`${returnPath}?googleCalendar=connected`);
    } catch (error) {
      console.error("[google-calendar] OAuth callback failed:", error);
      res.redirect(`${returnPath}?googleCalendar=error`);
    }
  },
);

router.delete(
  "/marketer/calendar/google/connection",
  calendarRoles,
  async (req: Request, res: Response): Promise<void> => {
    if (req.user?.role !== "marketing") {
      res.status(403).json({ error: "Each marketer must manage their own Google Calendar connection." });
      return;
    }
    await db
      .update(usersTable)
      .set({
        googleCalendarRefreshToken: null,
        googleCalendarAccountEmail: null,
        googleCalendarConnectedAt: null,
      })
      .where(eq(usersTable.id, req.user.id));
    res.json({ connected: false });
  },
);

router.get(
  "/marketer/calendar/google/booking-link",
  calendarRoles,
  async (req: Request, res: Response): Promise<void> => {
    const isAdmin = isAdminRole(req.user?.role);
    const requestedMarketer = String(req.query.marketingUserId ?? "").trim();
    const marketingUserId = isAdmin && requestedMarketer ? requestedMarketer : req.user!.id;
    const [marketer] = await db
      .select({
        id: usersTable.id,
        slug: usersTable.googleBookingSlug,
        timeZone: usersTable.googleBookingTimezone,
      })
      .from(usersTable)
      .where(and(eq(usersTable.id, marketingUserId), eq(usersTable.role, "marketing")))
      .limit(1);
    if (!marketer) {
      res.status(404).json({ error: "Marketing user not found." });
      return;
    }
    let slug = marketer.slug;
    if (!slug) {
      slug = randomBytes(18).toString("base64url");
      await db
        .update(usersTable)
        .set({ googleBookingSlug: slug, googleBookingEnabled: true })
        .where(and(eq(usersTable.id, marketer.id), isNull(usersTable.googleBookingSlug)));
      const [saved] = await db
        .select({ slug: usersTable.googleBookingSlug })
        .from(usersTable)
        .where(eq(usersTable.id, marketer.id))
        .limit(1);
      slug = saved?.slug ?? slug;
    }
    res.json({
      path: `/book/${slug}`,
      timeZone: marketer.timeZone,
      enabled: true,
    });
  },
);

router.get(
  "/marketer/calendar/calendly/status",
  calendarRoles,
  async (req: Request, res: Response): Promise<void> => {
    const isAdmin = isAdminRole(req.user?.role);
    const requestedMarketer = String(req.query.marketingUserId ?? "").trim();
    const marketingUserId = isAdmin
      ? requestedMarketer || undefined
      : req.user!.id;
    res.json(await getCalendlySyncStatus(marketingUserId));
  },
);

router.post(
  "/marketer/calendar/calendly/sync",
  calendarAdminRoles,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const summary = await syncCalendlyEvents();
      const isAdmin = isAdminRole(req.user?.role);
      const requestedMarketer = String(req.body?.marketingUserId ?? "").trim();
      const marketingUserId = isAdmin
        ? requestedMarketer || undefined
        : req.user!.id;
      const status = await getCalendlySyncStatus(marketingUserId);
      res.json({ summary, status });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Calendly synchronization failed.";
      const unavailable = /\(401\)|\(403\)|not connected|unauthenticated/i.test(message);
      res.status(unavailable ? 503 : 502).json({
        error: unavailable
          ? "Calendly is not connected with permission to read scheduled events."
          : "Calendly could not be synchronized right now. Please try again.",
      });
    }
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
    if (existing.source === "calendly") {
      const forbiddenKeys = Object.keys(req.body ?? {}).filter(
        (key) => key !== "notes" && key !== "status",
      );
      if (forbiddenKeys.length > 0) {
        res.status(409).json({
          error: "Calendly controls this event's title, time, and meeting link. Change those details in Calendly.",
        });
        return;
      }
      if (parsed.data.status && !["scheduled", "completed", "no_show"].includes(parsed.data.status)) {
        res.status(409).json({
          error: "Calendly controls cancellation and rescheduling. Only the call outcome can be changed in JOBSAGE.",
        });
        return;
      }
    }
    if (existing.source === "google_calendar" && parsed.data.meetingUrl !== undefined) {
      res.status(409).json({
        error: "Google Meet controls this event's meeting link.",
      });
      return;
    }

    const scheduledAt = parsed.data.scheduledAt ?? existing.scheduledAt;
    const endTime = parsed.data.endTime ?? existing.endTime;
    if (endTime <= scheduledAt) {
      res.status(400).json({ error: "endTime must be after scheduledAt." });
      return;
    }

    if (existing.source === "google_calendar") {
      const external = parseGoogleExternalEventUri(existing.externalEventUri);
      if (!external) {
        res.status(409).json({ error: "This Google Calendar event is missing its external identity." });
        return;
      }
      try {
        const googleAuth = await getGoogleCalendarAuth(existing.marketingUserId);
        await updateGoogleCalendarEvent(googleAuth.auth, external.calendarId, external.eventId, {
          title: parsed.data.title,
          start: parsed.data.scheduledAt,
          end: parsed.data.endTime,
          description: parsed.data.notes,
        });
      } catch (error) {
        googleCalendarErrorResponse(
          error,
          res,
          "Google Calendar could not update this booking. Please try again.",
        );
        return;
      }
    }

    const [updated] = await db
      .update(marketerEventsTable)
      .set({
        ...parsed.data,
        meetingUrl: parsed.data.meetingUrl === "" ? null : parsed.data.meetingUrl,
        notes: parsed.data.notes === undefined ? undefined : parsed.data.notes,
        scheduledAt,
        endTime,
        googleSyncedAt: existing.source === "google_calendar" ? new Date() : undefined,
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
    const [existing] = await db
      .select({
        marketingUserId: marketerEventsTable.marketingUserId,
        source: marketerEventsTable.source,
        externalEventUri: marketerEventsTable.externalEventUri,
      })
      .from(marketerEventsTable)
      .where(where)
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Calendar event not found." });
      return;
    }
    if (existing.source === "calendly") {
      res.status(409).json({
        error: "Calendly events cannot be deleted in JOBSAGE. Cancel the booking in Calendly instead.",
      });
      return;
    }
    if (existing.source === "google_calendar") {
      const external = parseGoogleExternalEventUri(existing.externalEventUri);
      if (!external) {
        res.status(409).json({ error: "This Google Calendar event is missing its external identity." });
        return;
      }
      try {
        const googleAuth = await getGoogleCalendarAuth(existing.marketingUserId);
        await deleteGoogleCalendarEvent(googleAuth.auth, external.calendarId, external.eventId);
      } catch (error) {
        googleCalendarErrorResponse(
          error,
          res,
          "Google Calendar could not cancel this booking. Please try again.",
        );
        return;
      }
    }
    const [deleted] = await db.delete(marketerEventsTable).where(where).returning({ id: marketerEventsTable.id });
    if (!deleted) {
      res.status(404).json({ error: "Calendar event not found." });
      return;
    }
    res.json({ id: deleted.id });
  },
);

router.get(
  "/public/marketer-booking/:slug",
  async (req: Request, res: Response): Promise<void> => {
    const slug = String(req.params.slug ?? "").trim();
    const [marketer] = await db
      .select({
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        timeZone: usersTable.googleBookingTimezone,
      })
      .from(usersTable)
      .where(and(
        eq(usersTable.googleBookingSlug, slug),
        eq(usersTable.googleBookingEnabled, true),
        eq(usersTable.role, "marketing"),
      ))
      .limit(1);
    if (!marketer) {
      res.status(404).json({ error: "This booking link is not available." });
      return;
    }
    res.json({
      marketerName: [marketer.firstName, marketer.lastName].filter(Boolean).join(" ") || "JOBSAGE",
      timeZone: marketer.timeZone,
      durationMinutes: 30,
      workingHours: "09:00–17:00",
    });
  },
);

router.get(
  "/public/marketer-booking/:slug/slots",
  async (req: Request, res: Response): Promise<void> => {
    const slug = String(req.params.slug ?? "").trim();
    const date = String(req.query.date ?? "").trim();
    const [marketer] = await db
      .select({
        id: usersTable.id,
        timeZone: usersTable.googleBookingTimezone,
      })
      .from(usersTable)
      .where(and(
        eq(usersTable.googleBookingSlug, slug),
        eq(usersTable.googleBookingEnabled, true),
        eq(usersTable.role, "marketing"),
      ))
      .limit(1);
    if (!marketer) {
      res.status(404).json({ error: "This booking link is not available." });
      return;
    }
    const window = publicBookingWindow(date, marketer.timeZone);
    if (!window) {
      res.json({ slots: [], date, timeZone: marketer.timeZone });
      return;
    }
    try {
      const googleAuth = await getGoogleCalendarAuth(marketer.id);
      const calendar = await getGoogleCalendarStatus(googleAuth.auth);
      const slots = await listGoogleCalendarAvailableSlots({
        auth: googleAuth.auth,
        calendarId: calendar.calendarId,
        windowStart: window.start,
        windowEnd: window.end,
        durationMinutes: 30,
        minimumStart: new Date(Date.now() + 60 * 60_000),
        timeZone: marketer.timeZone,
      });
      res.json({ slots, date, timeZone: marketer.timeZone });
    } catch (error) {
      googleCalendarErrorResponse(
        error,
        res,
        "Availability could not be loaded right now. Please try again.",
      );
    }
  },
);

router.post(
  "/public/marketer-booking/:slug/book",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = publicBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid booking details." });
      return;
    }
    const slug = String(req.params.slug ?? "").trim();
    const [marketer] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        timeZone: usersTable.googleBookingTimezone,
      })
      .from(usersTable)
      .where(and(
        eq(usersTable.googleBookingSlug, slug),
        eq(usersTable.googleBookingEnabled, true),
        eq(usersTable.role, "marketing"),
      ))
      .limit(1);
    if (!marketer) {
      res.status(404).json({ error: "This booking link is not available." });
      return;
    }

    const dateParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: marketer.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(parsed.data.start);
    const values = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
    const localDate = `${values.year}-${values.month}-${values.day}`;
    const window = publicBookingWindow(localDate, marketer.timeZone);
    const end = new Date(parsed.data.start.getTime() + 30 * 60_000);
    if (
      !window ||
      parsed.data.start < new Date(Date.now() + 60 * 60_000) ||
      parsed.data.start < window.start ||
      end > window.end ||
      (parsed.data.start.getTime() - window.start.getTime()) % (30 * 60_000) !== 0
    ) {
      res.status(400).json({ error: "Choose one of the available booking times." });
      return;
    }

    const normalizedEmail = parsed.data.email.toLowerCase();
    const [duplicate] = await db
      .select({ id: marketerEventsTable.id })
      .from(marketerEventsTable)
      .where(and(
        eq(marketerEventsTable.marketingUserId, marketer.id),
        eq(marketerEventsTable.scheduledAt, parsed.data.start),
        sql`lower(${marketerEventsTable.externalInviteeEmail}) = ${normalizedEmail}`,
      ))
      .limit(1);
    if (duplicate) {
      res.status(409).json({ error: "This call is already booked." });
      return;
    }
    const [lead] = await db
      .select({
        id: socialLeadsTable.id,
        status: socialLeadsTable.status,
      })
      .from(socialLeadsTable)
      .where(and(
        sql`lower(${socialLeadsTable.email}) = ${normalizedEmail}`,
        or(
          eq(socialLeadsTable.marketingUserId, marketer.id),
          isNull(socialLeadsTable.marketingUserId),
        ),
      ))
      .orderBy(desc(socialLeadsTable.createdAt))
      .limit(1);

    let calendarId: string | null = null;
    let booking: Awaited<ReturnType<typeof createGoogleMeetBooking>> | null = null;
    let googleAuth: GoogleCalendarAuth | null = null;
    try {
      googleAuth = (await getGoogleCalendarAuth(marketer.id)).auth;
      const calendar = await getGoogleCalendarStatus(googleAuth);
      calendarId = calendar.calendarId;
      await assertGoogleCalendarSlotAvailable(
        googleAuth,
        calendar.calendarId,
        parsed.data.start,
        end,
        marketer.timeZone,
      );
      const guestName = `${parsed.data.firstName} ${parsed.data.lastName}`.trim();
      booking = await createGoogleMeetBooking({
        auth: googleAuth,
        calendarId: calendar.calendarId,
        title: `JOBSAGE Discovery Call with ${guestName}`,
        description: [
          parsed.data.notes,
          "Booked through the JOBSAGE scheduling page.",
        ].filter(Boolean).join("\n\n"),
        start: parsed.data.start,
        end,
        timeZone: marketer.timeZone,
        attendeeEmails: [normalizedEmail, marketer.email],
        marketingUserId: marketer.id,
        leadId: lead?.id ?? null,
      });
    } catch (error) {
      googleCalendarErrorResponse(
        error,
        res,
        "This booking could not be completed. Please choose another time.",
      );
      return;
    }

    try {
      await db
        .insert(marketerEventsTable)
        .values({
          marketingUserId: marketer.id,
          leadId: lead?.id ?? null,
          title: `JOBSAGE Discovery Call with ${parsed.data.firstName} ${parsed.data.lastName}`,
          scheduledAt: parsed.data.start,
          endTime: end,
          meetingUrl: booking.meetingUrl,
          notes: parsed.data.notes || null,
          source: "google_calendar",
          externalEventUri: booking.externalEventUri,
          externalInviteeEmail: normalizedEmail,
          googleSyncedAt: new Date(),
        });
      if (lead?.status === "new") {
        await db
          .update(socialLeadsTable)
          .set({ status: "contacted", contactedAt: new Date() })
          .where(eq(socialLeadsTable.id, lead.id));
      }
      res.status(201).json({
        scheduledAt: parsed.data.start.toISOString(),
        endTime: end.toISOString(),
        meetingUrl: booking.meetingUrl,
        marketerName: [marketer.firstName, marketer.lastName].filter(Boolean).join(" ") || "JOBSAGE",
      });
    } catch (error) {
      if (calendarId && booking && googleAuth) {
        await deleteGoogleCalendarEvent(googleAuth, calendarId, booking.eventId).catch(
          (cleanupError) => console.error("[google-calendar] Could not roll back public booking:", cleanupError),
        );
      }
      throw error;
    }
  },
);

export default router;