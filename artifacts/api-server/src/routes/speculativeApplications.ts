import { Router, type IRouter } from "express";
import { requireAuthenticated } from "../middlewares/requireRole";
import { db } from "@workspace/db";
import { speculativeApplicationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/speculative-applications", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const apps = await db
    .select()
    .from(speculativeApplicationsTable)
    .where(eq(speculativeApplicationsTable.userId, userId))
    .orderBy(desc(speculativeApplicationsTable.createdAt));

  res.json({ applications: apps });
});

router.post("/speculative-applications", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { companyName, sponsorLicenceId, notes } = req.body as {
    companyName?: string;
    sponsorLicenceId?: number | null;
    notes?: string | null;
  };

  if (!companyName || typeof companyName !== "string") {
    res.status(400).json({ error: "companyName is required." });
    return;
  }

  // Prevent duplicate speculative applications to the same company
  const [existing] = await db
    .select()
    .from(speculativeApplicationsTable)
    .where(
      and(
        eq(speculativeApplicationsTable.userId, userId),
        eq(speculativeApplicationsTable.companyName, companyName),
      ),
    )
    .limit(1);

  if (existing) {
    res.json({ application: existing, alreadySent: true });
    return;
  }

  const [app] = await db
    .insert(speculativeApplicationsTable)
    .values({
      userId,
      companyName,
      sponsorLicenceId: sponsorLicenceId ?? null,
      status: "sent",
      notes: notes ?? null,
    })
    .returning();

  res.status(201).json({ application: app, alreadySent: false });
});

export default router;
