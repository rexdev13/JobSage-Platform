import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, profilesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { GetMyProfileResponse, UpsertMyProfileBody, UpsertMyProfileResponse } from "@workspace/api-zod";
import { requireConsent } from "../middlewares/consentMiddleware";
import { computeCompletionPct } from "../lib/profileCompleteness";

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
  const rows = await db.execute(
    sql`SELECT max(trim(profession)) AS profession, cast(count(*) as int) AS count
        FROM profiles
        WHERE profession IS NOT NULL AND trim(profession) != ''
        GROUP BY lower(trim(profession))
        HAVING count(*) >= 3`
  );

  const wellKnownLower = WELL_KNOWN_PROFESSIONS.map((w) => w.toLowerCase());

  const popularCustom = (rows.rows as { profession: string; count: number }[])
    .map((r) => r.profession)
    .filter(Boolean)
    .filter((p) => !wellKnownLower.includes(p.toLowerCase().replace(/_/g, " ").trim()));

  const merged = [...WELL_KNOWN_PROFESSIONS, ...popularCustom];

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

  res.json(GetMyProfileResponse.parse({ ...profile, completionPct: computeCompletionPct(profile) }));
});

router.put("/profiles/me", requireAuthenticated, requireConsent, async (req: Request, res: Response): Promise<void> => {
  const parsed = UpsertMyProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const d = parsed.data;

  const values = {
    userId: req.user!.id,
    profession: d.profession,
    specialty: d.specialty,
    qualificationCountry: d.qualificationCountry,
    qualificationType: d.qualificationType,
    qualificationYear: d.qualificationYear,
    experienceYears: d.experienceYears,
    registrationStatus: d.registrationStatus,
    licenceReady: d.licenceReady ?? null,
    residencyStatus: d.residencyStatus,
    requiresSponsorship: d.requiresSponsorship,
    preferredRegion: d.preferredRegion ?? null,
    alertFrequency: (d.alertFrequency ?? "daily") as "daily" | "weekly" | "off",
    preferredStartDate: d.preferredStartDate ?? null,
    profilePhotoKey: d.profilePhotoKey ?? null,
    // drizzle types don't fully narrow text[].array() columns in .values()/.set(); cast needed
    languages: (d.languages ?? null) as unknown as string[] | null,
    additionalNotes: d.additionalNotes ?? null,
  };

  const [profile] = await db
    .insert(profilesTable)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values(values as any)
    .onConflictDoUpdate({
      target: profilesTable.userId,
      set: {
        profession: d.profession,
        specialty: d.specialty,
        qualificationCountry: d.qualificationCountry,
        qualificationType: d.qualificationType,
        qualificationYear: d.qualificationYear,
        experienceYears: d.experienceYears,
        registrationStatus: d.registrationStatus,
        licenceReady: d.licenceReady ?? null,
        residencyStatus: d.residencyStatus,
        requiresSponsorship: d.requiresSponsorship,
        preferredRegion: d.preferredRegion ?? null,
        alertFrequency: d.alertFrequency ?? "daily",
        preferredStartDate: d.preferredStartDate ?? null,
        profilePhotoKey: d.profilePhotoKey ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        languages: (d.languages ?? null) as any,
        additionalNotes: d.additionalNotes ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  res.json(UpsertMyProfileResponse.parse({ ...profile, completionPct: computeCompletionPct(profile) }));
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
