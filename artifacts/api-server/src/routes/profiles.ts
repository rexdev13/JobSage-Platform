import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, profilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GetMyProfileResponse, UpsertMyProfileBody, UpsertMyProfileResponse } from "@workspace/api-zod";
import { requireConsent } from "../middlewares/consentMiddleware";

const router: IRouter = Router();

router.get("/profiles/me", requireAuthenticated, requireConsent, async (req: Request, res: Response): Promise<void> => {
  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, req.user!.id));

  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  res.json(GetMyProfileResponse.parse(profile));
});

router.put("/profiles/me", requireAuthenticated, requireConsent, async (req: Request, res: Response): Promise<void> => {
  const parsed = UpsertMyProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const values = { ...parsed.data, userId: req.user!.id };

  const [profile] = await db
    .insert(profilesTable)
    .values(values)
    .onConflictDoUpdate({
      target: profilesTable.userId,
      set: {
        ...parsed.data,
        updatedAt: new Date(),
      },
    })
    .returning();

  res.json(UpsertMyProfileResponse.parse(profile));
});

export default router;
