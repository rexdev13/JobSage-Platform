import { openai } from "@workspace/integrations-openai-ai-server";

export interface RoleForScoring {
  id: number;
  title: string;
  employer: string;
  location: string;
  regulator: string;
  sponsorshipOffered: boolean;
  requiredRegistration: string;
}

export interface CandidateProfileForScoring {
  profession: string;
  specialty: string;
  experienceYears: number;
  qualificationCountry: string;
  registrationStatus: string;
  requiresSponsorship: boolean;
}

export interface MatchScore {
  roleId: number;
  score: number;
  explanation: string;
}

export async function batchScoreRoles(
  profile: CandidateProfileForScoring,
  roles: RoleForScoring[],
): Promise<Map<number, { score: number; explanation: string }>> {
  if (roles.length === 0) return new Map();

  const profileText = [
    `Profession: ${profile.profession.replace(/_/g, " ")}`,
    `Specialty: ${profile.specialty}`,
    `Experience: ${profile.experienceYears} years`,
    `Qualification country: ${profile.qualificationCountry}`,
    `Registration status: ${profile.registrationStatus}`,
    `Requires visa sponsorship: ${profile.requiresSponsorship ? "Yes" : "No"}`,
  ].join("\n");

  const vacancyLines = roles
    .map(
      (r) =>
        `${r.id}: "${r.title}" at ${r.employer}, ${r.location} — Sponsorship: ${r.sponsorshipOffered ? "Yes" : "No"}, Regulator: ${r.regulator}, Required: ${r.requiredRegistration}`,
    )
    .join("\n");

  const prompt = `You are a UK healthcare recruitment AI. Score how well this candidate matches each vacancy.

Candidate Profile:
${profileText}

Score each vacancy 0–100 based on: specialty alignment, experience level, sponsorship fit, and registration requirement.
For each vacancy provide a short one-sentence explanation (max 90 characters) like "Strong specialty match — sponsorship available" or "Experience below senior requirement".

Vacancies:
${vacancyLines}

Return ONLY valid JSON:
{"scores":[{"roleId":<integer>,"score":<0-100>,"explanation":"<string>"}]}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: Math.min(4000, roles.length * 60 + 200),
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { scores?: unknown[] };
    const result = new Map<number, { score: number; explanation: string }>();

    if (Array.isArray(parsed.scores)) {
      for (const item of parsed.scores) {
        if (
          typeof item === "object" &&
          item !== null &&
          "roleId" in item &&
          "score" in item &&
          "explanation" in item
        ) {
          const entry = item as { roleId: number; score: number; explanation: string };
          result.set(entry.roleId, {
            score: Math.min(100, Math.max(0, Math.round(Number(entry.score)))),
            explanation: String(entry.explanation).slice(0, 120),
          });
        }
      }
    }

    return result;
  } catch {
    const fallback = new Map<number, { score: number; explanation: string }>();
    for (const role of roles) {
      fallback.set(role.id, {
        score: role.sponsorshipOffered && profile.requiresSponsorship ? 60 : 45,
        explanation: "Match based on your profile and role requirements.",
      });
    }
    return fallback;
  }
}
