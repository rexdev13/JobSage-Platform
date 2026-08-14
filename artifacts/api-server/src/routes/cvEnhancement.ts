import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter } from "express";
import { db, profilesTable, documentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

// ── POST /profiles/cv-enhancement ─────────────────────────────────────────────
// Generates an enhanced CV personal statement & skills summary from the
// candidate's structured profile data. Does NOT save — returns text for review.
router.post("/profiles/cv-enhancement", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const { mode, focus } = req.body as { mode?: unknown; focus?: unknown };

  if (mode !== "general" && mode !== "focused") {
    res.status(400).json({ error: 'mode must be "general" or "focused".' });
    return;
  }
  if (mode === "focused" && (!focus || typeof focus !== "string" || !focus.trim())) {
    res.status(400).json({ error: "A focus prompt is required for focused enhancement." });
    return;
  }
  const focusText = typeof focus === "string" ? focus.trim() : undefined;

  try {
    // Fetch profile + primary CV parsedData in parallel
    const [[profile], [primaryCv]] = await Promise.all([
      db.select().from(profilesTable).where(eq(profilesTable.userId, userId)).limit(1),
      db
        .select({ parsedData: documentsTable.parsedData })
        .from(documentsTable)
        .where(
          and(
            eq(documentsTable.userId, userId),
            eq(documentsTable.documentType, "cv"),
            eq(documentsTable.isPrimary, true),
          ),
        )
        .limit(1),
    ]);

    if (!profile) {
      res.status(400).json({ error: "No profile found. Complete your profile first." });
      return;
    }

    // Pull rawNotes from the primary CV's parsedData if available
    const rawNotes =
      (primaryCv?.parsedData as Record<string, unknown> | null)?.rawNotes as string | undefined;

    const profileContext = [
      `Profession: ${profile.profession}`,
      profile.specialty ? `Specialty: ${profile.specialty}` : null,
      profile.qualificationType
        ? `Qualification: ${profile.qualificationType} (${profile.qualificationCountry ?? "unknown"}, ${profile.qualificationYear ?? "unknown"})`
        : null,
      profile.experienceYears != null ? `Years of experience: ${profile.experienceYears}` : null,
      profile.registrationStatus ? `Registration status: ${profile.registrationStatus}` : null,
      profile.residencyStatus ? `Residency / visa status: ${profile.residencyStatus}` : null,
      profile.requiresSponsorship != null
        ? `Requires UK sponsorship: ${profile.requiresSponsorship ? "Yes" : "No"}`
        : null,
      profile.languages?.length ? `Languages: ${profile.languages.join(", ")}` : null,
      profile.additionalNotes ? `Additional notes: ${profile.additionalNotes}` : null,
      rawNotes ? `CV notes (from uploaded document): ${rawNotes}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const systemPrompt =
      "You are a professional CV writer specialising in UK healthcare and skilled-worker immigration. " +
      "Write in UK English. Use strong action verbs. Write in third-person implied (no 'I'). " +
      "Do not invent qualifications or experience not stated in the candidate profile. " +
      "Output 3–5 concise, polished paragraphs suitable for the personal statement and skills summary " +
      "section at the top of a UK CV. Do not include section headers or labels — output the prose directly.";

    const userPrompt =
      mode === "focused"
        ? `TASK: Write a polished, professional CV personal statement and skills summary for this candidate, ` +
          `specifically tailored to the following focus: "${focusText!}"\n\n` +
          `Emphasise the aspects of their profile most relevant to this focus. ` +
          `Use strong action verbs and UK-professional tone. ` +
          `Do not invent qualifications or experience not present in the profile.\n\n` +
          `CANDIDATE PROFILE:\n${profileContext}`
        : `TASK: Write a polished, professional CV personal statement and skills summary for this candidate. ` +
          `Improve grammar, replace weak language with strong action verbs, and adopt a confident, ` +
          `UK-professional tone. Do not invent qualifications or experience not present in the profile.\n\n` +
          `CANDIDATE PROFILE:\n${profileContext}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 700,
      temperature: 0.55,
    });

    const enhancedContent = completion.choices[0]?.message?.content?.trim() ?? "";
    res.json({ enhancedContent, mode, focus: focusText ?? null });
  } catch (err) {
    console.error("[cv-enhancement] Generation error:", err);
    res.status(500).json({ error: "Failed to generate CV enhancement." });
  }
});

export default router;
