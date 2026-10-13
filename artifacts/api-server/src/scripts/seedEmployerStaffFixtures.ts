import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  employerMembershipsTable,
  employerProfilesTable,
  employerJobAssignmentsTable,
  jobListingsTable,
  pool,
  usersTable,
} from "@workspace/db";

type FixtureRole = "employer_admin" | "recruiter" | "hiring_manager" | "employer_viewer";

const STAFF_FIXTURES: Array<{ key: string; role: FixtureRole; firstName: string; lastName: string }> = [
  { key: "ADMIN", role: "employer_admin", firstName: "Fixture", lastName: "Admin" },
  { key: "RECRUITER", role: "recruiter", firstName: "Fixture", lastName: "Recruiter" },
  { key: "HIRING_MANAGER", role: "hiring_manager", firstName: "Fixture", lastName: "Hiring Manager" },
  { key: "VIEWER", role: "employer_viewer", firstName: "Fixture", lastName: "Viewer" },
];

function requiredEmail(name: string): string {
  const email = process.env[name]?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`${name} must be set to an existing development account email.`);
  }
  return email;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Employer staff fixtures are restricted to NODE_ENV=development.");
  }
  if (process.env.EMPLOYER_STAFF_FIXTURE_CONFIRM !== "YES") {
    throw new Error("Set EMPLOYER_STAFF_FIXTURE_CONFIRM=YES to confirm this development-only seed.");
  }

  const ownerEmail = requiredEmail("EMPLOYER_STAFF_FIXTURE_OWNER_EMAIL");
  const staffEmails = STAFF_FIXTURES.map(fixture => ({
    ...fixture,
    email: requiredEmail(`EMPLOYER_STAFF_FIXTURE_${fixture.key}_EMAIL`),
  }));
  if (new Set([ownerEmail, ...staffEmails.map(item => item.email)]).size !== 1 + staffEmails.length) {
    throw new Error("Use a different email address for each staff fixture.");
  }
  if (staffEmails.some(item => !item.email.endsWith("@example.test") && !item.email.endsWith("@jobsage.test"))) {
    throw new Error("Staff fixture accounts must use reserved @example.test or @jobsage.test addresses.");
  }

  const [owner] = await db.select({ id: usersTable.id })
    .from(usersTable).where(eq(usersTable.email, ownerEmail));
  if (!owner) throw new Error("The specified development owner account does not exist.");

  const [profile] = await db.select({
    id: employerProfilesTable.id,
    companyName: employerProfilesTable.companyName,
  }).from(employerProfilesTable).where(and(
    eq(employerProfilesTable.userId, owner.id),
    isNull(employerProfilesTable.deletedAt),
  ));
  if (!profile) throw new Error("The specified owner has no active employer organisation.");

  const members: Array<{ id: string; email: string; role: FixtureRole }> = [];
  for (const fixture of staffEmails) {
    await db.insert(usersTable).values({
      email: fixture.email,
      firstName: fixture.firstName,
      lastName: fixture.lastName,
      role: "candidate",
      emailVerified: true,
    }).onConflictDoNothing();
    const [user] = await db.select({ id: usersTable.id })
      .from(usersTable).where(eq(usersTable.email, fixture.email));
    if (!user) throw new Error(`Could not prepare development fixture account ${fixture.key}.`);
    members.push({ id: user.id, email: fixture.email, role: fixture.role });
  }

  await db.transaction(async tx => {
    await tx.insert(employerMembershipsTable).values({
      employerProfileId: profile.id,
      userId: owner.id,
      role: "employer_owner",
      status: "active",
    }).onConflictDoUpdate({
      target: [employerMembershipsTable.employerProfileId, employerMembershipsTable.userId],
      set: { role: "employer_owner", status: "active", updatedAt: new Date() },
    });

    for (const member of members) {
      await tx.insert(employerMembershipsTable).values({
        employerProfileId: profile.id,
        userId: member.id,
        role: member.role,
        status: "active",
        invitedByUserId: owner.id,
      }).onConflictDoNothing();
      const [membership] = await tx.select({
        role: employerMembershipsTable.role,
        status: employerMembershipsTable.status,
      }).from(employerMembershipsTable).where(and(
        eq(employerMembershipsTable.employerProfileId, profile.id),
        eq(employerMembershipsTable.userId, member.id),
      ));
      if (membership?.role !== member.role || membership.status !== "active") {
        throw new Error(`Existing membership conflicts with the ${member.role} fixture for ${member.email}.`);
      }
    }

    const fixtureTitle = "JOBSAGE development staff access fixture";
    let [job] = await tx.select({ id: jobListingsTable.id }).from(jobListingsTable).where(and(
      eq(jobListingsTable.employerProfileId, profile.id),
      eq(jobListingsTable.title, fixtureTitle),
    ));
    if (!job) {
      [job] = await tx.insert(jobListingsTable).values({
        employerProfileId: profile.id,
        title: fixtureTitle,
        specialty: "Development fixture",
        location: "London",
        sponsorshipOffered: false,
        requirements: "Synthetic fixture role for development testing only.",
        description: "Not a real vacancy. Created only to exercise employer staff access in development.",
        status: "draft",
        regulator: "GMC",
        requiredRegistration: "General Medical Council registration",
        targetProfessions: [],
        targetRegions: [],
      }).returning({ id: jobListingsTable.id });
    }
    if (!job) throw new Error("Could not prepare the development fixture job.");

    for (const member of members) {
      await tx.insert(employerJobAssignmentsTable).values({
        employerProfileId: profile.id,
        jobListingId: job.id,
        userId: member.id,
        assignedByUserId: owner.id,
      }).onConflictDoNothing();
    }
  });

  console.info(`Employer staff fixtures are ready for ${profile.companyName}. Fixture staff use reserved non-login email identities.`);
}

main()
  .catch(error => {
    console.error("Employer staff fixture setup failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
