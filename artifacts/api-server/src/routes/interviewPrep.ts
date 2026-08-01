import { Router, type IRouter } from "express";
import { requireAuthenticated } from "../middlewares/requireRole";
import { db, profilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

type ProfessionBucket = "healthcare" | "education" | "higher_education" | "engineering" | "social_care" | "general";

function getProfessionBucket(profession: string): ProfessionBucket {
  const p = profession.toLowerCase().replace(/ /g, "_");
  if (p === "doctor" || p === "nurse" || p === "midwife" || p === "dentist" ||
      p === "allied_health_professional" || p === "clinical_academic" ||
      p.includes("physician") || p.includes("surgeon") || p.includes("pharmacist") ||
      p.includes("radiograph") || p.includes("paramedic") || p.includes("physiother") ||
      p.includes("occupational") || p.includes("speech"))
    return "healthcare";
  if (p === "teacher" || p.includes("teach") || p.includes("primary") || p.includes("secondary") ||
      p.includes("school"))
    return "education";
  if (p === "academic" || p === "lecturer" || p === "professor" || p.includes("research") ||
      p.includes("universi") || p.includes("higher_education"))
    return "higher_education";
  if (p === "engineer" || p.includes("engineer") || p.includes("technical") ||
      p.includes("software") || p.includes("civil") || p.includes("mechanic") ||
      p.includes("electrical") || p.includes("structural"))
    return "engineering";
  if (p === "social_worker" || p.includes("social_work") || p.includes("social care") ||
      p.includes("social_care"))
    return "social_care";
  return "general";
}

interface BucketContent {
  systemContext: string;
  categoryNames: string;
  adviceLabel: string;
  advicePrompt: string;
}

function getBucketContent(bucket: ProfessionBucket, profession: string, specialty: string): BucketContent {
  switch (bucket) {
    case "healthcare":
      return {
        systemContext: `You are an expert NHS and UK academic healthcare recruitment consultant.
Your role is to provide structured interview preparation for international healthcare professionals
seeking UK registration and employment. Always be specific, practical and tailored to UK NHS culture.`,
        categoryNames: "Values-based and NHS values questions | Clinical competency and specialty-specific questions | Situational and scenario-based questions | Leadership and teamwork questions | Career motivation and professional development questions",
        adviceLabel: "NHS-Specific Advice",
        advicePrompt: `5 NHS-specific pieces of advice for a ${profession} specialising in ${specialty} applying to UK healthcare roles`,
      };
    case "education":
      return {
        systemContext: `You are an expert UK teacher recruitment and school HR consultant.
Your role is to provide structured interview preparation for internationally-trained teachers
seeking UK Qualified Teacher Status (QTS) and school employment in England, Wales, or Scotland.`,
        categoryNames: "Behaviour Management questions | Curriculum Knowledge and Planning questions | Safeguarding and Child Protection questions | Lesson Planning and Pedagogy questions | School Values and Vision questions",
        adviceLabel: "Teaching in the UK — What to Expect",
        advicePrompt: `5 key pieces of advice for a ${profession} applying for teaching roles in UK schools, covering QTS, Ofsted, and UK classroom culture`,
      };
    case "higher_education":
      return {
        systemContext: `You are an expert UK higher education HR and academic career consultant.
Your role is to provide structured interview preparation for internationally-trained academics
seeking lecturing, research, and professorial roles at UK universities.`,
        categoryNames: "Research Methodology and Output questions | Teaching Philosophy and Student Support questions | Grant Writing and Research Funding questions | Departmental Collaboration and Academic Citizenship questions | Career Development and Impact questions",
        adviceLabel: "UK Higher Education — What to Expect",
        advicePrompt: `5 key pieces of advice for a ${profession} applying for academic roles in UK universities, covering REF, UKRI, and UK HE culture`,
      };
    case "engineering":
      return {
        systemContext: `You are an expert UK engineering recruitment and professional registration consultant.
Your role is to provide structured interview preparation for internationally-trained engineers
seeking roles in the UK, including professional registration (CEng, IEng) with bodies such as IMechE, IET, or ICE.`,
        categoryNames: "Technical Competency and Domain Knowledge questions | Problem-Solving and Design Scenario questions | Project Management and Delivery questions | Health, Safety and Environment questions | Professional Development and Registration questions",
        adviceLabel: "Engineering in the UK — What to Expect",
        advicePrompt: `5 key pieces of advice for a ${profession} specialising in ${specialty} applying for UK engineering roles, covering professional registration, HSE, and UK engineering culture`,
      };
    case "social_care":
      return {
        systemContext: `You are an expert UK social work and social care recruitment consultant.
Your role is to provide structured interview preparation for internationally-trained social workers
seeking registration with Social Work England (SWE) and employment in UK local authorities or charities.`,
        categoryNames: "Risk Assessment and Case Management questions | Person-Centred Care and Practice questions | Legislation and Policy questions (Care Act, Children Act, MCA) | Lone Working and Personal Safety questions | Safeguarding Adults and Children questions",
        adviceLabel: "Social Care in the UK — What to Expect",
        advicePrompt: `5 key pieces of advice for a ${profession} applying for UK social care roles, covering Social Work England registration, Care Act, and UK practice standards`,
      };
    default:
      return {
        systemContext: `You are an expert UK careers and professional recruitment consultant.
Your role is to provide structured interview preparation for internationally-trained professionals
seeking employment in the UK across a range of sectors.`,
        categoryNames: "Competency-Based and Behavioural questions | Values, Motivation and Culture-Fit questions | Adaptability and Communication questions | Teamwork and Leadership questions | Career Development and UK Workplace questions",
        adviceLabel: "Working in the UK — What to Expect",
        advicePrompt: `5 key pieces of practical advice for a ${profession} applying for roles in the UK, covering right-to-work, DBS checks, professional references, and UK workplace culture`,
      };
  }
}

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

  const bucket = getProfessionBucket(profile.profession);
  const bucketContent = getBucketContent(bucket, profession, specialty);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 2000,
      messages: [
        {
          role: "system",
          content: `${bucketContent.systemContext}
Return ONLY valid JSON, no markdown fences or extra text.`,
        },
        {
          role: "user",
          content: `Generate comprehensive interview preparation content for a ${profession} specialising in ${specialty} applying for UK roles.

Question categories to use (keep exactly these names):
${bucketContent.categoryNames}

Include:
1. A structured interview guide with 4-5 actionable tips relevant to this profession
2. One question bank per category above, each with 5-6 questions
3. ${bucketContent.advicePrompt}

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
  "professionAdvice": ["string", "string", "string", "string", "string"]
}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "{}";

    let parsed: {
      structuredInterviewGuide?: { title: string; description: string; tips: string[] };
      questionBanks?: Array<{ category: string; questions: string[] }>;
      professionAdvice?: string[];
    };

    try {
      parsed = JSON.parse(raw);
    } catch {
      res.status(500).json({ error: "Failed to parse AI response. Please try again." });
      return;
    }

    if (!parsed.structuredInterviewGuide || !parsed.questionBanks || !parsed.professionAdvice) {
      res.status(500).json({ error: "Incomplete AI response. Please try again." });
      return;
    }

    res.json({
      profession,
      specialty,
      structuredInterviewGuide: parsed.structuredInterviewGuide,
      questionBanks: parsed.questionBanks,
      nhsSpecificAdvice: parsed.professionAdvice,
      adviceLabel: bucketContent.adviceLabel,
      disclaimer:
        "This content is AI-generated for guidance purposes only. Interview formats vary by organisation. Always research the specific employer before your interview.",
    });
  } catch (err) {
    console.error("[interview-prep] AI generation error:", err);
    res.status(500).json({ error: "Failed to generate interview preparation content. Please try again." });
  }
});

export default router;
