import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "@workspace/db";

type GlobalRole = "candidate" | "employer" | "moderator" | "admin" | "super_admin";
type StaffRole = "employer_admin" | "recruiter" | "hiring_manager" | "employer_viewer";

const fixtureUsers: Array<{
  key: string;
  email: string;
  firstName: string;
  lastName: string;
  role: GlobalRole;
  staffRole?: StaffRole;
}> = [
  { key: "candidate", email: "validation.candidate@jobsage.test", firstName: "Synthetic", lastName: "Candidate", role: "candidate" },
  { key: "employer_owner", email: "validation.employer@jobsage.test", firstName: "Synthetic", lastName: "Employer", role: "employer" },
  { key: "employer_admin", email: "validation.staff.admin@jobsage.test", firstName: "Synthetic", lastName: "Staff Admin", role: "candidate", staffRole: "employer_admin" },
  { key: "recruiter", email: "validation.staff.recruiter@jobsage.test", firstName: "Synthetic", lastName: "Recruiter", role: "candidate", staffRole: "recruiter" },
  { key: "hiring_manager", email: "validation.staff.hiring-manager@jobsage.test", firstName: "Synthetic", lastName: "Hiring Manager", role: "candidate", staffRole: "hiring_manager" },
  { key: "employer_viewer", email: "validation.staff.viewer@jobsage.test", firstName: "Synthetic", lastName: "Viewer", role: "candidate", staffRole: "employer_viewer" },
  { key: "moderator", email: "validation.moderator@jobsage.test", firstName: "Synthetic", lastName: "Moderator", role: "moderator" },
  { key: "admin", email: "validation.admin@jobsage.test", firstName: "Synthetic", lastName: "Admin", role: "admin" },
  { key: "super_admin", email: "validation.super-admin@jobsage.test", firstName: "Synthetic", lastName: "Super Admin", role: "super_admin" },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Validation fixtures may only be seeded with NODE_ENV=development.");
  }
  if (fixtureUsers.some(user => !user.email.endsWith("@jobsage.test"))) {
    throw new Error("All validation accounts must use the reserved @jobsage.test domain.");
  }

  const target = await pool.query<{
    database_name: string;
    database_role: string;
    server_version: string;
  }>(
    "SELECT current_database() AS database_name, current_user AS database_role, current_setting('server_version') AS server_version",
  );
  const connection = target.rows[0];
  if (
    connection?.database_name !== "heliumdb"
    || connection.database_role !== "postgres"
    || !connection.server_version.startsWith("16.")
  ) {
    throw new Error("Refusing to seed: the database identity does not match the confirmed development target.");
  }

  const newCredentials: Array<{ role: string; email: string; password: string }> = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userIds = new Map<string, string>();
    for (const fixture of fixtureUsers) {
      const existing = await client.query<{
        id: string;
        role: string;
        has_password: boolean;
        email_verified: boolean;
        suspended_at: Date | null;
      }>(
        `SELECT id, role, password_hash IS NOT NULL AS has_password,
                email_verified, suspended_at
         FROM users WHERE email = $1`,
        [fixture.email],
      );
      const current = existing.rows[0];
      if (current) {
        if (
          current.role !== fixture.role
          || !current.has_password
          || !current.email_verified
          || current.suspended_at
        ) {
          throw new Error(`Existing ${fixture.key} account is not a ready validation fixture; refusing to modify it.`);
        }
        userIds.set(fixture.key, current.id);
        continue;
      }

      const password = randomBytes(24).toString("base64url");
      const passwordHash = await bcrypt.hash(password, 12);
      const result = await client.query<{ id: string }>(
        `INSERT INTO users (email, first_name, last_name, role, password_hash, email_verified)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [fixture.email, fixture.firstName, fixture.lastName, fixture.role, passwordHash],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error(`Could not create missing ${fixture.key} fixture account.`);
      userIds.set(fixture.key, id);
      newCredentials.push({ role: fixture.key, email: fixture.email, password });
    }

    const candidateId = userIds.get("candidate")!;
    for (const fixture of fixtureUsers.filter(user => user.role !== "employer")) {
      await client.query(
      `INSERT INTO profiles (
         user_id, profession, specialty, qualification_country, qualification_type,
         qualification_year, experience_years, registration_status, licence_ready,
         dbs_clearance_level, safeguarding_training_level, residency_status,
         requires_sponsorship, preferred_region, alert_frequency, languages, country,
         additional_notes, updated_at
       ) VALUES (
         $1, 'nurse', 'general nursing', 'Nigeria', 'BSc Nursing', 2020, 5,
         'registered', true, 'unknown', 'unknown', 'requires_sponsorship',
         true, ARRAY['London']::text[], 'off', ARRAY['English']::text[], 'Nigeria',
         'Synthetic owner-independent validation fixture.', now()
       )
       ON CONFLICT (user_id) DO NOTHING`,
      [userIds.get(fixture.key)],
      );
    }

    const employerId = userIds.get("employer_owner")!;
    await client.query(
      `INSERT INTO employer_profiles (user_id, company_name, industry, region, contact_email, contact_website)
       VALUES ($1, 'JOBSAGE Synthetic Validation Clinic', 'private_healthcare', 'London',
               'validation.employer@jobsage.test', 'https://example.test/jobsage-validation')
       ON CONFLICT (user_id) DO NOTHING`,
      [employerId],
    );
    const profileResult = await client.query<{ id: number; deleted_at: Date | null }>(
      "SELECT id, deleted_at FROM employer_profiles WHERE user_id = $1",
      [employerId],
    );
    const employerProfile = profileResult.rows[0];
    if (!employerProfile || employerProfile.deleted_at) {
      throw new Error("The synthetic employer fixture has no active organization; refusing to restore or replace it.");
    }

    await client.query(
      `INSERT INTO employer_memberships (employer_profile_id, user_id, role, status)
       VALUES ($1, $2, 'employer_owner', 'active')
       ON CONFLICT (employer_profile_id, user_id) DO NOTHING`,
      [employerProfile.id, employerId],
    );

    const existingJob = await client.query<{ id: number }>(
      "SELECT id FROM job_listings WHERE employer_profile_id = $1 AND title = $2 LIMIT 1",
      [employerProfile.id, "JOBSAGE synthetic validation vacancy"],
    );
    let jobId = existingJob.rows[0]?.id;
    if (!jobId) {
      const jobResult = await client.query<{ id: number }>(
      `INSERT INTO job_listings (
         employer_profile_id, title, specialty, location, sponsorship_offered, requirements,
         description, status, regulator, required_registration, target_professions,
         target_regions, liveness
       ) VALUES (
         $1, 'JOBSAGE synthetic validation vacancy', 'general nursing', 'London',
         false, 'Synthetic development-only role; not a real vacancy.',
         'Fixture for candidate, employer, and staff access validation only.',
         'published', 'NMC', 'Nursing and Midwifery Council registration',
         $2::jsonb, $3::jsonb, 'unverified'
       )
       RETURNING id`,
      [employerProfile.id, JSON.stringify(["nurse"]), JSON.stringify(["London"])],
      );
      jobId = jobResult.rows[0]?.id;
    }
    if (!jobId) throw new Error("Could not prepare the synthetic validation vacancy.");

    for (const fixture of fixtureUsers.filter(user => user.staffRole)) {
      const staffId = userIds.get(fixture.key)!;
      await client.query(
        `INSERT INTO employer_memberships (employer_profile_id, user_id, role, status, invited_by_user_id)
         VALUES ($1, $2, $3, 'active', $4)
         ON CONFLICT (employer_profile_id, user_id) DO NOTHING`,
        [employerProfile.id, staffId, fixture.staffRole, employerId],
      );
      const membership = await client.query<{ role: string; status: string }>(
        "SELECT role, status FROM employer_memberships WHERE employer_profile_id = $1 AND user_id = $2",
        [employerProfile.id, staffId],
      );
      if (membership.rows[0]?.role !== fixture.staffRole || membership.rows[0]?.status !== "active") {
        throw new Error(`Existing membership conflicts with the ${fixture.staffRole} validation fixture.`);
      }
      await client.query(
        `INSERT INTO employer_job_assignments (employer_profile_id, job_listing_id, user_id, assigned_by_user_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (job_listing_id, user_id) DO NOTHING`,
        [employerProfile.id, jobId, staffId, employerId],
      );
    }

    const applicationRoleId = jobId + 1_000_000;
    const existingApplication = await client.query<{ id: number }>(
      "SELECT id FROM applications WHERE user_id = $1 AND role_id = $2 ORDER BY id LIMIT 1",
      [candidateId, applicationRoleId],
    );
    if (!existingApplication.rows[0]) {
      await client.query(
        `INSERT INTO applications (user_id, role_id, application_type, company_name, job_title, status, notes)
         VALUES ($1, $2, 'platform', $3, $4, 'applied', $5)`,
        [
          candidateId,
          applicationRoleId,
          "JOBSAGE Synthetic Validation Clinic",
          "JOBSAGE synthetic validation vacancy",
          "Synthetic owner-independent validation fixture.",
        ],
      );
    }

    await client.query(
      `INSERT INTO support_tickets (
         ticket_id, name, email, category, subject, message, user_id, is_content_report,
         reported_content_type, reported_content_id, status, severity, moderation_decision,
         assigned_moderator_id, reviewed_by, reviewed_at, escalated_at, admin_notes, updated_at
       ) VALUES (
         'VLDTEST000001', 'Synthetic Candidate', 'validation.candidate@jobsage.test',
         'Other', 'Development-only moderation fixture',
         'Synthetic report used only to validate the moderator journey.',
         $1, true, 'other', 'validation-fixture-01', 'new', 'normal', 'pending',
         NULL, NULL, NULL, NULL, NULL, now()
       )
       ON CONFLICT (ticket_id) DO NOTHING`,
      [candidateId],
    );

    await client.query("COMMIT");
    console.log(JSON.stringify({
      target: "development",
      organization: "JOBSAGE Synthetic Validation Clinic",
      vacancy: "JOBSAGE synthetic validation vacancy",
      report: "VLDTEST000001",
      createdCredentials: newCredentials,
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error("Validation fixture setup failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
