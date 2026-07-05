import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter } from "express";
import { db, careerProfilesTable, profilesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireConsent } from "../middlewares/consentMiddleware";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const MAX_PROFILES = 3;

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
});

router.patch("/career-profiles/:id", requireAuthenticated, requireConsent, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }

  const [profile] = await db
    .select()
    .from(careerProfilesTable)
    .where(and(eq(careerProfilesTable.id, id), eq(careerProfilesTable.userId, userId)));

  if (!profile) { res.status(404).json({ error: "Career profile not found." }); return; }

  const { name, focusArea } = req.body as { name?: string; focusArea?: string };
  const updates: Partial<{ name: string; focusArea: string; aiCvContent: string | null }> = {};
  if (name?.trim()) updates.name = name.trim();
  if (focusArea?.trim()) {
    updates.focusArea = focusArea.trim();
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
});

router.delete("/career-profiles/:id", requireAuthenticated, requireConsent, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(req.params.id, 10);
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
  const id = parseInt(req.params.id, 10);
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
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }

  const [careerProfile] = await db
    .select()
    .from(careerProfilesTable)
    .where(and(eq(careerProfilesTable.id, id), eq(careerProfilesTable.userId, userId)));

  if (!careerProfile) { res.status(404).json({ error: "Career profile not found." }); return; }

  const [baseProfile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  const profileContext = baseProfile
    ? [
        `Profession: ${baseProfile.profession}`,
        `Specialty: ${baseProfile.specialty}`,
        `Qualification: ${baseProfile.qualificationType} (${baseProfile.qualificationCountry}, ${baseProfile.qualificationYear})`,
        `Experience: ${baseProfile.experienceYears} year(s)`,
        `Registration Status: ${baseProfile.registrationStatus}`,
        `Languages: ${(baseProfile.languages ?? []).join(", ") || "Not specified"}`,
        baseProfile.additionalNotes ? `Notes: ${baseProfile.additionalNotes}` : "",
      ].filter(Boolean).join("\n")
    : "No base profile found.";

  try {
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

    const aiCvContent = completion.choices[0]?.message?.content?.trim() ?? "";

    const [updated] = await db
      .update(careerProfilesTable)
      .set({ aiCvContent })
      .where(eq(careerProfilesTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    console.error("[career-profiles] AI CV generation failed:", err);
    res.status(500).json({ error: "AI CV generation failed. Please try again." });
  }
});

export default router;
