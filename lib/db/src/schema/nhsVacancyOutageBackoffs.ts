import { index, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

/**
 * Shared NHS Jobs probe lease and outage cooldown. A lease allows one worker
 * to test an employer while an outage cooldown prevents repeated requests
 * after a timeout, 429, or server failure.
 */
export const nhsVacancyOutageBackoffsTable = pgTable(
  "nhs_vacancy_outage_backoffs",
  {
    id: serial("id").primaryKey(),
    organisationKey: text("organisation_key").notNull(),
    probeToken: varchar("probe_token"),
    probeLeaseUntil: timestamp("probe_lease_until", { withTimezone: true }),
    retryAfter: timestamp("retry_after", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("nhs_vacancy_outage_backoffs_org_key_idx").on(t.organisationKey),
    index("nhs_vacancy_outage_backoffs_retry_after_idx").on(t.retryAfter),
  ],
);

export type NhsVacancyOutageBackoff = typeof nhsVacancyOutageBackoffsTable.$inferSelect;
export type InsertNhsVacancyOutageBackoff = typeof nhsVacancyOutageBackoffsTable.$inferInsert;