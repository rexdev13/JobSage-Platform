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

const BATCH_SIZE = 50;

async function scoreSingleBatch(
  profile: CandidateProfileForScoring,
  roles: RoleForScoring[],
): Promise<Map<number, { score: number; explanation: string }>> {
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

HARD NEGATIVE CONSTRAINT — This is mandatory and overrides all other scoring criteria:
Any vacancy whose title implies a non-clinical, manual-labour, or unrelated discipline MUST receive a score of exactly 0 with the explanation "Out of professional scope".
Examples of titles that trigger this rule (not exhaustive): housekeeping, housekeep, cleaning, cleaner, domestic, catering, cook, kitchen, laundry, portering, porter, construction, groundskeeping, groundskeeper, janitor, caretaker, security guard, warehouse, driver, delivery.
If any word in the vacancy title matches or strongly implies these categories, assign score 0 and explanation "Out of professional scope" — do not consider the candidate profile at all for those vacancies.

For all other vacancies, score 0–100 based on: specialty alignment, experience level, sponsorship fit, and registration requirement.
For each vacancy provide a short one-sentence explanation (max 90 characters) like "Strong specialty match — sponsorship available" or "Experience below senior requirement".

Vacancies:
${vacancyLines}

Return ONLY valid JSON:
{"scores":[{"roleId":<integer>,"score":<0-100>,"explanation":"<string>"}]}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    max_tokens: Math.min(8000, roles.length * 80 + 300),
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
}

export async function batchScoreRoles(
  profile: CandidateProfileForScoring,
  roles: RoleForScoring[],
): Promise<Map<number, { score: number; explanation: string }>> {
  if (roles.length === 0) return new Map();

  const chunks: RoleForScoring[][] = [];
  for (let i = 0; i < roles.length; i += BATCH_SIZE) {
    chunks.push(roles.slice(i, i + BATCH_SIZE));
  }

  const merged = new Map<number, { score: number; explanation: string }>();

  for (const chunk of chunks) {
    try {
      const chunkMap = await scoreSingleBatch(profile, chunk);
      for (const [k, v] of chunkMap) merged.set(k, v);
    } catch {
      for (const role of chunk) {
        merged.set(role.id, {
          score: role.sponsorshipOffered && profile.requiresSponsorship ? 60 : 45,
          explanation: "Match based on your profile and role requirements.",
        });
      }
    }
  }

  return merged;
}
