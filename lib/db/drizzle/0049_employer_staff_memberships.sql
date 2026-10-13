ALTER TABLE employer_profiles
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS employer_memberships (
  id serial PRIMARY KEY,
  employer_profile_id integer NOT NULL REFERENCES employer_profiles(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar NOT NULL CHECK (role IN ('employer_owner','employer_admin','recruiter','hiring_manager','employer_viewer')),
  status varchar NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','removed')),
  invited_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employer_memberships_profile_user_unique UNIQUE (employer_profile_id, user_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS employer_memberships_user_status_idx ON employer_memberships(user_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS employer_memberships_profile_status_idx ON employer_memberships(employer_profile_id, status);
--> statement-breakpoint
INSERT INTO employer_memberships (employer_profile_id, user_id, role, status)
SELECT ep.id, ep.user_id, 'employer_owner', 'active'
FROM employer_profiles ep
JOIN users u ON u.id = ep.user_id
ON CONFLICT (employer_profile_id, user_id) DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS employer_invitations (
  id serial PRIMARY KEY,
  employer_profile_id integer NOT NULL REFERENCES employer_profiles(id) ON DELETE CASCADE,
  email varchar(254) NOT NULL,
  role varchar NOT NULL CHECK (role IN ('employer_admin','recruiter','hiring_manager','employer_viewer')),
  token_hash varchar(64) NOT NULL UNIQUE,
  invited_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  declined_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS employer_invitations_profile_created_idx ON employer_invitations(employer_profile_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS employer_invitations_email_idx ON employer_invitations(email);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS job_listings_id_employer_profile_unique ON job_listings(id, employer_profile_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS employer_job_assignments (
  id serial PRIMARY KEY,
  employer_profile_id integer NOT NULL REFERENCES employer_profiles(id) ON DELETE CASCADE,
  job_listing_id integer NOT NULL,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employer_job_assignments_job_org_fk
    FOREIGN KEY (job_listing_id, employer_profile_id)
    REFERENCES job_listings(id, employer_profile_id) ON DELETE CASCADE,
  CONSTRAINT employer_job_assignments_job_user_unique UNIQUE (job_listing_id, user_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS employer_job_assignments_org_user_idx ON employer_job_assignments(employer_profile_id, user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS employer_candidate_feedback (
  id serial PRIMARY KEY,
  employer_profile_id integer NOT NULL REFERENCES employer_profiles(id) ON DELETE CASCADE,
  job_listing_id integer NOT NULL,
  application_id integer NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  author_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feedback text NOT NULL CHECK (length(btrim(feedback)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employer_candidate_feedback_job_org_fk
    FOREIGN KEY (job_listing_id, employer_profile_id)
    REFERENCES job_listings(id, employer_profile_id) ON DELETE CASCADE,
  CONSTRAINT employer_candidate_feedback_application_author_unique UNIQUE (application_id, author_user_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS employer_candidate_feedback_org_job_idx ON employer_candidate_feedback(employer_profile_id, job_listing_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS employer_interview_participants (
  id serial PRIMARY KEY,
  employer_profile_id integer NOT NULL REFERENCES employer_profiles(id) ON DELETE CASCADE,
  job_listing_id integer NOT NULL,
  application_id integer NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  status varchar NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','accepted','declined','removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employer_interview_participants_job_org_fk
    FOREIGN KEY (job_listing_id, employer_profile_id)
    REFERENCES job_listings(id, employer_profile_id) ON DELETE CASCADE,
  CONSTRAINT employer_interview_participants_application_user_unique UNIQUE (application_id, user_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS employer_interview_participants_org_job_idx ON employer_interview_participants(employer_profile_id, job_listing_id);
