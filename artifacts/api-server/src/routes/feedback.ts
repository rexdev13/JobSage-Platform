import { Router, type IRouter, type Request, type Response } from "express";
import {
  ListAdminFeedbackQueryParams,
  ListAdminFeedbackResponse,
  SubmitFeedbackBody,
  UpdateAdminFeedbackBody,
  UpdateAdminFeedbackParams,
  UpdateAdminFeedbackResponse,
} from "@workspace/api-zod";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { db, feedbackTable } from "@workspace/db";
import { z } from "zod/v4";
import { requireRole } from "../middlewares/requireRole";
import { writeAuditEvent } from "../lib/audit";

const router: IRouter = Router();
const FeedbackSubmissionResultSchema = z.object({
  success: z.boolean(),
  id: z.number().int().positive(),
});

router.post(
  "/feedback",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = SubmitFeedbackBody.safeParse(req.body);
    if (!parsed.success || !parsed.data.message.trim()) {
      res.status(400).json({ error: parsed.success ? "Message cannot be blank." : parsed.error.message });
      return;
    }

    let pageUrl: URL;
    try {
      pageUrl = new URL(parsed.data.pageUrl);
      if (!["http:", "https:"].includes(pageUrl.protocol)) throw new Error("Unsupported URL protocol");
      pageUrl.username = "";
      pageUrl.password = "";
      pageUrl.search = "";
      pageUrl.hash = "";
    } catch {
      res.status(400).json({ error: "Page URL must be an HTTP or HTTPS address." });
      return;
    }

    const [feedback] = await db
      .insert(feedbackTable)
      .values({
        category: parsed.data.category,
        message: parsed.data.message.trim(),
        email: req.user?.email ?? parsed.data.email ?? null,
        pageUrl: `${pageUrl.origin}${pageUrl.pathname}`,
        screenResolution: parsed.data.screenResolution,
        userId: req.user?.id ?? null,
        userAgent: req.get("user-agent") ?? null,
      })
      .returning({ id: feedbackTable.id });

    res.status(201).json(FeedbackSubmissionResultSchema.parse({ success: true, id: feedback.id }));
  },
);

router.get(
  "/admin/super/feedback",
  requireRole("admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const query = ListAdminFeedbackQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }

    const filter = and(
      query.data.category ? eq(feedbackTable.category, query.data.category) : undefined,
      query.data.status === "unresolved"
        ? inArray(feedbackTable.status, ["new", "in_review"])
        : query.data.status
          ? eq(feedbackTable.status, query.data.status)
          : undefined,
    );

    const [counts, items] = await Promise.all([
      db
        .select({ category: feedbackTable.category, status: feedbackTable.status, total: count() })
        .from(feedbackTable)
        .groupBy(feedbackTable.category, feedbackTable.status),
      db
        .select()
        .from(feedbackTable)
        .where(filter)
        .orderBy(desc(feedbackTable.createdAt))
        .limit(query.data.limit)
        .offset(query.data.offset),
    ]);

    const summary = {
      total: 0,
      issues: 0,
      ideas: 0,
      general: 0,
      unresolved: 0,
    };
    for (const row of counts) {
      const total = Number(row.total);
      summary.total += total;
      if (row.category === "issue") summary.issues += total;
      if (row.category === "idea") summary.ideas += total;
      if (row.category === "general") summary.general += total;
      if (row.status !== "resolved") summary.unresolved += total;
    }

    res.json(ListAdminFeedbackResponse.parse({ items, summary }));
  },
);

router.patch(
  "/admin/super/feedback/:id",
  requireRole("admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = UpdateAdminFeedbackParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = UpdateAdminFeedbackBody.safeParse(req.body);
    if (
      !body.success ||
      Object.keys(body.data).length === 0
    ) {
      res.status(400).json({ error: body.success ? "Provide a status or admin note to update." : body.error.message });
      return;
    }

    const [feedback] = await db
      .update(feedbackTable)
      .set({
        ...body.data,
        reviewedBy: req.user!.id,
        reviewedAt: new Date(),
      })
      .where(eq(feedbackTable.id, params.data.id))
      .returning();

    if (!feedback) {
      res.status(404).json({ error: "Feedback entry not found." });
      return;
    }

    writeAuditEvent(req.user!.id, "admin_update_feedback", String(feedback.id), {
      status: feedback.status,
    }).catch(() => {});

    res.json(UpdateAdminFeedbackResponse.parse(feedback));
  },
);

export default router;