import { openai } from "@workspace/integrations-openai-ai-server";

export interface ApplicationQuestion {
  id: string;
  question: string;
  hint: string;
  required: boolean;
}

export interface PrefillResult {
  questionId: string;
  aiAnswer: string;
  confidence: "high" | "medium" | "low" | "none";
  needsReview: boolean;
}

const STANDARD_QUESTIONS: ApplicationQuestion[] = [
  {
    id: "motivation",
    question: "Why are you applying for this role and what motivates you?",
    hint: "Describe your professional motivation and why this specific role appeals to you.",
    required: true,
  },
  {
    id: "clinical_experience",
    question: "Summarise your relevant clinical experience for this role.",
    hint: "Include key specialties, procedures, and environments you have worked in.",
    required: true,
  },
  {
    id: "uk_registration",
    question: "What is your current UK regulatory registration status?",
    hint: "e.g. GMC registered, awaiting PLAB 2, NMC application in progress, etc.",
    required: true,
  },
  {
    id: "right_to_work",
    question: "Do you currently have the right to work in the UK?",
    hint: "Include visa type if applicable. If you need sponsorship, state this clearly.",
    required: true,
  },
  {
    id: "strengths",
    question: "What are your greatest professional strengths relevant to this position?",
    hint: "Be specific — give examples from your career that demonstrate these strengths.",
    required: true,
  },
  {
    id: "availability",
    question: "When can you start and what is your current notice period?",
    hint: "Include any constraints such as examination dates or pending visa processing.",
    required: false,
  },
];

const SYSTEM_PROMPT = `You are a specialist UK healthcare career coach helping an internationally trained health professional complete a job application.

Your task is to pre-fill job application questions using the candidate profile provided.
For each question, write a concise, professional answer (2–5 sentences).
If you cannot confidently answer a question from the profile data, set confidence to "none" and provide a template/placeholder.

Return ONLY valid JSON matching exactly:
{
  "prefills": [
    {
      "questionId": "<string>",
      "aiAnswer": "<string>",
      "confidence": "<high|medium|low|none>",
      "needsReview": <boolean — true if the candidate MUST review/edit before submitting>
    }
  ]
}`;

export function getStandardQuestions(): ApplicationQuestion[] {
  return STANDARD_QUESTIONS;
}

export async function prefillApplicationAnswers(
  profile: {
    profession: string;
    specialty: string;
    qualificationCountry: string;
    qualificationType: string;
    qualificationYear: number;
    experienceYears: number;
    registrationStatus: string;
    requiresSponsorship: boolean;
    preferredRegion?: string | null;
  },
  roleContext: {
    title: string;
    description?: string | null;
    regulator: string;
    location: string;
    sponsorshipOffered?: boolean;
  }
): Promise<PrefillResult[]> {
  const profileText = `
Profession: ${profile.profession}
Specialty: ${profile.specialty}
Qualification country: ${profile.qualificationCountry}
Qualification type: ${profile.qualificationType} (${profile.qualificationYear})
Years of experience: ${profile.experienceYears}
UK registration status: ${profile.registrationStatus}
Requires sponsorship: ${profile.requiresSponsorship ? "Yes" : "No"}
${profile.preferredRegion ? `Preferred UK region: ${profile.preferredRegion}` : ""}
`.trim();

  const roleText = `
Job title: ${roleContext.title}
Regulator: ${roleContext.regulator}
Location: ${roleContext.location}
Sponsorship offered: ${roleContext.sponsorshipOffered ? "Yes" : "No"}
${roleContext.description ? `Description: ${roleContext.description.slice(0, 600)}` : ""}
`.trim();

  const questionsText = STANDARD_QUESTIONS.map(
    (q, i) => `Q${i + 1} [id: ${q.id}]: ${q.question}`
  ).join("\n");

  const userMessage = `Candidate profile:\n${profileText}\n\nRole:\n${roleText}\n\nQuestions to answer:\n${questionsText}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_completion_tokens: 2000,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";

  let parsed: { prefills?: unknown[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  const prefills: PrefillResult[] = Array.isArray(parsed.prefills)
    ? parsed.prefills
        .filter(
          (p): p is { questionId: string; aiAnswer: string; confidence: string; needsReview: boolean } =>
            typeof p === "object" && p !== null
        )
        .map((p) => ({
          questionId: String(p.questionId),
          aiAnswer: String(p.aiAnswer),
          confidence: normaliseConf(p.confidence),
          needsReview: Boolean(p.needsReview),
        }))
    : [];

  return prefills;
}

function normaliseConf(val: unknown): "high" | "medium" | "low" | "none" {
  if (val === "high") return "high";
  if (val === "medium") return "medium";
  if (val === "low") return "low";
  return "none";
}
