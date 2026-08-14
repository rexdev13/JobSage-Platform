import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter } from "express";
import { db, careerProfilesTable, profilesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireConsent } from "../middlewares/consentMiddleware";
import { openai } from "@workspace/integrations-openai-ai-server";
import { maskPersonalContactInfo, resolveJobsageAlias } from "../lib/jobsageEmailGen";

const router: IRouter = Router();

const MAX_PROFILES = 3;

async function generateCvBackground(profileId: number, userId: string): Promise<void> {
  try {
    const [[careerProfile], [baseProfile]] = await Promise.all([
      db.select().from(careerProfilesTable).where(and(eq(careerProfilesTable.id, profileId), eq(careerProfilesTable.userId, userId))),
      db.select().from(profilesTable).where(eq(profilesTable.userId, userId)),
    ]);
    if (!careerProfile) return;

    // Resolve JOBSAGE alias via centralized resolver (users table first → profiles fallback)
    const resolvedAlias = await resolveJobsageAlias(userId);

    const profileContext = baseProfile
      ? [
          `Profession: ${baseProfile.profession}`,
          `Specialty: ${baseProfile.specialty}`,
          `Qualification: ${baseProfile.qualificationType} (${baseProfile.qualificationCountry}, ${baseProfile.qualificationYear})`,
          `Experience: ${baseProfile.experienceYears} year(s)`,
          `Registration Status: ${baseProfile.registrationStatus}`,
          `Languages: ${(baseProfile.languages ?? []).join(", ") || "Not specified"}`,
          baseProfile.additionalNotes ? `Notes: ${baseProfile.additionalNotes}` : "",
          resolvedAlias ? `JOBSAGE Contact Email: ${resolvedAlias}` : "",
        ].filter(Boolean).join("\n")
      : "No base profile found.";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a senior professional CV writer specialising in UK healthcare roles (NHS, independent sector, and private healthcare). " +
            "Your output must be a complete, UK-standard CV that could be submitted directly to a UK employer. " +
            "Follow this exact section order:\n" +
            "1. HEADER — Candidate name (use the Career Profile Name provided), JOBSAGE contact email (prominently displayed if provided), and target role/specialty\n" +
            "2. PERSONAL STATEMENT (3–4 sentences; highlight clinical background, UK ambition, and key strengths)\n" +
            "3. WORK EXPERIENCE (most recent first; each role: Job Title | Organisation | Dates | 2–3 achievement-led bullets)\n" +
            "4. EDUCATION & QUALIFICATIONS (most recent first; Degree/Diploma | Institution | Country | Year)\n" +
            "5. PROFESSIONAL REGISTRATIONS (e.g. GMC, NMC, HCPC — or state 'In process' / 'Not yet registered')\n" +
            "6. REFERENCES (end with: 'References available on request.')\n\n" +
            "Style rules:\n" +
            "- Use clean, professional UK English. No Americanisms.\n" +
            "- Write in third person implied (no 'I'). Start bullets with strong verbs.\n" +
            "- Avoid generic filler phrases like 'hard-working' or 'team player' unless substantiated.\n" +
            "- If JOBSAGE Contact Email is provided, it MUST appear in the HEADER section — not in the Personal Statement.\n" +
            "- Do NOT include date of birth, nationality, marital status, or photo placeholders (not appropriate on UK CVs).\n" +
            "- Keep total length to 1–2 pages worth of content (approximately 400–600 words).\n" +
            "- End with a one-line disclaimer: 'This CV was AI-assisted via JOBSAGE. Please review, personalise, and verify all details before submission.'",
        },
        {
          role: "user",
          content:
            `Generate a complete UK-standard CV for the following healthcare professional:\n\n` +
            `Career Profile Name: ${careerProfile.name}\n` +
            `Focus Area / Target Role: ${careerProfile.focusArea}\n\n` +
            `Professional Background:\n${profileContext}\n\n` +
            `Please write a full, submission-ready CV following the UK healthcare standard format described. Include all sections even if some details are approximate — note where the candidate should personalise.`,
        },
      ],
      max_tokens: 900,
      temperature: 0.65,
    });

    let aiCvContent = completion.choices[0]?.message?.content?.trim() ?? "";
    // Post-process: mask any personal contact info that slipped through the AI output
    if (resolvedAlias && aiCvContent) {
      aiCvContent = maskPersonalContactInfo(aiCvContent, resolvedAlias);
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

  const { name, focusArea, aiCvContent } = req.body as {
    name?: string;
    focusArea?: string;
    aiCvContent?: string | null;
  };
  const updates: Partial<{ name: string; focusArea: string; aiCvContent: string | null }> = {};
  if (name?.trim()) updates.name = name.trim();
  const focusAreaChanged = !!focusArea?.trim() && focusArea.trim() !== profile.focusArea;
  if (focusAreaChanged) {
    updates.focusArea = focusArea!.trim();
    updates.aiCvContent = null;
  }
  // Allow direct aiCvContent update (used by CV Enhancement "Accept & Save" flow)
  if (aiCvContent !== undefined && !focusAreaChanged) {
    updates.aiCvContent = typeof aiCvContent === "string" ? aiCvContent : null;
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
