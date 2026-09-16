import { db } from "@workspace/db";
import {
  candidateMatchScoresTable,
  rolesTable,
  sponsorLicencesTable,
  usersTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

export const TEST_EMAIL_ORGANISATION_NAME = "Test JobSage Email";
export const TEST_EMAIL_RECIPIENT = "ifeo55394@gmail.com";
export const TEST_EMAIL_APPLY_URL = "https://jobsage.co.uk/opportunities";
export const TEST_EMAIL_SCORE_EXPLANATION =
  "Live Send CV proof vacancy: persisted candidate score for the NMC London healthcare test role.";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function upsertSponsorLicence(tx: DatabaseTransaction): Promise<number> {
  const [existing] = await tx
    .select({ id: sponsorLicencesTable.id })
    .from(sponsorLicencesTable)
    .where(eq(sponsorLicencesTable.organisationName, TEST_EMAIL_ORGANISATION_NAME))
    .limit(1);

  const values = {
    organisationName: TEST_EMAIL_ORGANISATION_NAME,
    contactEmail: TEST_EMAIL_RECIPIENT,
    townCity: "London",
    industry: "Healthcare",
    rating: "Worker (A rating)",
    region: "London",
    route: "Worker",
    syncedAt: new Date(),
  };

  if (existing) {
    const [updated] = await tx
      .update(sponsorLicencesTable)
      .set(values)
      .where(eq(sponsorLicencesTable.id, existing.id))
      .returning({ id: sponsorLicencesTable.id });
    return updated!.id;
  }

  const [inserted] = await tx
    .insert(sponsorLicencesTable)
    .values(values)
    .returning({ id: sponsorLicencesTable.id });
  return inserted!.id;
}

async function upsertRole(tx: DatabaseTransaction): Promise<number> {
  const [existing] = await tx
    .select({ id: rolesTable.id })
    .from(rolesTable)
    .where(
      and(
        eq(rolesTable.title, TEST_EMAIL_ORGANISATION_NAME),
        eq(rolesTable.employer, TEST_EMAIL_ORGANISATION_NAME),
      ),
    )
    .limit(1);

  const now = new Date();
  const values = {
    title: TEST_EMAIL_ORGANISATION_NAME,
    employer: TEST_EMAIL_ORGANISATION_NAME,
    location: "London, UK",
    regulator: "NMC" as const,
    sponsorshipOffered: true,
    requiredRegistration: "Active registration",
    active: true,
    targetRegions: ["London"],
    applyUrl: TEST_EMAIL_APPLY_URL,
    contactEmail: TEST_EMAIL_RECIPIENT,
    importedBy: "seed:send-cv-proof",
    importedAt: now,
    liveness: "live" as const,
    lastVerifiedAt: now,
    livenessReason: "Seeded live proof vacancy",
  };

  if (existing) {
    const [updated] = await tx
      .update(rolesTable)
      .set(values)
      .where(eq(rolesTable.id, existing.id))
      .returning({ id: rolesTable.id });
    return updated!.id;
  }

  const [inserted] = await tx
    .insert(rolesTable)
    .values(values)
    .returning({ id: rolesTable.id });
  return inserted!.id;
}

async function resolveCandidateId(
  tx: DatabaseTransaction,
  candidateUserId?: string | null,
  candidateEmail?: string | null,
): Promise<string | null> {
  if (candidateUserId && candidateEmail) {
    throw new Error("Use either candidateUserId or candidateEmail, not both.");
  }
  if (candidateUserId) return candidateUserId;
  if (!candidateEmail) return null;

  const [user] = await tx
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, candidateEmail))
    .limit(1);
  if (!user) throw new Error("No user was found for candidateEmail.");
  return user.id;
}

async function upsertCandidateScore(
  tx: DatabaseTransaction,
  userId: string,
  roleId: number,
): Promise<void> {
  const [existing] = await tx
    .select({ id: candidateMatchScoresTable.id })
    .from(candidateMatchScoresTable)
    .where(
      and(
        eq(candidateMatchScoresTable.userId, userId),
        eq(candidateMatchScoresTable.roleId, roleId),
      ),
    )
    .limit(1);

  const values = {
    userId,
    roleId,
    score: 100,
    aiExplanation: TEST_EMAIL_SCORE_EXPLANATION,
    scoredAt: new Date(),
  };

  if (existing) {
    await tx
      .update(candidateMatchScoresTable)
      .set(values)
      .where(eq(candidateMatchScoresTable.id, existing.id));
    return;
  }
  await tx.insert(candidateMatchScoresTable).values(values);
}

export interface SeedTestEmailVacancyOptions {
  candidateUserId?: string | null;
  candidateEmail?: string | null;
}

export interface SeedTestEmailVacancyResult {
  sponsorLicenceId: number;
  roleId: number;
  candidateUserId: string | null;
}

export async function seedTestEmailVacancy(
  options: SeedTestEmailVacancyOptions = {},
): Promise<SeedTestEmailVacancyResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('seed:send-cv-proof'))`);
    const sponsorLicenceId = await upsertSponsorLicence(tx);
    const roleId = await upsertRole(tx);
    const candidateUserId = await resolveCandidateId(
      tx,
      options.candidateUserId,
      options.candidateEmail,
    );
    if (candidateUserId) await upsertCandidateScore(tx, candidateUserId, roleId);
    return { sponsorLicenceId, roleId, candidateUserId };
  });
}