import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuthenticated } from "../middlewares/requireRole";
import { openai } from "@workspace/integrations-openai-ai-server";
import { db, profilesTable, applicationsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

interface RoleNudge {
  title: string;
  reason: string;
  fitScore: number;
  setting: string;
  location?: string;
}

router.get("/nudge/next-roles", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  if (!profile?.profession) {
    res.json({ roles: [] });
    return;
  }

  const applications = await db
    .select()
    .from(applicationsTable)
    .where(eq(applicationsTable.userId, userId))
    .orderBy(desc(applicationsTable.appliedAt))
    .limit(20);

  const totalApps = applications.length;
  const interviews = applications.filter((a) => a.status === "interview").length;
  const offers = applications.filter((a) => a.status === "offer").length;

  const professionLabel = profile.profession.replace(/_/g, " ");
  const specialtyLabel = profile.specialty ?? "General";
  const expYears = profile.experienceYears ?? 0;
  const region = profile.preferredRegion ?? "UK";
  const regStatus = profile.registrationStatus ?? "unknown";

  const systemPrompt = `You are a UK healthcare career advisor for JOBSAGE. 
Suggest exactly 3 specific next career moves for a healthcare professional.
Return ONLY a JSON array of 3 objects with keys: title, reason, fitScore (0-100), setting (e.g. "NHS Trust", "Private Clinic", "Community Health"), location (optional UK region).
Keep each "reason" to 1-2 sentences, focused on career progression logic.`;

  const userPrompt = `Candidate profile:
- Profession: ${professionLabel}
- Specialty: ${specialtyLabel}
- Experience: ${expYears} years
- Preferred region: ${region}
- Registration status: ${regStatus}
- Applications sent: ${totalApps}, Interviews: ${interviews}, Offers: ${offers}

Suggest 3 specific UK healthcare roles that would be logical next career steps. Consider progression level, specialisation depth, and breadth options.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 600,
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content ?? "[]";
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    const roles: RoleNudge[] = jsonMatch ? (JSON.parse(jsonMatch[0]) as RoleNudge[]) : [];

    res.json({
      roles: roles.slice(0, 3),
      profession: professionLabel,
      disclaimer: "AI suggestions are for guidance only and based on your profile data.",
    });
  } catch (err) {
    console.error("[nudge] Failed to generate next-roles:", err);
    res.status(500).json({ error: "Failed to generate role suggestions" });
  }
});

export default router;
