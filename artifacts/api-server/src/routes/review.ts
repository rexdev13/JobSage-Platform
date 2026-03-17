import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  reviewCasesTable,
  reviewAnnotationsTable,
  decisionRecordsTable,
  profilesTable,
  auditEventsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";

const router: IRouter = Router();

async function writeAuditEvent(
  actor: string,
  action: string,
  target?: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await db.insert(auditEventsTable).values({ actor, action, target, details: details ?? {} });
  } catch (err) {
    console.error("[audit] event write failed:", err);
  }
}

router.get(
  "/admin/review-queue",
  requireRole("admin", "reviewer"),
  async (req, res): Promise<void> => {
    const { status } = req.query as { status?: string };

    const cases =
      status === "pending" || status === "reviewed"
        ? await db
            .select()
            .from(reviewCasesTable)
            .where(eq(reviewCasesTable.status, status))
            .orderBy(desc(reviewCasesTable.createdAt))
        : await db
            .select()
            .from(reviewCasesTable)
            .orderBy(desc(reviewCasesTable.createdAt));

    const caseIds = cases.map((c) => c.id);

    const profilesByUser: Record<string, { profession: string } | undefined> = {};
    if (cases.length > 0) {
      const userIds = [...new Set(cases.map((c) => c.userId))];
      for (const uid of userIds) {
        const [p] = await db
          .select({ profession: profilesTable.profession })
          .from(profilesTable)
          .where(eq(profilesTable.userId, uid))
          .limit(1);
        profilesByUser[uid] = p;
      }
    }

    const decisionOutcomes: Record<number, string | undefined> = {};
    if (cases.length > 0) {
      for (const c of cases) {
        const [d] = await db
          .select({ outcome: decisionRecordsTable.outcome })
          .from(decisionRecordsTable)
          .where(eq(decisionRecordsTable.id, c.decisionRecordId))
          .limit(1);
        decisionOutcomes[c.id] = d?.outcome;
      }
    }

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
        profession: profilesByUser[c.userId]?.profession ?? null,
        outcome: decisionOutcomes[c.id] ?? null,
      })),
      total: cases.length,
    });
  }
);

router.get(
  "/admin/review-queue/:caseId",
  requireRole("admin", "reviewer"),
  async (req, res): Promise<void> => {
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
      decision: decision
        ? {
            id: decision.id,
            userId: decision.userId,
            outcome: decision.outcome,
            explanationText: decision.explanationText,
            reasonCodes: decision.reasonCodes,
            pathways: decision.pathways ?? null,
            rulesetId: decision.rulesetId,
            rulesetVersion: decision.rulesetVersion,
            profileSnapshotHash: decision.profileSnapshotHash,
            reviewFlagged: decision.reviewFlagged === 1,
            reviewNote: decision.reviewNote ?? null,
            createdAt: decision.createdAt,
          }
        : null,
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
  }
);

router.post(
  "/admin/review-queue/:caseId/annotate",
  requireRole("admin", "reviewer"),
  async (req, res): Promise<void> => {
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

    await writeAuditEvent(reviewerId, "review_annotated", `review_case:${caseId}`, {
      caseId,
      recommendedPathway: recommendedPathway?.trim() ?? null,
    });

    res.json({
      id: annotation.id,
      caseId: annotation.caseId,
      reviewerId: annotation.reviewerId,
      notes: annotation.notes,
      recommendedPathway: annotation.recommendedPathway ?? null,
      createdAt: annotation.createdAt,
    });
  }
);

export default router;
