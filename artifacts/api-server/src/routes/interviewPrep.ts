import { Router, type IRouter } from "express";
import { requireAuthenticated } from "../middlewares/requireRole";
import { db, profilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

router.get("/interview-prep/questions", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  if (!profile) {
    res.status(400).json({ error: "Profile not found. Please complete your profile first." });
    return;
  }

  const profession = profile.profession.replace(/_/g, " ");
  const specialtyOverride = typeof req.query.specialty === "string" && req.query.specialty.trim()
    ? req.query.specialty.trim()
    : null;
  const specialty = specialtyOverride || profile.specialty || "General";

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 2000,
      messages: [
        {
          role: "system",
          content: `You are an expert NHS and UK academic healthcare recruitment consultant. 
Your role is to provide structured interview preparation materials for international healthcare professionals 
seeking UK registration and employment. Always be specific, practical and tailored to UK NHS culture.
Return ONLY valid JSON, no markdown fences or extra text.`,
        },
        {
          role: "user",
          content: `Generate comprehensive interview preparation content for a ${profession} specialising in ${specialty} 
applying for NHS and UK academic roles. Include:
1. A structured interview guide overview with 4-5 actionable tips
2. 5 question banks, each with a category name and 5-6 questions:
   - Values-based and NHS values questions
   - Clinical competency and specialty-specific questions  
   - Situational and scenario-based questions
   - Leadership and teamwork questions
   - Career motivation and professional development questions
3. 5 NHS-specific pieces of advice

Return ONLY this JSON structure:
{
  "structuredInterviewGuide": {
    "title": "string",
    "description": "string",
    "tips": ["string", "string", "string", "string", "string"]
  },
  "questionBanks": [
    {
      "category": "string",
      "questions": ["string", "string", "string", "string", "string"]
    }
  ],
  "nhsSpecificAdvice": ["string", "string", "string", "string", "string"]
}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "{}";

    let parsed: {
      structuredInterviewGuide?: { title: string; description: string; tips: string[] };
      questionBanks?: Array<{ category: string; questions: string[] }>;
      nhsSpecificAdvice?: string[];
    };

    try {
      parsed = JSON.parse(raw);
    } catch {
      res.status(500).json({ error: "Failed to parse AI response. Please try again." });
      return;
    }

    if (!parsed.structuredInterviewGuide || !parsed.questionBanks || !parsed.nhsSpecificAdvice) {
      res.status(500).json({ error: "Incomplete AI response. Please try again." });
      return;
    }

    res.json({
      profession,
      specialty,
      structuredInterviewGuide: parsed.structuredInterviewGuide,
      questionBanks: parsed.questionBanks,
      nhsSpecificAdvice: parsed.nhsSpecificAdvice,
      disclaimer:
        "This content is AI-generated for guidance purposes only. Interview formats vary by organisation. Always research the specific trust or academic institution before your interview.",
    });
  } catch (err) {
    console.error("[interview-prep] AI generation error:", err);
    res.status(500).json({ error: "Failed to generate interview preparation content. Please try again." });
  }
});

export default router;
