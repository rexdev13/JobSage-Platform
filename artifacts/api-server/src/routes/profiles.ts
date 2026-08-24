import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, profilesTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { GetMyProfileResponse, UpsertMyProfileBody, UpsertMyProfileResponse } from "@workspace/api-zod";
import { requireConsent } from "../middlewares/consentMiddleware";
import { computeCompletionPct, computeMissingFields } from "../lib/profileCompleteness";
import { generateJobsageEmail } from "../lib/jobsageEmailGen";
import { ObjectStorageService } from "../lib/objectStorage";

const objectStorageService = new ObjectStorageService();

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
  let [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, req.user!.id));

  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  // Backfill: mirror the JOBSAGE alias from users table → profiles table so there is
  // exactly ONE stable alias per candidate (assigned at registration on users, reflected here).
  if (!profile.jobsageEmail) {
    const [userRow] = await db
      .select({ jobsageEmail: usersTable.jobsageEmail, firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.id));
    // Use the users-table alias if it exists; otherwise generate one and write back to both tables
    const alias = userRow?.jobsageEmail ?? generateJobsageEmail(userRow?.firstName, userRow?.lastName);
    try {
      const [updated] = await db
        .update(profilesTable)
        .set({ jobsageEmail: alias })
        .where(eq(profilesTable.userId, req.user!.id))
        .returning();
      if (updated) profile = updated;
      // Also ensure users table has the same alias (in case this is a legacy pre-registration-feature account)
      if (!userRow?.jobsageEmail) {
        await db.update(usersTable).set({ jobsageEmail: alias }).where(eq(usersTable.id, req.user!.id));
      }
    } catch {
      // Collision is vanishingly rare — serve without alias this request; it will retry next time
    }
  }

  res.json(GetMyProfileResponse.parse({ ...profile, completionPct: computeCompletionPct(profile), missingFields: computeMissingFields(profile) }));
});

router.put("/profiles/me", requireAuthenticated, requireConsent, async (req: Request, res: Response): Promise<void> => {
  const parsed = UpsertMyProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const d = parsed.data;

  // Resolve a JOBSAGE email alias for this candidate.
  // Look up any existing profile first so we never overwrite an already-assigned alias.
  const [existing] = await db
    .select({ jobsageEmail: profilesTable.jobsageEmail })
    .from(profilesTable)
    .where(eq(profilesTable.userId, req.user!.id));

  let jobsageEmail = existing?.jobsageEmail ?? null;
  if (!jobsageEmail) {
    // Prefer the alias already assigned on the users table (set at registration) so a
    // candidate always gets exactly ONE stable alias — no independent re-randomisation.
    const [userRow] = await db
      .select({ jobsageEmail: usersTable.jobsageEmail, firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.id));
    jobsageEmail = userRow?.jobsageEmail ?? generateJobsageEmail(userRow?.firstName, userRow?.lastName);
  }

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
    dbsClearanceLevel: d.dbsClearanceLevel ?? "unknown",
    safeguardingTrainingLevel: d.safeguardingTrainingLevel ?? "unknown",
    residencyStatus: d.residencyStatus,
    requiresSponsorship: d.requiresSponsorship,
    preferredRegion: d.preferredRegion ?? null,
    alertFrequency: (d.alertFrequency ?? "daily") as "daily" | "weekly" | "off",
    preferredStartDate: d.preferredStartDate ?? null,
    profilePhotoKey: d.profilePhotoKey ?? null,
    // drizzle types don't fully narrow text[].array() columns in .values()/.set(); cast needed
    languages: (d.languages ?? null) as unknown as string[] | null,
    additionalNotes: d.additionalNotes ?? null,
    phone: d.phone ?? null,
    streetAddress: d.streetAddress ?? null,
    city: d.city ?? null,
    postcode: d.postcode ?? null,
    country: d.country ?? null,
    jobsageEmail,
  };
  // CV extraction submits a partial profile payload. Keep a candidate's
  // recorded safeguarding evidence unless the client explicitly changes it.
  const updateValues: Record<string, unknown> = {
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
    languages: d.languages ?? null,
    additionalNotes: d.additionalNotes ?? null,
    jobsageEmail: sql`COALESCE(${profilesTable.jobsageEmail}, ${jobsageEmail})`,
    updatedAt: new Date(),
  };
  if (d.dbsClearanceLevel !== undefined) updateValues.dbsClearanceLevel = d.dbsClearanceLevel;
  if (d.safeguardingTrainingLevel !== undefined) updateValues.safeguardingTrainingLevel = d.safeguardingTrainingLevel;
  if (d.phone !== undefined) updateValues.phone = d.phone;
  if (d.streetAddress !== undefined) updateValues.streetAddress = d.streetAddress;
  if (d.city !== undefined) updateValues.city = d.city;
  if (d.postcode !== undefined) updateValues.postcode = d.postcode;
  if (d.country !== undefined) updateValues.country = d.country;

  const [profile] = await db
    .insert(profilesTable)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values(values as any)
    .onConflictDoUpdate({
      target: profilesTable.userId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set: updateValues as any,
    })
    .returning();

  // Set ACL on the profile photo so the owner can access it via GET /storage/objects/*
  if (d.profilePhotoKey) {
    try {
      await objectStorageService.trySetObjectEntityAclPolicy(d.profilePhotoKey, {
        owner: req.user!.id,
        visibility: "private",
      });
    } catch (aclErr) {
      console.error("Profile photo ACL write failed:", aclErr);
    }
  }

  res.json(UpsertMyProfileResponse.parse({ ...profile, completionPct: computeCompletionPct(profile), missingFields: computeMissingFields(profile) }));
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
