import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, socialLeadsTable, sponsorLicencesTable, usersTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { sql, ilike, or, desc, count, eq, and, gte, isNull } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";
import { buildLeadStats, getRollingWeekStart } from "../lib/weeklyStats";
import { OptionalCalendlyUrlSchema } from "../lib/marketingCalendly";
import { sendWaitlistWelcomeEmail } from "../lib/email";

const router: IRouter = Router();

const marketingLeadFields = {
  id: socialLeadsTable.id,
  name: sql<string>`concat_ws(' ', ${socialLeadsTable.firstName}, ${socialLeadsTable.lastName})`,
  email: socialLeadsTable.email,
  phone: socialLeadsTable.phone,
  sector: socialLeadsTable.industrySector,
  source: socialLeadsTable.source,
  status: socialLeadsTable.status,
  createdAt: socialLeadsTable.createdAt,
  desiredRole: socialLeadsTable.desiredRole,
  additionalMessage: socialLeadsTable.additionalMessage,
  assigneeId: usersTable.id,
  assigneeEmail: usersTable.email,
  assigneeName: sql<string>`concat_ws(' ', ${usersTable.firstName}, ${usersTable.lastName})`,
  assigneeCalendlyUrl: usersTable.calendlyUrl,
};

const adminLeadFields = {
  id: socialLeadsTable.id,
  firstName: socialLeadsTable.firstName,
  lastName: socialLeadsTable.lastName,
  email: socialLeadsTable.email,
  phone: socialLeadsTable.phone,
  industrySector: socialLeadsTable.industrySector,
  desiredRole: socialLeadsTable.desiredRole,
  additionalMessage: socialLeadsTable.additionalMessage,
  utmSource: socialLeadsTable.utmSource,
  utmMedium: socialLeadsTable.utmMedium,
  utmCampaign: socialLeadsTable.utmCampaign,
  utmContent: socialLeadsTable.utmContent,
  landingPath: socialLeadsTable.landingPath,
  referrerUrl: socialLeadsTable.referrerUrl,
  ipHash: socialLeadsTable.ipHash,
  gdprConsent: socialLeadsTable.gdprConsent,
  gdprConsentedAt: socialLeadsTable.gdprConsentedAt,
  status: socialLeadsTable.status,
  source: socialLeadsTable.source,
  convertedUserId: socialLeadsTable.convertedUserId,
  marketingUserId: socialLeadsTable.marketingUserId,
  createdAt: socialLeadsTable.createdAt,
  assigneeId: usersTable.id,
  assigneeEmail: usersTable.email,
  assigneeName: sql<string>`concat_ws(' ', ${usersTable.firstName}, ${usersTable.lastName})`,
  assigneeCalendlyUrl: usersTable.calendlyUrl,
};

export type MarketingLeadScope = "mine_or_unassigned" | "mine" | "unassigned";

export function resolveMarketingLeadScope(
  role: string | null | undefined,
  currentUserId: string | null | undefined,
  assignedTo: string,
): MarketingLeadScope | "all" {
  if (role !== "marketing" || !currentUserId) return "all";
  if (assignedTo === "unassigned") return "unassigned";
  if (assignedTo === currentUserId) return "mine";
  return "mine_or_unassigned";
}

export function isMarketingLeadVisible(
  marketingUserId: string | null | undefined,
  currentUserId: string,
): boolean {
  return marketingUserId == null || marketingUserId === currentUserId;
}

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const SubmitLeadSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("A valid email address is required"),
  phone: z.string().min(1, "Phone number is required"),

  // Qualifying questions (generic — all sectors)
  industrySector: z.string().optional(),
  desiredRole: z.string().optional(),
  additionalMessage: z.string().optional(),

  // UTM / attribution — client sends these from its own URL bar
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  utmContent: z.string().optional(),
  landingPath: z.string().optional(),
  referrerUrl: z.string().optional(),

  // Consent — must be true; literal(true) rejects false/missing
  gdprConsent: z.literal(true, {
    errorMap: () => ({ message: "GDPR consent is required to submit this form" }),
  }),
});

// ---------------------------------------------------------------------------
// GET /api/leads — paginated list of waitlist submissions.
// Marketing receives only the fields needed by its table; admin roles retain
// the full CRM record for operational work.
// ---------------------------------------------------------------------------

