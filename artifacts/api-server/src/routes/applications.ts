import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { applicationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuthenticated } from "../middlewares/requireRole";

const router: IRouter = Router();

router.get("/applications", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const applications = await db
    .select()
    .from(applicationsTable)
    .where(eq(applicationsTable.userId, userId))
    .orderBy(applicationsTable.appliedAt);

  const stats = {
    total: applications.length,
    interviews: applications.filter((a) => a.status === "interview").length,
    offers: applications.filter((a) => a.status === "offer").length,
    noResponse: applications.filter((a) => a.status === "no_response").length,
  };

  res.json({ applications, stats });
});

router.post("/applications", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { roleId, notes } = req.body as { roleId?: number; notes?: string };

  if (!roleId || typeof roleId !== "number") {
    res.status(400).json({ error: "roleId is required and must be a number." });
    return;
  }

  const [existing] = await db
    .select()
    .from(applicationsTable)
    .where(and(eq(applicationsTable.userId, userId), eq(applicationsTable.roleId, roleId)));

  if (existing) {
    res.json(existing);
    return;
  }

  const [application] = await db
    .insert(applicationsTable)
    .values({ userId, roleId, notes: notes ?? null, status: "applied" })
    .returning();

  res.json(application);
});

export default router;
