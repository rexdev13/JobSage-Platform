import { db } from "@workspace/db";
import { profilesTable, sponsorLicenceVacancyScoresTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { batchScoreVacancies, type CandidateProfileForScoring, type VacancyForScoring } from "./sponsorVacancyMatch";

interface UnscoredVacancyRow {
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
 * Score any vacancies not yet scored for this user and persist results.
 * Safe to call repeatedly — only scores the delta since the last run.
 */
export async function rescoreVacanciesForUser(userId: string): Promise<{ scored: number }> {
  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId)).limit(1);
  if (!profile) return { scored: 0 };

  const unscored = await db.execute<UnscoredVacancyRow>(sql`
    SELECT v.id, v.organisation_name, v.title, v.location, v.description
    FROM sponsor_licence_vacancies v
    LEFT JOIN sponsor_licence_vacancy_scores s
      ON s.vacancy_id = v.id AND s.user_id = ${userId}
    WHERE s.id IS NULL
  `);

  if (unscored.rows.length === 0) return { scored: 0 };

  const vacanciesForScoring: VacancyForScoring[] = unscored.rows.map((r) => ({
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
      unscored.rows.map((r) => {
        const s = scoreMap.get(r.id);
        return {
          userId,
          vacancyId: r.id,
          organisationName: r.organisation_name,
          score: s?.score ?? 50,
          isEligible: s?.isEligible ?? false,
          missingRequirements: s?.missingRequirements ?? [],
          explanation: s?.explanation ?? "Match based on your profile and vacancy details.",
        };
      }),
    )
    .onConflictDoNothing();

  return { scored: unscored.rows.length };
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
