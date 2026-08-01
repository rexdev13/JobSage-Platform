import { openai } from "@workspace/integrations-openai-ai-server";

export interface VacancyForScoring {
  id: number;
  title: string;
  organisationName: string;
  location: string | null;
  description: string | null;
}

export interface CandidateProfileForScoring {
  profession: string;
  specialty: string;
  experienceYears: number;
  qualificationCountry: string;
  registrationStatus: string;
  requiresSponsorship: boolean;
}

export interface VacancyScoreResult {
  score: number;
  isEligible: boolean;
  missingRequirements: string[];
  explanation: string;
}

const BATCH_SIZE = 40;

function fallbackScore(profile: CandidateProfileForScoring): VacancyScoreResult {
  return {
    score: profile.requiresSponsorship ? 45 : 55,
    isEligible: !profile.requiresSponsorship,
    missingRequirements: [],
    explanation: "Match based on your profile and vacancy details.",
  };
}

async function scoreSingleBatch(
  profile: CandidateProfileForScoring,
  vacancies: VacancyForScoring[],
): Promise<Map<number, VacancyScoreResult>> {
  const profileText = [
    `Profession: ${profile.profession.replace(/_/g, " ")}`,
    `Specialty: ${profile.specialty}`,
    `Experience: ${profile.experienceYears} years`,
    `Qualification country: ${profile.qualificationCountry}`,
    `Registration status: ${profile.registrationStatus}`,
    `Requires visa sponsorship: ${profile.requiresSponsorship ? "Yes" : "No"}`,
  ].join("\n");

  const vacancyLines = vacancies
    .map((v) => {
      const desc = (v.description ?? "").slice(0, 300);
      return `${v.id}: "${v.title}" at ${v.organisationName}, ${v.location ?? "UK"} — ${desc}`;
    })
    .join("\n");

  const prompt = `You are a UK healthcare recruitment AI. Score how well this candidate matches each vacancy at a UK Home Office licensed sponsor.

Candidate Profile:
${profileText}

For each vacancy, determine:
- score: 0-100 suitability based on specialty alignment, experience level, registration requirement, and sponsorship need.
- isEligible: true if the candidate plausibly meets the role's requirements (registration, experience, sponsorship route), false otherwise.
- missingRequirements: short array of specific gaps (e.g. "NMC registration required", "5+ years experience needed"). Empty array if none.
- explanation: one short sentence (max 90 characters).

Vacancies:
${vacancyLines}

Return ONLY valid JSON:
{"scores":[{"vacancyId":<integer>,"score":<0-100>,"isEligible":<boolean>,"missingRequirements":["<string>"],"explanation":"<string>"}]}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: Math.min(8000, vacancies.length * 120 + 300),
    temperature: 0.2,
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { scores?: unknown[] };
  const result = new Map<number, VacancyScoreResult>();

  if (Array.isArray(parsed.scores)) {
    for (const item of parsed.scores) {
      if (
        typeof item === "object" &&
        item !== null &&
        "vacancyId" in item &&
        "score" in item
      ) {
        const entry = item as {
          vacancyId: number;
          score: number;
          isEligible?: boolean;
          missingRequirements?: unknown[];
          explanation?: string;
        };
        result.set(entry.vacancyId, {
          score: Math.min(100, Math.max(0, Math.round(Number(entry.score)))),
          isEligible: entry.isEligible === true,
          missingRequirements: Array.isArray(entry.missingRequirements)
            ? entry.missingRequirements.filter((r): r is string => typeof r === "string").slice(0, 6)
            : [],
          explanation: typeof entry.explanation === "string" ? entry.explanation.slice(0, 120) : "",
        });
      }
    }
  }

  return result;
}

export async function batchScoreVacancies(
  profile: CandidateProfileForScoring,
  vacancies: VacancyForScoring[],
): Promise<Map<number, VacancyScoreResult>> {
  if (vacancies.length === 0) return new Map();

  const chunks: VacancyForScoring[][] = [];
  for (let i = 0; i < vacancies.length; i += BATCH_SIZE) {
    chunks.push(vacancies.slice(i, i + BATCH_SIZE));
  }

  const merged = new Map<number, VacancyScoreResult>();

  for (const chunk of chunks) {
    try {
      const chunkMap = await scoreSingleBatch(profile, chunk);
      for (const v of chunk) {
        merged.set(v.id, chunkMap.get(v.id) ?? fallbackScore(profile));
      }
    } catch (err) {
      console.warn("[sponsor-vacancy-match] Batch scoring failed, using fallback:", err instanceof Error ? err.message : err);
      for (const v of chunk) {
        merged.set(v.id, fallbackScore(profile));
      }
    }
  }

  return merged;
}
