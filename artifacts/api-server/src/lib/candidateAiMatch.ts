import { openai } from "@workspace/integrations-openai-ai-server";
import { isManualLabourTitle } from "./vacancyTitlePolicy";
import {
  categoryForStatutoryRegulator,
  opportunityCategoriesMatch,
  professionCategoryFor,
  type OpportunityCategory,
} from "./professionCategory";

export interface RoleForScoring {
  id: number;
  title: string;
  employer: string;
  location: string;
  regulator: string | null;
  opportunityCategory?: OpportunityCategory | string | null;
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
const AI_REQUEST_TIMEOUT_MS = 6_000;

export class CandidateMatchScoringError extends Error {
  constructor(
    readonly partialScores: Map<number, { score: number; explanation: string }>,
    readonly failedRoleIds: number[],
  ) {
    super("One or more candidate match scores could not be produced.");
    this.name = "CandidateMatchScoringError";
  }
}

async function scoreSingleBatch(
  profile: CandidateProfileForScoring,
  roles: RoleForScoring[],
): Promise<Map<number, { score: number; explanation: string }>> {
  const profileText = [
    `Profession: ${profile.profession.replace(/_/g, " ")}`,
    `Opportunity category: ${professionCategoryFor(profile.profession) ?? "UNKNOWN"}`,
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

  const prompt = `You are a UK professional recruitment AI. Score how well this candidate matches each vacancy.

Candidate Profile:
${profileText}

HARD NEGATIVE CONSTRAINT — This is mandatory and overrides all other scoring criteria:
Any genuinely manual-labour vacancy or vacancy unrelated to THIS candidate's profession category MUST receive a score of exactly 0 with the explanation "Out of professional scope".
Professional roles such as accountant, software engineer, construction engineer, and clinical research administrator are not globally out of scope. Judge them relative to the candidate category.

For all other vacancies, score 0–100 based on: specialty alignment, experience level, sponsorship fit, and registration requirement.
For each vacancy provide a short one-sentence explanation (max 90 characters) like "Strong specialty match — sponsorship available" or "Experience below senior requirement".

Vacancies:
${vacancyLines}

Return ONLY valid JSON:
{"scores":[{"roleId":<integer>,"score":<0-100>,"explanation":"<string>"}]}`;

  const response = await openai.chat.completions.create(
    {
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: Math.min(8000, roles.length * 80 + 300),
      temperature: 0.2,
      response_format: { type: "json_object" },
    },
    { timeout: AI_REQUEST_TIMEOUT_MS, maxRetries: 0 },
  );

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
        const score = Number(entry.score);
        if (
          !Number.isInteger(entry.roleId) ||
          !roles.some((role) => role.id === entry.roleId) ||
          !Number.isFinite(score) ||
          typeof entry.explanation !== "string"
        ) {
          continue;
        }
        result.set(entry.roleId, {
          score: Math.min(100, Math.max(0, Math.round(score))),
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

  const merged = new Map<number, { score: number; explanation: string }>();
  const rolesForAi: RoleForScoring[] = [];
  const candidateCategory = professionCategoryFor(profile.profession);
  for (const role of roles) {
    const roleCategory =
      role.opportunityCategory ??
      categoryForStatutoryRegulator(role.regulator) ??
      (professionCategoryFor(role.regulator) as OpportunityCategory | null);
    if (
      isManualLabourTitle(role.title) ||
      (candidateCategory !== null &&
        roleCategory !== null &&
        !opportunityCategoriesMatch(candidateCategory, roleCategory))
    ) {
      merged.set(role.id, { score: 0, explanation: "Out of professional scope" });
    } else {
      rolesForAi.push(role);
    }
  }

  const chunks: RoleForScoring[][] = [];
  for (let i = 0; i < rolesForAi.length; i += BATCH_SIZE) {
    chunks.push(rolesForAi.slice(i, i + BATCH_SIZE));
  }

  const failedRoleIds: number[] = [];
  for (const chunk of chunks) {
    try {
      const chunkMap = await scoreSingleBatch(profile, chunk);
      for (const [k, v] of chunkMap) merged.set(k, v);
      failedRoleIds.push(...chunk.filter((role) => !chunkMap.has(role.id)).map((role) => role.id));
    } catch {
      failedRoleIds.push(...chunk.map((role) => role.id));
    }
  }

  if (failedRoleIds.length > 0) {
    throw new CandidateMatchScoringError(
      merged,
      [...new Set(failedRoleIds)],
    );
  }

  return merged;
}
