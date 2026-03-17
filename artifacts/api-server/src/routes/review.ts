import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  reviewCasesTable,
  reviewAnnotationsTable,
  decisionRecordsTable,
  profilesTable,
} from "@workspace/db";
import { eq, desc, count, and } from "drizzle-orm";
import { requireAdmin } from "./rulesets";

const router: IRouter = Router();

export function requireReviewer(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  if (req.user.role !== "admin" && req.user.role !== "reviewer") {
    res.status(401).json({ error: "Reviewer or admin access required." });
    return;
  }
  next();
}

router.get("/admin/review-queue", requireReviewer, async (req, res): Promise<void> => {
  const { status } = req.query as { status?: string };

  const conditions = [];
  if (status === "pending" || status === "reviewed") {
    conditions.push(eq(reviewCasesTable.status, status));
  }

  const cases =
    conditions.length > 0
      ? await db
          .select()
          .from(reviewCasesTable)
          .where(conditions[0])
          .orderBy(desc(reviewCasesTable.createdAt))
      : await db
          .select()
          .from(reviewCasesTable)
          .orderBy(desc(reviewCasesTable.createdAt));

  res.json({
    cases: cases.map((c) => ({
      id: c.id,
      userId: c.userId,
      decisionRecordId: c.decisionRecordId,
      flagReason: c.flagReason,
      status: c.status,
      reviewedBy: c.reviewedBy ?? null,
      reviewedAt: c.reviewedAt ?? null,
      createdAt: c.createdAt,
    })),
    total: cases.length,
  });
});

router.get("/admin/review-queue/:caseId", requireReviewer, async (req, res): Promise<void> => {
  const caseId = parseInt(req.params.caseId as string, 10);
  if (isNaN(caseId)) {
    res.status(400).json({ error: "Invalid caseId." });
    return;
  }

  const [reviewCase] = await db
    .select()
    .from(reviewCasesTable)
    .where(eq(reviewCasesTable.id, caseId))
    .limit(1);

  if (!reviewCase) {
    res.status(404).json({ error: "Review case not found." });
    return;
  }

  const [decision] = await db
    .select()
    .from(decisionRecordsTable)
    .where(eq(decisionRecordsTable.id, reviewCase.decisionRecordId))
    .limit(1);

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, reviewCase.userId))
    .limit(1);

  const annotations = await db
    .select()
    .from(reviewAnnotationsTable)
    .where(eq(reviewAnnotationsTable.caseId, caseId))
    .orderBy(reviewAnnotationsTable.createdAt);

  res.json({
    case: {
      id: reviewCase.id,
      userId: reviewCase.userId,
      decisionRecordId: reviewCase.decisionRecordId,
      flagReason: reviewCase.flagReason,
      status: reviewCase.status,
      reviewedBy: reviewCase.reviewedBy ?? null,
      reviewedAt: reviewCase.reviewedAt ?? null,
      createdAt: reviewCase.createdAt,
    },
    decision: decision ?? null,
    profile: profile ?? null,
    annotations: annotations.map((a) => ({
      id: a.id,
      caseId: a.caseId,
      reviewerId: a.reviewerId,
      notes: a.notes,
      recommendedPathway: a.recommendedPathway ?? null,
      createdAt: a.createdAt,
    })),
  });
});

router.post("/admin/review-queue/:caseId/annotate", requireReviewer, async (req, res): Promise<void> => {
  const caseId = parseInt(req.params.caseId as string, 10);
  if (isNaN(caseId)) {
    res.status(400).json({ error: "Invalid caseId." });
    return;
  }

  const { notes, recommendedPathway } = req.body as {
    notes?: string;
    recommendedPathway?: string;
  };

  if (!notes || notes.trim().length === 0) {
    res.status(400).json({ error: "notes is required." });
    return;
  }

  const [reviewCase] = await db
    .select()
    .from(reviewCasesTable)
    .where(eq(reviewCasesTable.id, caseId))
    .limit(1);

  if (!reviewCase) {
    res.status(404).json({ error: "Review case not found." });
    return;
  }

  const reviewerId = req.user!.id;

  const [annotation] = await db
    .insert(reviewAnnotationsTable)
    .values({
      caseId,
      reviewerId,
      notes: notes.trim(),
      recommendedPathway: recommendedPathway?.trim() ?? null,
    })
    .returning();

  await db
    .update(reviewCasesTable)
    .set({ status: "reviewed", reviewedBy: reviewerId, reviewedAt: new Date() })
    .where(eq(reviewCasesTable.id, caseId));

  res.json({
    id: annotation.id,
    caseId: annotation.caseId,
    reviewerId: annotation.reviewerId,
    notes: annotation.notes,
    recommendedPathway: annotation.recommendedPathway ?? null,
    createdAt: annotation.createdAt,
  });
});

export default router;
