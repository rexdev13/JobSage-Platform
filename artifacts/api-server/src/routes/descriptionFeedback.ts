import { Router, type IRouter, type Request, type Response } from "express";
import {
  ListAdminDescriptionFeedbackQueryParams,
  ListAdminDescriptionFeedbackResponse,
  SubmitDescriptionFeedbackBody,
  SubmitDescriptionFeedbackResponse,
} from "@workspace/api-zod";
import { and, count, desc, eq } from "drizzle-orm";
import {
  db,
  employerDescriptionFeedbackTable,
  employerProfilesTable,
  usersTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/requireRole";

const router: IRouter = Router();

router.post(
  "/employer/jobs/description-feedback",
  requireRole("employer", "admin"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = SubmitDescriptionFeedbackBody.safeParse(req.body);
    if (!parsed.success || !parsed.data.jobTitle.trim()) {
      res.status(400).json({ error: parsed.success ? "Job title cannot be blank." : parsed.error.message });
      return;
    }

    await db.insert(employerDescriptionFeedbackTable).values({
      employerUserId: req.user!.id,
      sentiment: parsed.data.sentiment,
      jobTitle: parsed.data.jobTitle.trim(),
      specialty: parsed.data.specialty?.trim() || null,
    });

    res.json(SubmitDescriptionFeedbackResponse.parse({ ok: true }));
  },
);

router.get(
  "/admin/super/description-feedback",
  requireRole("admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const query = ListAdminDescriptionFeedbackQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }

    const filter = and(
      query.data.sentiment
        ? eq(employerDescriptionFeedbackTable.sentiment, query.data.sentiment)
        : undefined,
    );

    const [counts, items] = await Promise.all([
      db
        .select({
          sentiment: employerDescriptionFeedbackTable.sentiment,
          total: count(),
        })
        .from(employerDescriptionFeedbackTable)
        .groupBy(employerDescriptionFeedbackTable.sentiment),
      db
        .select({
          id: employerDescriptionFeedbackTable.id,
          sentiment: employerDescriptionFeedbackTable.sentiment,
          jobTitle: employerDescriptionFeedbackTable.jobTitle,
          specialty: employerDescriptionFeedbackTable.specialty,
          employerUserId: employerDescriptionFeedbackTable.employerUserId,
          email: usersTable.email,
          companyName: employerProfilesTable.companyName,
          createdAt: employerDescriptionFeedbackTable.createdAt,
        })
        .from(employerDescriptionFeedbackTable)
        .leftJoin(usersTable, eq(employerDescriptionFeedbackTable.employerUserId, usersTable.id))
        .leftJoin(employerProfilesTable, eq(employerDescriptionFeedbackTable.employerUserId, employerProfilesTable.userId))
        .where(filter)
        .orderBy(desc(employerDescriptionFeedbackTable.createdAt))
        .limit(query.data.limit)
        .offset(query.data.offset),
    ]);

    const summary = { total: 0, up: 0, down: 0 };
    for (const row of counts) {
      const total = Number(row.total);
      summary.total += total;
      summary[row.sentiment] += total;
    }

    res.json(ListAdminDescriptionFeedbackResponse.parse({ items, summary }));
  },
);

export default router;