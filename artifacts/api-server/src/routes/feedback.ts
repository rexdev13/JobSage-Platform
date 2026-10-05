import { Router, type IRouter, type Request, type Response } from "express";
import {
  ListAdminFeedbackQueryParams,
  ListAdminFeedbackResponse,
  ReplyToAdminFeedbackBody,
  ReplyToAdminFeedbackParams,
  ReplyToAdminFeedbackResponse,
  SubmitFeedbackBody,
  UpdateAdminFeedbackBody,
  UpdateAdminFeedbackParams,
  UpdateAdminFeedbackResponse,
} from "@workspace/api-zod";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { candidateMessagesTable, db, feedbackRepliesTable, feedbackTable } from "@workspace/db";
import { z } from "zod/v4";
import { requireRole } from "../middlewares/requireRole";
import { writeAuditEvent } from "../lib/audit";
import { sendProductFeedbackReply } from "../lib/email";

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
    const replies = items.length
      ? await db
          .select()
          .from(feedbackRepliesTable)
          .where(inArray(feedbackRepliesTable.feedbackId, items.map((item) => item.id)))
          .orderBy(asc(feedbackRepliesTable.createdAt), asc(feedbackRepliesTable.id))
      : [];
    const repliesByFeedbackId = new Map<number, typeof replies>();
    for (const reply of replies) {
      const current = repliesByFeedbackId.get(reply.feedbackId) ?? [];
      current.push(reply);
      repliesByFeedbackId.set(reply.feedbackId, current);
    }

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

    res.json(ListAdminFeedbackResponse.parse({
      items: items.map((item) => ({ ...item, replies: repliesByFeedbackId.get(item.id) ?? [] })),
      summary,
    }));
  },
);

router.post(
  "/admin/super/feedback/:id/replies",
  requireRole("admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ReplyToAdminFeedbackParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const rawExpectedUpdatedAt = req.body?.expectedUpdatedAt;
    const expectedUpdatedAt =
      typeof rawExpectedUpdatedAt === "string" && Number.isFinite(Date.parse(rawExpectedUpdatedAt))
        ? new Date(rawExpectedUpdatedAt)
        : rawExpectedUpdatedAt;
    const body = ReplyToAdminFeedbackBody.safeParse({ ...req.body, expectedUpdatedAt });
    if (!body.success || !body.data.replyText.trim()) {
      res.status(400).json({
        error: body.success ? "Reply text cannot be blank." : body.error.message,
      });
      return;
    }

    const admin = req.user!;
    const adminDisplayName =
      [admin.firstName, admin.lastName].filter(Boolean).join(" ").trim() ||
      admin.email ||
      admin.id;

    const result = await db.transaction(async (tx) => {
      const [feedback] = await tx
        .select()
        .from(feedbackTable)
        .where(eq(feedbackTable.id, params.data.id))
        .for("update");

      if (!feedback) return { kind: "not_found" as const };
      if (feedback.updatedAt.getTime() !== body.data.expectedUpdatedAt.getTime()) {
        return { kind: "conflict" as const };
      }

      const replyText = body.data.replyText.trim();
      let deliveryChannel: "inbox" | "email";
      let deliveryStatus: "sent" | "failed" = "sent";
      let deliveryError: string | undefined;
      let candidateMessageId: number | null = null;

      if (feedback.userId) {
        deliveryChannel = "inbox";
        const [candidateMessage] = await tx
          .insert(candidateMessagesTable)
          .values({
            recipientUserId: feedback.userId,
            companyName: "JOBSAGE Support",
            messageType: "support",
            messageText: replyText,
            subject: "Reply to your JOBSAGE feedback",
          })
          .returning({ id: candidateMessagesTable.id });
        candidateMessageId = candidateMessage.id;
      } else {
        const recipient = z.string().email().safeParse(feedback.email);
        if (!recipient.success) return { kind: "no_contact" as const };

        deliveryChannel = "email";
        const delivery = await sendProductFeedbackReply({
          to: recipient.data,
          feedbackId: feedback.id,
          replyText,
        });
        if (!delivery.success) {
          deliveryStatus = "failed";
          deliveryError = delivery.error;
        }
      }

      const [reply] = await tx
        .insert(feedbackRepliesTable)
        .values({
          feedbackId: feedback.id,
          adminUserId: admin.id,
          adminDisplayName,
          replyText,
          deliveryChannel,
          deliveryStatus,
          candidateMessageId,
        })
        .returning();

      await tx
        .update(feedbackTable)
        .set({ reviewedBy: admin.id, reviewedAt: new Date() })
        .where(eq(feedbackTable.id, feedback.id));

      if (deliveryStatus === "failed") {
        return { kind: "delivery_failed" as const, error: deliveryError, reply };
      }
      return { kind: "success" as const, reply };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: "Feedback entry not found." });
      return;
    }
    if (result.kind === "conflict") {
      res.status(409).json({ error: "This feedback entry changed after it was loaded. Refresh before replying." });
      return;
    }
    if (result.kind === "no_contact") {
      res.status(422).json({ error: "This feedback entry has no valid email address or signed-in account for delivery." });
      return;
    }
    if (result.kind === "delivery_failed") {
      req.log.error(
        { feedbackId: params.data.id, error: result.error },
        "Product feedback reply email could not be delivered",
      );
      res.status(502).json({ error: "Email delivery failed. The reply attempt was recorded but not delivered." });
      return;
    }

    writeAuditEvent(admin.id, "admin_reply_product_feedback", String(params.data.id), {
      deliveryChannel: result.reply.deliveryChannel,
      deliveryStatus: result.reply.deliveryStatus,
    }).catch(() => {});

    res.json(ReplyToAdminFeedbackResponse.parse(result.reply));
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