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
  preferredRegion?: string | null;
}

export interface CompanyRecommendation {
  name: string;
  type: string;
  matchPct: number;
  reason: string;
  location?: string;
}

export interface ProgressReportResult {
  recommendedNextSteps: string;
  topCompanies: CompanyRecommendation[];
  disclaimer: string;
}

export async function generateProgressRecommendations(
  data: ProgressData,
): Promise<ProgressReportResult> {
  const professionLabel = data.profession.replace(/_/g, " ");
  const regionHint = data.preferredRegion ? `, preferred region: ${data.preferredRegion}` : "";

  const nextStepsPromise = openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_completion_tokens: 500,
    messages: [
      {
        role: "user",
        content: `You are a UK healthcare career advisor helping an international professional succeed in their UK journey.

Candidate summary:
- Name: ${data.candidateName}
- Profession: ${professionLabel}
- Specialty: ${data.specialty ?? "General"}
- Registration: ${data.registrationStatus ?? "unknown"}
- Eligibility: ${data.eligibilityOutcome ?? "not checked"}
- Applications this month: ${data.applicationsThisMonth}
- Total applications: ${data.totalApplications} (${data.interviews} interviews, ${data.offers} offers, ${data.noResponse} no response)
- Remediation plan: ${data.planStepsDone}/${data.planStepsTotal} steps done (${data.planProgress}%)
- Documents uploaded: ${data.documentCount}
- Profile boost active: ${data.boostProfile}

Write 3–5 specific, actionable recommended next steps for this candidate. Be warm, encouraging and practical. Focus on the most impactful actions given their current situation. Each step should be 1–2 sentences. Return plain text with each step on a new line, prefixed with "• ".`,
      },
    ],
  });

  const topCompaniesPromise = openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_completion_tokens: 1200,
    messages: [
      {
        role: "user",
        content: `You are a UK healthcare recruitment expert. Based on the following candidate profile, identify the top 10 UK healthcare employers they should target for employment.

Candidate:
- Profession: ${professionLabel}
- Specialty: ${data.specialty ?? "General"}
- Registration status: ${data.registrationStatus ?? "unknown"}
- Eligibility outcome: ${data.eligibilityOutcome ?? "not yet checked"}${regionHint}

Return ONLY a JSON array — no prose, no markdown, no code block fences. Exactly 10 items in this format:
[
  {
    "name": "Employer name",
    "type": "NHS Trust | Private Hospital | Mental Health Trust | Community Trust | etc",
    "matchPct": 87,
    "reason": "One sentence explaining why this employer is a strong match for this candidate.",
    "location": "City / Region"
  }
]

Rules:
- Use real, well-known UK healthcare employers (NHS Trusts, private healthcare groups, community trusts).
- Match % must be between 65 and 98 and must vary across the 10 results.
- Order by matchPct descending.
- Tailor to the candidate's specialty and preferred region if provided.`,
      },
    ],
  });

  const [nextStepsRes, topCompaniesRes] = await Promise.all([
    nextStepsPromise,
    topCompaniesPromise,
  ]);

  const text = nextStepsRes.choices[0]?.message?.content ?? "";

  let topCompanies: CompanyRecommendation[] = [];
  try {
    const raw = topCompaniesRes.choices[0]?.message?.content ?? "[]";
    const cleaned = raw.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      topCompanies = parsed.slice(0, 10).map((c) => ({
        name: String(c.name ?? ""),
        type: String(c.type ?? ""),
        matchPct: Math.min(100, Math.max(0, Number(c.matchPct) || 0)),
        reason: String(c.reason ?? ""),
        location: c.location ? String(c.location) : undefined,
      }));
    }
  } catch {
    topCompanies = [];
  }

  return { recommendedNextSteps: text.trim(), topCompanies, disclaimer: DISCLAIMER };
}
