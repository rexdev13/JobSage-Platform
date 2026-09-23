import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import {
  consentLogsTable,
  db,
  profilesTable,
  usersTable,
} from "@workspace/db";

const email = process.env.K6_TEST_EMAIL?.trim().toLowerCase();
const password = process.env.K6_TEST_PASSWORD;

if (!email || !password) {
  throw new Error("K6_TEST_EMAIL and K6_TEST_PASSWORD are required.");
}
if (!email.endsWith("@example.test") && !email.endsWith("@jobsage.test")) {
  throw new Error(
    "The k6 fixture email must use the reserved @example.test or @jobsage.test domain.",
  );
}
if (password.length < 12) {
  throw new Error("K6_TEST_PASSWORD must be at least 12 characters.");
}

const passwordHash = await bcrypt.hash(password, 12);
const [user] = await db
  .insert(usersTable)
  .values({
    email,
    passwordHash,
    emailVerified: true,
    role: "candidate",
    firstName: "Synthetic",
    lastName: "Load User",
  })
  .onConflictDoUpdate({
    target: usersTable.email,
    set: {
      passwordHash,
      emailVerified: true,
      role: "candidate",
      firstName: "Synthetic",
      lastName: "Load User",
      updatedAt: new Date(),
    },
  })
  .returning({ id: usersTable.id });

if (!user) {
  throw new Error("Unable to create the synthetic k6 user.");
}

const profileValues = {
  userId: user.id,
  profession: "nurse",
  specialty: "general nursing",
  qualificationCountry: "Nigeria",
  qualificationType: "BSc Nursing",
  qualificationYear: 2020,
  experienceYears: 5,
  registrationStatus: "registered" as const,
  licenceReady: true,
  dbsClearanceLevel: "unknown" as const,
  safeguardingTrainingLevel: "unknown" as const,
  residencyStatus: "requires_sponsorship",
  requiresSponsorship: true,
  preferredRegion: ["London"] as unknown as string[],
  alertFrequency: "off" as const,
  languages: ["English"] as unknown as string[],
  additionalNotes: "Synthetic k6 load-test fixture. Not a real candidate.",
  country: "Nigeria",
};

await db
  .insert(profilesTable)
  .values(profileValues)
  .onConflictDoUpdate({
    target: profilesTable.userId,
    set: {
      ...profileValues,
      updatedAt: new Date(),
    },
  });

const [existingConsent] = await db
  .select({ id: consentLogsTable.id })
  .from(consentLogsTable)
  .where(
    and(
      eq(consentLogsTable.userId, user.id),
      eq(consentLogsTable.termsVersion, "k6-test-v1"),
    ),
  )
  .limit(1);

if (!existingConsent) {
  await db.insert(consentLogsTable).values({
    userId: user.id,
    termsVersion: "k6-test-v1",
    ipHash: "k6-synthetic-fixture",
  });
}

console.log(`Prepared synthetic k6 fixture: ${email}`);