router.get(
  "/leads",
  requireRole("admin", "super_admin", "marketing"),
  async (req: Request, res: Response): Promise<void> => {
    const page   = Math.max(1, parseInt(String(req.query.page  ?? "1"),  10));
    const limit  = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10)));
    const search = String(req.query.search ?? "").trim();
    const sector = String(req.query.sector ?? "").trim();
    const assignedTo = String(req.query.assignedTo ?? "").trim();
    const offset = (page - 1) * limit;
    const isMarketing = req.user?.role === "marketing";
    const marketingScope = resolveMarketingLeadScope(req.user?.role, req.user?.id, assignedTo);

    const searchCondition = search
      ? or(
          ilike(socialLeadsTable.email,     `%${search}%`),
          ilike(socialLeadsTable.firstName, `%${search}%`),
          ilike(socialLeadsTable.lastName,  `%${search}%`),
        )
      : undefined;

    const sectorCondition = sector
      ? ilike(socialLeadsTable.industrySector, `%${sector}%`)
      : undefined;
    const assigneeCondition = isMarketing
      ? marketingScope === "mine"
        ? eq(socialLeadsTable.marketingUserId, req.user!.id)
        : marketingScope === "unassigned"
          ? isNull(socialLeadsTable.marketingUserId)
          : or(
              eq(socialLeadsTable.marketingUserId, req.user!.id),
              isNull(socialLeadsTable.marketingUserId),
            )
      : assignedTo === "unassigned"
        ? isNull(socialLeadsTable.marketingUserId)
        : assignedTo
          ? eq(socialLeadsTable.marketingUserId, assignedTo)
          : undefined;

    let where =
      searchCondition && sectorCondition ? and(searchCondition, sectorCondition)
      : searchCondition ?? sectorCondition;
    if (assigneeCondition) {
      where = where ? and(where, assigneeCondition) : assigneeCondition;
    }
    const now = new Date();
    const recentWhere = where
      ? and(where, gte(socialLeadsTable.createdAt, getRollingWeekStart(now)))
      : gte(socialLeadsTable.createdAt, getRollingWeekStart(now));

    const [[{ total }], leads, statusRows, [recentLeadCount]] = await Promise.all([
      db.select({ total: count() }).from(socialLeadsTable).where(where),
      (isMarketing
        ? db.select(marketingLeadFields)
        : db.select(adminLeadFields))
        .from(socialLeadsTable)
        .leftJoin(usersTable, eq(socialLeadsTable.marketingUserId, usersTable.id))
        .where(where)
        .orderBy(desc(socialLeadsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ status: socialLeadsTable.status, total: count() })
        .from(socialLeadsTable)
        .where(where)
        .groupBy(socialLeadsTable.status),
      db.select({ total: count() }).from(socialLeadsTable).where(recentWhere),
    ]);

    const normalizedLeads = leads
      .filter((lead) => !isMarketing || isMarketingLeadVisible(lead.assigneeId, req.user!.id))
      .map((lead) => {
      const { assigneeId, assigneeEmail, assigneeName, assigneeCalendlyUrl, ...leadFields } = lead;
      return {
        ...leadFields,
        assignee: assigneeId
          ? {
              id: assigneeId,
              email: assigneeEmail,
              name: assigneeName?.trim() || assigneeEmail,
              calendlyUrl: assigneeCalendlyUrl,
            }
          : null,
      };
      });

    res.json({
      leads: normalizedLeads,
      total,
      page,
      limit,
      stats: buildLeadStats(statusRows, recentLeadCount?.total ?? 0),
    });
  },
);

