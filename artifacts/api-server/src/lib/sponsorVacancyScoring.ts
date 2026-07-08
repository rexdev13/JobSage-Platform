import { db } from "@workspace/db";
import { profilesTable, sponsorLicenceVacancyScoresTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { batchScoreVacancies, type CandidateProfileForScoring, type VacancyForScoring } from "./sponsorVacancyMatch";

interface UnscoredVacancyRow {
  [key: string]: unknown;
  id: number;
  organisation_name: string;
  title: string;
  location: string | null;
  description: string | null;
}

function toProfileForScoring(profile: typeof profilesTable.$inferSelect): CandidateProfileForScoring {
  return {
    profession: profile.profession,
    specialty: profile.specialty,
    experienceYears: profile.experienceYears,
    qualificationCountry: profile.qualificationCountry,
    registrationStatus: profile.registrationStatus,
    requiresSponsorship: profile.requiresSponsorship,
  };
}

/**
 * Fully recalculate suitability scores for every vacancy against this candidate's
 * current profile and persist the results (upserting existing score rows). Called
 * after every check-all pass and by the daily sync, so scores stay in sync with
 * profile changes and re-runs of the AI scoring model — not just newly-seen vacancies.
 */
export async function rescoreVacanciesForUser(userId: string): Promise<{ scored: number }> {
  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId)).limit(1);
  if (!profile) return { scored: 0 };

  const allVacancies = await db.execute<UnscoredVacancyRow>(sql`
    SELECT v.id, v.organisation_name, v.title, v.location, v.description
    FROM sponsor_licence_vacancies v
  `);

  if (allVacancies.rows.length === 0) return { scored: 0 };

  const vacanciesForScoring: VacancyForScoring[] = allVacancies.rows.map((r) => ({
    id: r.id,
    title: r.title,
    organisationName: r.organisation_name,
    location: r.location,
    description: r.description,
  }));

  const profileForScoring = toProfileForScoring(profile);
  const scoreMap = await batchScoreVacancies(profileForScoring, vacanciesForScoring);

  await db
    .insert(sponsorLicenceVacancyScoresTable)
    .values(
      allVacancies.rows.map((r) => {
        const s = scoreMap.get(r.id);
        return {
          userId,
          vacancyId: r.id,
          organisationName: r.organisation_name,
          score: s?.score ?? 50,
          isEligible: s?.isEligible ?? false,
          missingRequirements: s?.missingRequirements ?? [],
          explanation: s?.explanation ?? "Match based on your profile and vacancy details.",
          scoredAt: new Date(),
        };
      }),
    )
    .onConflictDoUpdate({
      target: [sponsorLicenceVacancyScoresTable.userId, sponsorLicenceVacancyScoresTable.vacancyId],
      set: {
        organisationName: sql`excluded.organisation_name`,
        score: sql`excluded.score`,
        isEligible: sql`excluded.is_eligible`,
        missingRequirements: sql`excluded.missing_requirements`,
        explanation: sql`excluded.explanation`,
        scoredAt: sql`excluded.scored_at`,
      },
    });

  return { scored: allVacancies.rows.length };
}

/**
 * Rescore vacancies for every candidate with a profile.
 * Used by the daily scheduled job after a full vacancy check pass.
 */
export async function rescoreVacanciesForAllUsers(): Promise<{ usersProcessed: number; totalScored: number }> {
  const users = await db.selectDistinct({ userId: profilesTable.userId }).from(profilesTable);

  let totalScored = 0;
  for (const u of users) {
    try {
      const { scored } = await rescoreVacanciesForUser(u.userId);
      totalScored += scored;
    } catch (err) {
      console.error(`[sponsor-vacancy-scoring] Failed to rescore for user ${u.userId}:`, err instanceof Error ? err.message : err);
    }
  }

  return { usersProcessed: users.length, totalScored };
}
