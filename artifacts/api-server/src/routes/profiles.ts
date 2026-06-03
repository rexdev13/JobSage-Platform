import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, profilesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { GetMyProfileResponse, UpsertMyProfileBody, UpsertMyProfileResponse } from "@workspace/api-zod";
import { requireConsent } from "../middlewares/consentMiddleware";

const router: IRouter = Router();

const WELL_KNOWN_PROFESSIONS = [
  "Doctor",
  "Nurse",
  "Midwife",
  "Allied Health Professional",
  "Clinical Academic",
  "Dentist",
  "Pharmacist",
  "Optometrist",
  "Physiotherapist",
  "Radiographer",
  "Paramedic",
  "Occupational Therapist",
  "Social Worker",
  "Teacher / Lecturer",
  "Engineer",
  "Accountant",
  "IT Professional",
  "Lawyer / Solicitor",
  "Architect",
];

router.get("/professions", requireAuthenticated, async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select({
      profession: profilesTable.profession,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(profilesTable)
    .groupBy(profilesTable.profession)
    .having(sql`count(*) >= 3`);

  const popularCustom = rows
    .map((r) => r.profession)
    .filter(Boolean)
    .filter((p) => !WELL_KNOWN_PROFESSIONS.map((w) => w.toLowerCase()).includes(p.toLowerCase()));

  const merged = [
    ...WELL_KNOWN_PROFESSIONS,
    ...popularCustom,
  ];

  res.json({ professions: merged });
});

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

router.patch("/profiles/me/boost", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const { boost } = req.body as { boost?: boolean };
  if (typeof boost !== "boolean") {
    res.status(400).json({ error: "boost must be a boolean." });
    return;
  }

  const [profile] = await db
    .update(profilesTable)
    .set({ boostProfile: boost, updatedAt: new Date() })
    .where(eq(profilesTable.userId, req.user!.id))
    .returning();

  if (!profile) {
    res.status(404).json({ error: "Profile not found." });
    return;
  }

  res.json({ boostProfile: profile.boostProfile });
});

export default router;
