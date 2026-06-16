import { Router, type IRouter, type Request, type Response } from "express";
import { db, profilesTable, jobListingsTable, smartApplyDraftsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuthenticated } from "../middlewares/requireRole";
import { getStandardQuestions, prefillApplicationAnswers } from "../lib/smartApply";
import { computeCompletionPct, SMART_APPLY_THRESHOLD } from "../lib/profileCompleteness";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

router.get("/smart-apply/questions", requireAuthenticated, (_req: Request, res: Response): void => {
  res.json({ questions: getStandardQuestions() });
});

router.post("/roles/:id/smart-apply/prefill", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const roleId = parseInt(req.params.id, 10);
  if (isNaN(roleId)) {
    res.status(400).json({ error: "Invalid role ID" });
    return;
  }

  const userId = req.user!.id;

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  if (!profile) {
    res.status(404).json({ error: "Candidate profile not found. Please complete your profile first." });
    return;
  }

  const completionPct = computeCompletionPct(profile);
  if (completionPct < SMART_APPLY_THRESHOLD) {
    res.status(422).json({ error: `Your profile is ${completionPct}% complete. Please complete the key fields before using Smart Apply.` });
    return;
  }

  let roleContext = {
    title: `Role #${roleId}`,
    description: null as string | null,
    regulator: "GMC/NMC/HCPC",
    location: "UK",
    sponsorshipOffered: false,
  };

  if (roleId > 1_000_000) {
    const jobId = roleId - 1_000_000;
    const [job] = await db
      .select()
      .from(jobListingsTable)
      .where(eq(jobListingsTable.id, jobId));

    if (job) {
      roleContext = {
        title: job.title,
        description: job.description,
        regulator: job.regulator,
        location: job.location,
        sponsorshipOffered: job.sponsorshipOffered ?? false,
      };
    }
  }

  try {
    const prefills = await prefillApplicationAnswers(
      {
        profession: profile.profession,
        specialty: profile.specialty,
        qualificationCountry: profile.qualificationCountry,
        qualificationType: profile.qualificationType,
        qualificationYear: profile.qualificationYear,
        experienceYears: profile.experienceYears,
        registrationStatus: profile.registrationStatus,
        requiresSponsorship: profile.requiresSponsorship,
        preferredRegion: profile.preferredRegion,
      },
      roleContext
    );

    res.json({
      questions: getStandardQuestions(),
      prefills,
      roleContext: {
        title: roleContext.title,
        location: roleContext.location,
        regulator: roleContext.regulator,
        sponsorshipOffered: roleContext.sponsorshipOffered,
      },
    });
  } catch (err) {
    console.error("Smart apply prefill error:", err);
    res.status(500).json({ error: "Failed to generate application answers. Please try again." });
  }
});

router.get("/smart-apply/draft/:roleId", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const roleId = parseInt(req.params.roleId, 10);
  if (isNaN(roleId)) {
    res.status(400).json({ error: "Invalid role ID" });
    return;
  }

  const [draft] = await db
    .select()
    .from(smartApplyDraftsTable)
    .where(
      and(
        eq(smartApplyDraftsTable.userId, req.user!.id),
        eq(smartApplyDraftsTable.roleId, roleId)
      )
    );

  if (!draft) {
    res.json({ answers: null });
    return;
  }

  res.json({ answers: draft.answers, updatedAt: draft.updatedAt.toISOString() });
});

router.put("/smart-apply/draft/:roleId", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const roleId = parseInt(req.params.roleId, 10);
  if (isNaN(roleId)) {
    res.status(400).json({ error: "Invalid role ID" });
    return;
  }

  const { answers } = req.body as { answers?: Record<string, string> };
  if (!answers || typeof answers !== "object") {
    res.status(400).json({ error: "answers object is required" });
    return;
  }

  await db
    .insert(smartApplyDraftsTable)
    .values({
      userId: req.user!.id,
      roleId,
      answers,
    })
    .onConflictDoUpdate({
      target: [smartApplyDraftsTable.userId, smartApplyDraftsTable.roleId],
      set: { answers, updatedAt: new Date() },
    });

  res.json({ ok: true });
});

// Streaming AI assistant — answers candidate questions using their profile + role context
router.post("/smart-apply/assistant", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const { roleId, message, questionId, questionText } = req.body as {
    roleId?: number;
    message?: string;
    questionId?: string;
    questionText?: string;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId));
  if (!profile) {
    res.status(400).json({ error: "Profile not found. Please complete your profile first." });
    return;
  }

  let roleContext = { title: "UK Healthcare Role", location: "UK", regulator: "GMC/NMC/HCPC", description: null as string | null, sponsorshipOffered: false };
  if (roleId && roleId > 1_000_000) {
    const jobId = roleId - 1_000_000;
    const [job] = await db.select().from(jobListingsTable).where(eq(jobListingsTable.id, jobId));
    if (job) {
      roleContext = { title: job.title, location: job.location, regulator: job.regulator, description: job.description, sponsorshipOffered: job.sponsorshipOffered ?? false };
    }
  }

  const profileSummary = `Candidate profile:
- Profession: ${profile.profession.replace(/_/g, " ")}
- Specialty: ${profile.specialty ?? "General"}
- Qualification: ${profile.qualificationType ?? "Unknown"} from ${profile.qualificationCountry ?? "International"} (${profile.qualificationYear ?? "?"})
- Experience: ${profile.experienceYears} years
- UK registration: ${profile.registrationStatus?.replace(/_/g, " ") ?? "unknown"}
- Requires sponsorship: ${profile.requiresSponsorship ? "Yes" : "No"}
${profile.preferredRegion ? `- Preferred region: ${profile.preferredRegion}` : ""}`.trim();

  const roleSummary = `Role: ${roleContext.title} | Location: ${roleContext.location} | Regulator: ${roleContext.regulator} | Sponsorship: ${roleContext.sponsorshipOffered ? "offered" : "not offered"}${roleContext.description ? `\nJob description excerpt: ${roleContext.description.slice(0, 500)}` : ""}`;

  const currentQCtx = questionId && questionText
    ? `\nThe candidate is currently answering this application question: "${questionText}" (id: ${questionId}). When asked to help with this question, give a concise, professional answer they can use directly.`
    : "";

  const systemPrompt = `You are a friendly and expert UK healthcare career assistant helping an internationally trained health professional complete a job application.

${profileSummary}

${roleSummary}${currentQCtx}

Guidelines:
- Give direct, practical answers (2–4 sentences) unless more detail is needed
- When asked to help answer an application question, write a ready-to-use response in first person
- Use UK English spelling and professional tone
- If asked about visa/sponsorship, draw on the profile's requiresSponsorship and registration status
- Keep responses concise and actionable`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 500,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message.trim() },
      ],
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error("[smart-apply-assistant] stream error:", err);
    res.write(`data: ${JSON.stringify({ error: "Assistant unavailable. Please try again." })}\n\n`);
    res.end();
  }
});

router.delete("/smart-apply/draft/:roleId", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const roleId = parseInt(req.params.roleId, 10);
  if (isNaN(roleId)) {
    res.status(400).json({ error: "Invalid role ID" });
    return;
  }

  await db
    .delete(smartApplyDraftsTable)
    .where(
      and(
        eq(smartApplyDraftsTable.userId, req.user!.id),
        eq(smartApplyDraftsTable.roleId, roleId)
      )
    );

  res.sendStatus(204);
});

export default router;
