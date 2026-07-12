import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter } from "express";
import { db, careerProfilesTable, profilesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireConsent } from "../middlewares/consentMiddleware";
import { openai } from "@workspace/integrations-openai-ai-server";
import { maskPersonalContactInfo } from "../lib/jobsageEmailGen";

const router: IRouter = Router();

const MAX_PROFILES = 3;

async function generateCvBackground(profileId: number, userId: string): Promise<void> {
  try {
    const [[careerProfile], [baseProfile]] = await Promise.all([
      db.select().from(careerProfilesTable).where(and(eq(careerProfilesTable.id, profileId), eq(careerProfilesTable.userId, userId))),
      db.select().from(profilesTable).where(eq(profilesTable.userId, userId)),
    ]);
    if (!careerProfile) return;

    const profileContext = baseProfile
      ? [
          `Profession: ${baseProfile.profession}`,
          `Specialty: ${baseProfile.specialty}`,
          `Qualification: ${baseProfile.qualificationType} (${baseProfile.qualificationCountry}, ${baseProfile.qualificationYear})`,
          `Experience: ${baseProfile.experienceYears} year(s)`,
          `Registration Status: ${baseProfile.registrationStatus}`,
          `Languages: ${(baseProfile.languages ?? []).join(", ") || "Not specified"}`,
          baseProfile.additionalNotes ? `Notes: ${baseProfile.additionalNotes}` : "",
          baseProfile.jobsageEmail ? `JOBSAGE Contact Email: ${baseProfile.jobsageEmail}` : "",
        ].filter(Boolean).join("\n")
      : "No base profile found.";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a professional CV writer specialising in UK healthcare and professional sector roles. " +
            "Write a tailored, concise professional summary and key skills section for a candidate applying for UK roles. " +
            "Focus on the specific career profile focus area provided. " +
            "Format: 2–3 sentence professional summary, followed by 5–6 bullet-point key skills. " +
            "Keep it under 300 words. Do not include personal details or contact information. " +
            "End with a short disclaimer: 'This CV content was AI-assisted. Please review and personalise before submitting applications.'",
        },
        {
          role: "user",
          content:
            `Generate a tailored CV summary for the following career profile:\n\n` +
            `Career Profile Name: ${careerProfile.name}\n` +
            `Focus Area: ${careerProfile.focusArea}\n\n` +
            `Base Professional Profile:\n${profileContext}`,
        },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    let aiCvContent = completion.choices[0]?.message?.content?.trim() ?? "";
    // Post-process: mask any personal contact info that slipped through the AI output
    if (baseProfile?.jobsageEmail && aiCvContent) {
      aiCvContent = maskPersonalContactInfo(aiCvContent, baseProfile.jobsageEmail);
    }
    await db.update(careerProfilesTable).set({ aiCvContent }).where(eq(careerProfilesTable.id, profileId));
  } catch (err) {
    console.error("[career-profiles] Background CV generation failed:", err);
  }
}

router.get("/career-profiles", requireAuthenticated, requireConsent, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const profiles = await db
    .select()
    .from(careerProfilesTable)
    .where(eq(careerProfilesTable.userId, userId))
    .orderBy(careerProfilesTable.createdAt);
  res.json({ profiles });
});

router.post("/career-profiles", requireAuthenticated, requireConsent, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const existing = await db
    .select()
    .from(careerProfilesTable)
    .where(eq(careerProfilesTable.userId, userId));

  if (existing.length >= MAX_PROFILES) {
    res.status(400).json({ error: `You can have at most ${MAX_PROFILES} career profiles.` });
    return;
  }

  const { name, focusArea } = req.body as { name?: string; focusArea?: string };
  if (!name?.trim() || !focusArea?.trim()) {
    res.status(400).json({ error: "name and focusArea are required." });
    return;
  }

  const isFirstProfile = existing.length === 0;

  const [created] = await db
    .insert(careerProfilesTable)
    .values({
      userId,
      name: name.trim(),
      focusArea: focusArea.trim(),
      isActive: isFirstProfile,
    })
    .returning();

  res.status(201).json(created);

  // Background: auto-generate CV for the new profile so it's ready immediately
  setImmediate(() => void generateCvBackground(created.id, userId));
});

router.patch("/career-profiles/:id", requireAuthenticated, requireConsent, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }

  const [profile] = await db
    .select()
    .from(careerProfilesTable)
    .where(and(eq(careerProfilesTable.id, id), eq(careerProfilesTable.userId, userId)));

  if (!profile) { res.status(404).json({ error: "Career profile not found." }); return; }

  const { name, focusArea } = req.body as { name?: string; focusArea?: string };
  const updates: Partial<{ name: string; focusArea: string; aiCvContent: string | null }> = {};
  if (name?.trim()) updates.name = name.trim();
  const focusAreaChanged = !!focusArea?.trim() && focusArea.trim() !== profile.focusArea;
  if (focusAreaChanged) {
    updates.focusArea = focusArea!.trim();
    updates.aiCvContent = null;
  }

  if (Object.keys(updates).length === 0) {
    res.json(profile);
    return;
  }

  const [updated] = await db
    .update(careerProfilesTable)
    .set(updates)
    .where(eq(careerProfilesTable.id, id))
    .returning();

  res.json(updated);

  // Background: regenerate CV when the focus area changes
  if (focusAreaChanged) {
    setImmediate(() => void generateCvBackground(id, userId));
  }
});

router.delete("/career-profiles/:id", requireAuthenticated, requireConsent, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }

  const [profile] = await db
    .select()
    .from(careerProfilesTable)
    .where(and(eq(careerProfilesTable.id, id), eq(careerProfilesTable.userId, userId)));

  if (!profile) { res.status(404).json({ error: "Career profile not found." }); return; }

  await db.delete(careerProfilesTable).where(eq(careerProfilesTable.id, id));

  if (profile.isActive) {
    const remaining = await db
      .select()
      .from(careerProfilesTable)
      .where(eq(careerProfilesTable.userId, userId))
      .orderBy(careerProfilesTable.createdAt);
    if (remaining.length > 0) {
      await db
        .update(careerProfilesTable)
        .set({ isActive: true })
        .where(eq(careerProfilesTable.id, remaining[0].id));
    }
  }

  res.status(204).send();
});

router.post("/career-profiles/:id/activate", requireAuthenticated, requireConsent, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }

  const [profile] = await db
    .select()
    .from(careerProfilesTable)
    .where(and(eq(careerProfilesTable.id, id), eq(careerProfilesTable.userId, userId)));

  if (!profile) { res.status(404).json({ error: "Career profile not found." }); return; }

  await db
    .update(careerProfilesTable)
    .set({ isActive: false })
    .where(eq(careerProfilesTable.userId, userId));

  const [activated] = await db
    .update(careerProfilesTable)
    .set({ isActive: true })
    .where(eq(careerProfilesTable.id, id))
    .returning();

  res.json(activated);
});

router.post("/career-profiles/:id/generate-cv", requireAuthenticated, requireConsent, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }

  const [careerProfile] = await db
    .select()
    .from(careerProfilesTable)
    .where(and(eq(careerProfilesTable.id, id), eq(careerProfilesTable.userId, userId)));

  if (!careerProfile) { res.status(404).json({ error: "Career profile not found." }); return; }

  await generateCvBackground(id, userId);

  const [updated] = await db
    .select()
    .from(careerProfilesTable)
    .where(eq(careerProfilesTable.id, id));

  if (!updated) { res.status(404).json({ error: "Career profile not found after generation." }); return; }
  res.json(updated);
});

export default router;
