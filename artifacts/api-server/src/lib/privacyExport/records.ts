import { sql, type SQL } from "drizzle-orm";
import { ExportUnavailable, MAX_EXPORT_BYTES } from "./archive";

/** Static reviewed projections; never SELECT *, dynamically inferred fields, or caller-owned predicates. */
export const PERSONAL_RECORDS = [
  ["account", "users", "id", "email first_name last_name role plan subscription_expires_at email_verified jobsage_email google_calendar_account_email google_calendar_connected_at google_booking_timezone created_at updated_at"],
  ["professional_profile", "profiles", "user_id", "profession sector specialty qualification_country qualification_type qualification_year experience_years registration_status licence_ready dbs_clearance_level safeguarding_training_level residency_status requires_sponsorship preferred_region alert_frequency boost_profile preferred_start_date languages additional_notes application_motivation application_strengths notice_period start_availability phone street_address city postcode country jobsage_email created_at updated_at"],
  ["career_profiles", "career_profiles", "user_id", "id name focus_area ai_cv_content ai_cv_reviewed_at is_active created_at updated_at"],
  ["applications", "applications", "user_id", "id role_id application_type application_url company_name job_title status applied_at notes interview_date interview_notes cv_document_id jobsage_email"],
  ["cv_outreach", "speculative_applications", "user_id", "id company_name status notes cv_document_id cover_letter_document_id cover_letter_filename cover_letter_included vacancy_ref role_id vacancy_url source_type board_name email_sent email_sent_at email_recipient jobsage_email vacancy_title delivery_status created_at"],
  ["smart_apply_drafts", "smart_apply_drafts", "user_id", "id role_id answers updated_at"],
  ["saved_vacancies", "vacancy_favorites", "user_id", "id vacancy_id created_at"],
  ["inbox", "candidate_messages", "recipient_user_id", "id vacancy_id application_id message_type message_text subject is_read archived_at created_at company_name sender_email"],
  ["blocked_senders", "message_sender_blocks", "user_id", "id sender_key sender_label created_at"],
  ["support_requests", "support_tickets", "user_id", "ticket_id name email category subject message status created_at updated_at"],
  ["consent", "consent_logs", "user_id", "terms_version consented_at"],
  ["privacy_choices", "privacy_preferences", "user_id", "marketing optional_analytics notifications updated_at"],
  ["identity_check_status", "identity_verifications", "user_id", "status verified_at created_at updated_at"],
  ["employer_contact_profile", "employer_profiles", "user_id", "company_name industry region contact_email contact_phone contact_website created_at updated_at"],
  ["readiness", "role_gap_analyses", "user_id", "role_id matched_requirements gaps optimization_steps generated_at"],
] as const;

export interface ExportQuery { execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }> }
export interface RecordBudget { remaining: number }
/** Size on the database side before transferring large text/JSON sections into Node.
 * The selection must be a reviewed owned SELECT with LIMIT 5001, inside the same read-only snapshot.
 */
export async function readBoundedExportRows(query: ExportQuery, selection: SQL, budget: RecordBudget, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const measured = await query.execute(sql`SELECT count(*) AS row_count,
    coalesce(sum(octet_length(row_to_json(bounded_export_rows)::text)),0) AS byte_count
    FROM (${selection}) AS bounded_export_rows`);
  signal?.throwIfAborted();
  const count = Number(measured.rows[0]?.row_count);
  const bytes = Number(measured.rows[0]?.byte_count);
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(bytes) || bytes < 0) throw new ExportUnavailable("Account export size could not be verified.");
  if (count > 5000 || bytes > budget.remaining) throw new ExportUnavailable("Account records exceed the immediate-export limit. Request a full export from the privacy team.");
  budget.remaining -= bytes;
  if (!count) return [];
  const result = await query.execute(selection);
  signal?.throwIfAborted();
  if (result.rows.length !== count) throw new ExportUnavailable("Account export snapshot changed unexpectedly.");
  return result.rows;
}
export async function readPersonalRecords(query: ExportQuery, userId: string, signal?: AbortSignal, budget: RecordBudget = { remaining: MAX_EXPORT_BYTES - 65_536 }) {
  const records: Record<string, Record<string, unknown>[]> = {};
  for (const [section, table, owner, fields] of PERSONAL_RECORDS) {
    signal?.throwIfAborted();
    const columns = fields.split(" ");
    const rows = await readBoundedExportRows(query, sql`SELECT ${sql.join(columns.map(column => sql.identifier(column)), sql`, `)}
      FROM ${sql.identifier(table)} WHERE ${sql.identifier(owner)} = ${userId} LIMIT 5001`, budget, signal);
    // Defensive projection also excludes unknown keys returned by adapters.
    records[section] = rows.map(row => Object.fromEntries(columns.map(column => [column, row[column] ?? null])));
  }
  return records;
}