router.get(
  "/leads/my-performance",
  requireRole("marketing"),
  async (req: Request, res: Response): Promise<void> => {
    const [row] = await db
      .select({
        assignedCount: count(socialLeadsTable.id),
        contactedCount: sql<number>`count(*) filter (where ${socialLeadsTable.status} = 'contacted')`,
        registeredCount: sql<number>`count(*) filter (where ${socialLeadsTable.convertedUserId} is not null)`,
        averageResponseTimeMinutes: sql<number | null>`avg(extract(epoch from (${socialLeadsTable.contactedAt} - ${socialLeadsTable.createdAt})) / 60) filter (where ${socialLeadsTable.contactedAt} is not null)`,
      })
      .from(socialLeadsTable)
      .where(eq(socialLeadsTable.marketingUserId, req.user!.id));
    const assignedCount = Number(row?.assignedCount ?? 0);
    const contactedCount = Number(row?.contactedCount ?? 0);
    const registeredCount = Number(row?.registeredCount ?? 0);
    res.json({
      assignedCount,
      contactedCount,
      registeredCount,
      conversionRate: assignedCount > 0 ? Math.round((registeredCount / assignedCount) * 1000) / 10 : 0,
      averageResponseTimeMinutes: row?.averageResponseTimeMinutes == null
        ? null
        : Number(row.averageResponseTimeMinutes),
    });
  },
);

// ---------------------------------------------------------------------------
// GET /api/leads/assignees — marketing users available for lead assignment.
// Admin and super_admin only; marketing sees the resolved assignee on each lead.
// ---------------------------------------------------------------------------

router.get(
  "/leads/assignees",
  requireRole("admin", "super_admin"),
  async (_req: Request, res: Response): Promise<void> => {
    const assignees = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: sql<string>`concat_ws(' ', ${usersTable.firstName}, ${usersTable.lastName})`,
        calendlyUrl: usersTable.calendlyUrl,
      })
      .from(usersTable)
      .where(eq(usersTable.role, "marketing"))
      .orderBy(usersTable.firstName, usersTable.lastName, usersTable.email);

    res.json({
      assignees: assignees.map((assignee) => ({
        ...assignee,
        name: assignee.name?.trim() || assignee.email,
      })),
    });
  },
);

router.post(
  "/leads/:id/claim",
  requireRole("marketing"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid lead ID." });
      return;
    }
    const now = new Date();
    const [claimed] = await db
      .update(socialLeadsTable)
      .set({
        marketingUserId: req.user!.id,
        claimedAt: now,
      })
      .where(and(eq(socialLeadsTable.id, id), isNull(socialLeadsTable.marketingUserId)))
      .returning({
        id: socialLeadsTable.id,
        status: socialLeadsTable.status,
        marketingUserId: socialLeadsTable.marketingUserId,
        claimedAt: socialLeadsTable.claimedAt,
        contactedAt: socialLeadsTable.contactedAt,
      });
    if (!claimed) {
      const [existing] = await db.select({ id: socialLeadsTable.id, marketingUserId: socialLeadsTable.marketingUserId })
        .from(socialLeadsTable).where(eq(socialLeadsTable.id, id)).limit(1);
      res.status(existing ? 409 : 404).json({ error: existing ? "Lead is already claimed." : "Lead not found." });
      return;
    }
    res.json(claimed);
  },
);

router.get(
  "/me/calendly-url",
  requireRole("marketing"),
  async (req: Request, res: Response): Promise<void> => {
    const [user] = await db
      .select({ calendlyUrl: usersTable.calendlyUrl })
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.id));

    res.json({ calendlyUrl: user?.calendlyUrl ?? null });
  },
);

router.patch(
  "/me/calendly-url",
  requireRole("marketing"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = OptionalCalendlyUrlSchema.safeParse(req.body?.calendlyUrl);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid Calendly URL." });
      return;
    }

    const [updated] = await db
      .update(usersTable)
      .set({ calendlyUrl: parsed.data })
      .where(eq(usersTable.id, req.user!.id))
      .returning({ calendlyUrl: usersTable.calendlyUrl });

    if (!updated) {
      res.status(404).json({ error: "Marketing account not found." });
      return;
    }

    res.json({ calendlyUrl: updated.calendlyUrl ?? null });
  },
);

// ---------------------------------------------------------------------------
// GET /api/leads/sectors — distinct sponsor-licence industries for the dropdown
// Public, no auth required. Results are stable enough to cache for 1 hour.
// ---------------------------------------------------------------------------

