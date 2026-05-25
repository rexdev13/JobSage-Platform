import { openai } from "@workspace/integrations-openai-ai-server";

const DISCLAIMER =
  "AI-generated recommendations are for guidance only and do not constitute professional advice.";

export interface ProgressData {
  candidateName: string;
  profession: string;
  specialty: string | null;
  registrationStatus: string | null;
  eligibilityOutcome: string | null;
  applicationsThisMonth: number;
  totalApplications: number;
  interviews: number;
  offers: number;
  noResponse: number;
  planProgress: number;
  planStepsDone: number;
  planStepsTotal: number;
  boostProfile: boolean;
  documentCount: number;
}

export interface ProgressReportResult {
  recommendedNextSteps: string;
  disclaimer: string;
}

export async function generateProgressRecommendations(
  data: ProgressData,
): Promise<ProgressReportResult> {
  const prompt = `You are a UK healthcare career advisor helping an international professional succeed in their UK journey.

Candidate summary:
- Name: ${data.candidateName}
- Profession: ${data.profession.replace(/_/g, " ")}
- Specialty: ${data.specialty ?? "General"}
- Registration: ${data.registrationStatus ?? "unknown"}
- Eligibility: ${data.eligibilityOutcome ?? "not checked"}
- Applications this month: ${data.applicationsThisMonth}
- Total applications: ${data.totalApplications} (${data.interviews} interviews, ${data.offers} offers, ${data.noResponse} no response)
- Remediation plan: ${data.planStepsDone}/${data.planStepsTotal} steps done (${data.planProgress}%)
- Documents uploaded: ${data.documentCount}
- Profile boost active: ${data.boostProfile}

Write 3–5 specific, actionable recommended next steps for this candidate. Be warm, encouraging and practical. Focus on the most impactful actions given their current situation. Each step should be 1–2 sentences. Return plain text with each step on a new line, prefixed with "• ".`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.choices[0]?.message?.content ?? "";
  return { recommendedNextSteps: text.trim(), disclaimer: DISCLAIMER };
}
