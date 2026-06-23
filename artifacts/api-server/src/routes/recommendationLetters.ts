import { Router, type IRouter, type Request, type Response } from "express";
import { db, recommendationLettersTable, employerProfilesTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuthenticated, requireRole } from "../middlewares/requireRole";

const router: IRouter = Router();

router.get("/recommendation-letters/mine", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const letters = await db
    .select()
    .from(recommendationLettersTable)
    .where(eq(recommendationLettersTable.candidateUserId, userId))
    .orderBy(desc(recommendationLettersTable.createdAt));
  res.json({ letters });
});

router.post("/recommendation-letters", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const role = req.user!.role;
  const { candidateUserId, authorName, authorTitle, organisation, relationship, content } =
    req.body as {
      candidateUserId?: string;
      authorName?: string;
      authorTitle?: string;
      organisation?: string;
      relationship?: string;
      content?: string;
    };

  if (!authorName || !authorTitle || !organisation || !relationship || !content) {
    res.status(400).json({ error: "authorName, authorTitle, organisation, relationship and content are required" });
    return;
  }

  if (content.trim().length < 50) {
    res.status(400).json({ error: "Letter content must be at least 50 characters" });
    return;
  }

  let targetCandidateId = userId;
  let isEmployerVerified = false;
  let employerUserId: string | null = null;

  if (role === "employer" || role === "admin" || role === "super_admin") {
    if (!candidateUserId) {
      res.status(400).json({ error: "candidateUserId is required for employer/admin submissions" });
      return;
    }
    const [candidate] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.id, candidateUserId), eq(usersTable.role, "candidate")));
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    targetCandidateId = candidateUserId;
    isEmployerVerified = true;
    employerUserId = userId;
  }

  const [letter] = await db
    .insert(recommendationLettersTable)
    .values({
      candidateUserId: targetCandidateId,
      employerUserId,
      authorName: authorName.trim(),
      authorTitle: authorTitle.trim(),
      organisation: organisation.trim(),
      relationship: relationship.trim(),
      content: content.trim(),
      isEmployerVerified,
    })
    .returning();

  res.status(201).json(letter);
});

router.delete("/recommendation-letters/:id", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [letter] = await db.select().from(recommendationLettersTable).where(eq(recommendationLettersTable.id, id));
  if (!letter) { res.status(404).json({ error: "Not found" }); return; }
  if (letter.candidateUserId !== userId && req.user!.role !== "admin" && req.user!.role !== "super_admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  await db.delete(recommendationLettersTable).where(eq(recommendationLettersTable.id, id));
  res.json({ ok: true });
});

router.get("/admin/recommendation-letters", requireRole("admin", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const letters = await db
    .select()
    .from(recommendationLettersTable)
    .orderBy(desc(recommendationLettersTable.createdAt))
    .limit(200);
  res.json({ letters });
});

export default router;