router.get(
  "/leads/sectors",
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const rows = await db
        .selectDistinct({ industry: sponsorLicencesTable.industry })
        .from(sponsorLicencesTable)
        .where(sql`${sponsorLicencesTable.industry} IS NOT NULL AND ${sponsorLicencesTable.industry} != 'Other'`)
        .orderBy(sponsorLicencesTable.industry);

      const sectors = rows
        .map((r) => r.industry)
        .filter((v): v is string => typeof v === "string" && v.trim() !== "");

      // Always append "Other" as the last option
      sectors.push("Other");

      res.setHeader("Cache-Control", "public, max-age=3600");
      res.json({ sectors });
    } catch (err) {
      console.error("[leads] GET /leads/sectors error:", err);
      res.status(500).json({ error: "Could not load sector list." });
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/leads/:id/assignee — assign or unassign a marketing owner.
// ---------------------------------------------------------------------------

const AssignLeadSchema = z.object({
  marketingUserId: z.string().trim().min(1).nullable(),
});

router.patch(
  "/leads/:id/assignee",
  requireRole("admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid lead ID." });
      return;
    }

    const parsed = AssignLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "marketingUserId must be a marketing user ID or null." });
      return;
    }

    const marketingUserId = parsed.data.marketingUserId;
    let assignee: { id: string; email: string | null; name: string | null; calendlyUrl?: string | null } | null = null;

    if (marketingUserId !== null) {
      const [marketingUser] = await db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          name: sql<string>`concat_ws(' ', ${usersTable.firstName}, ${usersTable.lastName})`,
          calendlyUrl: usersTable.calendlyUrl,
        })
        .from(usersTable)
        .where(and(eq(usersTable.id, marketingUserId), eq(usersTable.role, "marketing")))
        .limit(1);

      if (!marketingUser) {
        res.status(400).json({ error: "The selected assignee is not a marketing user." });
        return;
      }

      assignee = {
        ...marketingUser,
        name: marketingUser.name?.trim() || marketingUser.email,
      };
    }

    const [updated] = await db
      .update(socialLeadsTable)
      .set({ marketingUserId })
      .where(eq(socialLeadsTable.id, id))
      .returning({ id: socialLeadsTable.id, marketingUserId: socialLeadsTable.marketingUserId });

    if (!updated) {
      res.status(404).json({ error: "Lead not found." });
      return;
    }

    res.json({ id: updated.id, marketingUserId: updated.marketingUserId, assignee });
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/leads/bulk-assignee — assign or unassign one marketing owner
// across multiple leads.
// ---------------------------------------------------------------------------

const BulkAssignLeadSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, "ids must be a non-empty array."),
  marketingUserId: z.string().trim().min(1).nullable(),
});

router.patch(
  "/leads/bulk-assignee",
  requireRole("admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = BulkAssignLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? "Invalid bulk assignment request.",
      });
      return;
    }

    const { ids, marketingUserId } = parsed.data;
    let assignee: { id: string; email: string | null; name: string | null; calendlyUrl?: string | null } | null = null;

    if (marketingUserId !== null) {
      const [marketingUser] = await db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          name: sql<string>`concat_ws(' ', ${usersTable.firstName}, ${usersTable.lastName})`,
          calendlyUrl: usersTable.calendlyUrl,
        })
        .from(usersTable)
        .where(and(eq(usersTable.id, marketingUserId), eq(usersTable.role, "marketing")))
        .limit(1);

      if (!marketingUser) {
        res.status(400).json({ error: "The selected assignee is not a marketing user." });
        return;
      }

      assignee = {
        ...marketingUser,
        name: marketingUser.name?.trim() || marketingUser.email,
      };
    }

    const { inArray } = await import("drizzle-orm");
    const updated = await db
      .update(socialLeadsTable)
      .set({ marketingUserId })
      .where(inArray(socialLeadsTable.id, ids))
      .returning({ id: socialLeadsTable.id });

    res.json({
      updated: updated.length,
      marketingUserId,
      assignee,
    });
  },
);

// ---------------------------------------------------------------------------
// POST /api/leads/submit — public, no auth required
// ---------------------------------------------------------------------------

router.post(
  "/leads/submit",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = SubmitLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? "Invalid submission",
      });
      return;
    }

    try {
      const d = parsed.data;
      const normalizedEmail = d.email.toLowerCase();

      // Hash the client IP for dedup/geo without storing PII.
      // Same approach as consent_logs.ip_hash.
      const rawIp =
        (req.headers["x-forwarded-for"] as string | undefined)
          ?.split(",")[0]
          ?.trim() ??
        req.socket.remoteAddress ??
        "";
      const ipHash = crypto.createHash("sha256").update(rawIp).digest("hex");

      const now = new Date();

      // If a partial chat lead already exists for this email, upgrade it to a
      // full form submission rather than creating a duplicate record.
      const [existingChatLead] = await db
        .select({ id: socialLeadsTable.id })
        .from(socialLeadsTable)
        .where(
          and(
            eq(socialLeadsTable.email, d.email.toLowerCase()),
            eq(socialLeadsTable.source, "chat"),
          ),
        )
        .limit(1);

      let leadId: number;
      if (existingChatLead) {
        const [updatedLead] = await db
          .update(socialLeadsTable)
          .set({
            firstName: d.firstName,
            lastName: d.lastName,
            phone: d.phone,
            industrySector: d.industrySector ?? null,
            desiredRole: d.desiredRole ?? null,
            additionalMessage: d.additionalMessage ?? null,
            utmSource: d.utmSource ?? null,
            utmMedium: d.utmMedium ?? null,
            utmCampaign: d.utmCampaign ?? null,
            utmContent: d.utmContent ?? null,
            landingPath: d.landingPath ?? null,
            referrerUrl: d.referrerUrl ?? null,
            ipHash,
            gdprConsent: d.gdprConsent,
            gdprConsentedAt: now,
            source: "form",
            status: "new",
          })
          .where(eq(socialLeadsTable.id, existingChatLead.id))
          .returning({ id: socialLeadsTable.id });
        if (!updatedLead) {
          throw new Error("Failed to upgrade the existing chat lead.");
        }
        leadId = updatedLead.id;
      } else {
        const [createdLead] = await db.insert(socialLeadsTable).values({
          firstName: d.firstName,
          lastName: d.lastName,
          email: normalizedEmail,
          phone: d.phone,

          industrySector: d.industrySector ?? null,
          desiredRole: d.desiredRole ?? null,
          additionalMessage: d.additionalMessage ?? null,

          utmSource: d.utmSource ?? null,
          utmMedium: d.utmMedium ?? null,
          utmCampaign: d.utmCampaign ?? null,
          utmContent: d.utmContent ?? null,
          landingPath: d.landingPath ?? null,
          referrerUrl: d.referrerUrl ?? null,

          ipHash,
          gdprConsent: d.gdprConsent,
          gdprConsentedAt: now,

          source: "form",
          status: "new",
        }).returning({ id: socialLeadsTable.id });
        if (!createdLead) {
          throw new Error("Failed to create the lead.");
        }
        leadId = createdLead.id;
      }

      res.status(201).json({ success: true });

      void (async () => {
        try {
          const result = await sendWaitlistWelcomeEmail({
            to: normalizedEmail,
            firstName: d.firstName,
            industrySector: d.industrySector,
            desiredRole: d.desiredRole,
          });

          await db
            .update(socialLeadsTable)
            .set(
              result.success
                ? {
                    waitlistConfirmationSentAt: new Date(),
                    waitlistConfirmationProviderId: result.messageId ?? null,
                    waitlistConfirmationLastError: null,
                  }
                : {
                    waitlistConfirmationLastError: result.error ?? "Failed to send",
                  },
            )
            .where(eq(socialLeadsTable.id, leadId));
        } catch (error: unknown) {
          const message = error instanceof Error
            ? error.message
            : "Background waitlist email dispatch failed.";
          console.error("[leads] Background waitlist email dispatch failed:", error);
          try {
            await db
              .update(socialLeadsTable)
              .set({ waitlistConfirmationLastError: message })
              .where(eq(socialLeadsTable.id, leadId));
          } catch (updateError) {
            console.error("[leads] Failed to record waitlist email error:", updateError);
          }
        }
      })();
    } catch (err) {
      console.error("[leads] POST /leads/submit error:", err);
      res.status(500).json({ error: "Failed to submit your details. Please try again." });
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/leads — bulk delete leads by ID (admin only)
// ---------------------------------------------------------------------------

router.delete(
  "/leads",
  requireRole("admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const { ids } = req.body as { ids?: unknown };

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids must be a non-empty array." });
      return;
    }

    const parsed = [...new Set(ids.map(Number).filter((n) => !isNaN(n) && n > 0))];
    if (parsed.length === 0) {
      res.status(400).json({ error: "No valid IDs provided." });
      return;
    }

    const { inArray } = await import("drizzle-orm");
    const deleted = await db
      .delete(socialLeadsTable)
      .where(inArray(socialLeadsTable.id, parsed))
      .returning({ id: socialLeadsTable.id });

    res.json({ deleted: deleted.length });
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/leads/bulk-status — set the same status on multiple leads.
// ---------------------------------------------------------------------------

router.patch(
  "/leads/bulk-status",
  requireRole("admin", "super_admin", "marketing"),
  async (req: Request, res: Response): Promise<void> => {
    const { ids, status } = req.body as { ids?: unknown; status?: string };

    const VALID = ["new", "contacted", "registered", "unqualified"] as const;
    if (!status || !VALID.includes(status as (typeof VALID)[number])) {
      res.status(400).json({ error: `status must be one of: ${VALID.join(", ")}` });
      return;
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids must be a non-empty array." });
      return;
    }

    const parsed = [...new Set(ids.map(Number).filter((n) => !isNaN(n) && n > 0))];
    if (parsed.length === 0) {
      res.status(400).json({ error: "No valid IDs provided." });
      return;
    }

    const { inArray } = await import("drizzle-orm");
    if (req.user?.role === "marketing") {
      const result = await db.transaction(async (tx) => {
        const existingLeads = await tx
          .select({
            id: socialLeadsTable.id,
            marketingUserId: socialLeadsTable.marketingUserId,
          })
          .from(socialLeadsTable)
          .where(inArray(socialLeadsTable.id, parsed))
          .for("update");
        if (existingLeads.length !== parsed.length) return "missing" as const;
        if (existingLeads.some((lead) => lead.marketingUserId !== req.user!.id)) return "forbidden" as const;
        await tx
          .update(socialLeadsTable)
          .set({
            status: status as (typeof VALID)[number],
            contactedAt: status === "contacted"
              ? sql`coalesce(${socialLeadsTable.contactedAt}, now())`
              : socialLeadsTable.contactedAt,
          })
          .where(inArray(socialLeadsTable.id, parsed));
        return "updated" as const;
      });
      if (result === "missing") {
        res.status(404).json({ error: "One or more leads were not found." });
        return;
      }
      if (result === "forbidden") {
        res.status(403).json({ error: "You can only update leads assigned to you." });
        return;
      }
      res.json({ updated: parsed.length });
      return;
    }

    const updated = await db
      .update(socialLeadsTable)
      .set({
        status: status as (typeof VALID)[number],
        contactedAt: status === "contacted"
          ? sql`coalesce(${socialLeadsTable.contactedAt}, now())`
          : socialLeadsTable.contactedAt,
      })
      .where(inArray(socialLeadsTable.id, parsed))
      .returning({ id: socialLeadsTable.id });

    res.json({ updated: updated.length });
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/leads/:id/status — manually update a lead's CRM status.
// ---------------------------------------------------------------------------

router.patch(
  "/leads/:id/status",
  requireRole("admin", "super_admin", "marketing"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid lead ID." });
      return;
    }

    const { status } = req.body as { status?: string };
    const VALID = ["new", "contacted", "registered", "unqualified"] as const;
    if (!status || !VALID.includes(status as (typeof VALID)[number])) {
      res.status(400).json({ error: `status must be one of: ${VALID.join(", ")}` });
      return;
    }

    let statusWhere = eq(socialLeadsTable.id, id);
    if (req.user?.role === "marketing") {
      statusWhere = and(
        statusWhere,
        or(
          eq(socialLeadsTable.marketingUserId, req.user.id),
        ),
      )!;
    }

    const [updated] = await db
      .update(socialLeadsTable)
      .set({
        status: status as (typeof VALID)[number],
        contactedAt: status === "contacted"
          ? sql`coalesce(${socialLeadsTable.contactedAt}, now())`
          : socialLeadsTable.contactedAt,
      })
      .where(statusWhere)
      .returning({ id: socialLeadsTable.id, status: socialLeadsTable.status });

    if (!updated) {
      if (req.user?.role === "marketing") {
        const [existingLead] = await db
          .select({ marketingUserId: socialLeadsTable.marketingUserId })
          .from(socialLeadsTable)
          .where(eq(socialLeadsTable.id, id))
          .limit(1);

        if (existingLead && existingLead.marketingUserId !== req.user.id) {
          res.status(403).json({ error: "You can only update leads assigned to you." });
          return;
        }
      }

      res.status(404).json({ error: "Lead not found." });
      return;
    }

    res.json({ id: updated.id, status: updated.status });
  },
);

// ---------------------------------------------------------------------------
// POST /api/leads/chat — public SSE streaming chat for /get-started
// Uses gpt-4o-mini. No auth required (pre-registration lead capture).
// ---------------------------------------------------------------------------

const LEAD_CHAT_SYSTEM_PROMPT = `You are SAGE, a friendly advisor on the JOBSAGE platform. JOBSAGE helps professionals from around the world find jobs and UK relocation pathways across all industries.

Your primary goal is to collect the user's first name, last name, email address, and phone number. You can also ask what sector they work in. That is it.

STRICT FORMATTING RULES — follow these without exception:
No markdown of any kind. No bullet points, no bold text, no asterisks, no numbered lists, no headers. Plain sentences only.
UNDER NO CIRCUMSTANCES are you allowed to use dashes (-) or em-dashes (—) in your responses. Use commas for pauses. Write in a continuous, flowing conversational text.
Write exactly like a real person texting on WhatsApp. Short sentences. Casual and warm. Natural transitions between topics.
Never ask for all information at once. Gather it one or two pieces at a time through natural conversation.
Never use a list to present options or steps. Just talk.

How to run the conversation:
Start by asking for their first name. Once you have it use it naturally.
After their name, ask for their last name.
Then get their email. Then their phone number.
You can weave in a casual question about their sector somewhere along the way if it feels natural.
Keep each message to one or two short sentences max.
Be warm and encouraging. Sound human not robotic.

If the user asks about UK jobs, sponsorship, or visas give a brief honest answer in plain conversational language then gently steer back to collecting their details.
Never give legal or immigration advice. If they need specifics suggest they speak to an immigration advisor.`;


router.post(
  "/leads/chat",
  async (req: Request, res: Response): Promise<void> => {
    const { message, history } = req.body as {
      message?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    };

    if (!message?.trim()) {
      res.status(400).json({ error: "message is required." });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      const chatHistory = (history ?? []).slice(-12); // keep last 12 turns for context

      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: LEAD_CHAT_SYSTEM_PROMPT },
        ...chatHistory.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: message.trim() },
      ];

      // Stream the conversational response
      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_completion_tokens: 300,
        stream: true,
        messages,
      });

      let fullContent = "";
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content ?? "";
        if (text) {
          fullContent += text;
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      }

      // After streaming, extract structured qualifying data from the full conversation.
      // Only run the extraction once we have at least 2 user turns (enough signal).
      const userTurns = chatHistory.filter((m) => m.role === "user").length + 1;
      let extracted: Record<string, string | null> = {};

      if (userTurns >= 2) {
        try {
          const fullConversation = [
            ...chatHistory,
            { role: "user", content: message.trim() },
            { role: "assistant", content: fullContent },
          ]
            .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
            .join("\n");

          const extractResp = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            max_completion_tokens: 150,
            messages: [
              {
                role: "system",
                content: `Extract contact and qualifying data from this conversation. Return ONLY valid JSON. Only include fields the user has clearly stated — omit fields that are uncertain or not mentioned. Use null for omitted fields.

{
  "name": "<user's full name or null>",
  "email": "<user's email address or null>",
  "phone": "<user's phone number or null>",
  "industrySector": "<sector or industry they work in or are interested in, or null>",
  "desiredRole": "<specific role or job title they are targeting or null>"
}`,
              },
              { role: "user", content: fullConversation },
            ],
            response_format: { type: "json_object" },
          });

          const raw = extractResp.choices[0]?.message?.content ?? "{}";
          const parsed = JSON.parse(raw) as Record<string, string | null>;
          // Only keep fields with non-null values
          extracted = Object.fromEntries(
            Object.entries(parsed).filter(([, v]) => v !== null && v !== ""),
          );
        } catch {
          // extraction failure is non-critical — continue without it
        }
      }

      // Save ALL information the AI has collected so far.
      // The chat is a full alternative to the form — every extracted field is logged.
      // We upsert by email: create on first contact, then update progressively
      // as more details come in across turns.
      let waitlistConfirmationQueued = false;
      if (extracted.name && extracted.email) {
        try {
          const nameParts = String(extracted.name).trim().split(/\s+/);
          const firstName = nameParts[0] ?? "";
          const lastName = nameParts.slice(1).join(" ") || "";
          const email = String(extracted.email).toLowerCase();
          const phone = extracted.phone ? String(extracted.phone) : null;
          const industrySector = extracted.industrySector ? String(extracted.industrySector) : null;
          const desiredRole = extracted.desiredRole ? String(extracted.desiredRole) : null;
          const now = new Date();

          // Check for an existing chat lead for this email
          const [existing] = await db
            .select({
              id: socialLeadsTable.id,
              source: socialLeadsTable.source,
              waitlistConfirmationSentAt: socialLeadsTable.waitlistConfirmationSentAt,
            })
            .from(socialLeadsTable)
            .where(eq(socialLeadsTable.email, email))
            .limit(1);

          let chatLeadId: number | null = null;
          let shouldSendWaitlistConfirmation = false;

          if (!existing) {
            // First time we've seen this email — create the record
            const [created] = await db
              .insert(socialLeadsTable)
              .values({
                firstName,
                lastName,
                email,
                phone,
                industrySector,
                desiredRole,
                gdprConsent: false,
                gdprConsentedAt: now,
                source: "chat",
                status: "new",
              })
              .returning({ id: socialLeadsTable.id });
            chatLeadId = created?.id ?? null;
            shouldSendWaitlistConfirmation = !!phone;
          } else if (existing.source === "chat") {
            // Update the chat record as more info is collected
            await db
              .update(socialLeadsTable)
              .set({
                firstName,
                lastName,
                ...(phone          ? { phone }          : {}),
                ...(industrySector ? { industrySector } : {}),
                ...(desiredRole    ? { desiredRole }    : {}),
              })
              .where(eq(socialLeadsTable.id, existing.id));
            chatLeadId = existing.id;
            shouldSendWaitlistConfirmation = !!phone && !existing.waitlistConfirmationSentAt;
          }
          // If existing.source === "form", the user already submitted fully — leave it alone.

          if (chatLeadId && shouldSendWaitlistConfirmation) {
            waitlistConfirmationQueued = true;
            void (async () => {
              try {
                const result = await sendWaitlistWelcomeEmail({
                  to: email,
                  firstName,
                  industrySector,
                  desiredRole,
                });

                await db
                  .update(socialLeadsTable)
                  .set(
                    result.success
                      ? {
                          waitlistConfirmationSentAt: new Date(),
                          waitlistConfirmationProviderId: result.messageId ?? null,
                          waitlistConfirmationLastError: null,
                        }
                      : {
                          waitlistConfirmationLastError:
                            result.error ?? "Failed to send",
                        },
                  )
                  .where(eq(socialLeadsTable.id, chatLeadId));
              } catch (sendError: unknown) {
                const errorMessage =
                  sendError instanceof Error
                    ? sendError.message
                    : "Background waitlist email dispatch failed.";
                console.error(
                  "[leads/chat] Background waitlist email dispatch failed:",
                  sendError,
                );
                try {
                  await db
                    .update(socialLeadsTable)
                    .set({ waitlistConfirmationLastError: errorMessage })
                    .where(eq(socialLeadsTable.id, chatLeadId));
                } catch (updateError) {
                  console.error(
                    "[leads/chat] Failed to record waitlist email error:",
                    updateError,
                  );
                }
              }
            })();
          }
        } catch (saveErr) {
          // Non-critical — never let a DB error break the chat stream
          console.error("[leads/chat] lead save error:", saveErr);
        }
      }

      res.write(
        `data: ${JSON.stringify({
          done: true,
          extracted,
          waitlistConfirmationQueued,
        })}\n\n`,
      );
      res.end();
    } catch (err) {
      console.error("[leads/chat] SSE error:", err);
      res.write(`data: ${JSON.stringify({ error: "AI service unavailable. Please try again." })}\n\n`);
      res.end();
    }
  },
);

export default router;
