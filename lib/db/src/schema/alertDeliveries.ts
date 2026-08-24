import { pgTable, serial, varchar, text, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * Durable deduplication for sponsor-vacancy job alerts.
 *
 * Vacancy snapshots are replaced during discovery, so the vacancy table's
 * serial ID is not a stable identity for an advert. The specific vacancy URL
 * is the stable identity used for alert delivery.
 */
export const jobAlertVacancyDeliveriesTable = pgTable(
  "job_alert_vacancy_deliveries",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull(),
    vacancyId: integer("vacancy_id"),
    vacancyUrl: text("vacancy_url").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_alert_vacancy_deliveries_user_url_idx").on(t.userId, t.vacancyUrl),
    index("job_alert_vacancy_deliveries_sent_at_idx").on(t.sentAt),
  ],
);

export type JobAlertVacancyDelivery = typeof jobAlertVacancyDeliveriesTable.$inferSelect;
export type InsertJobAlertVacancyDelivery = typeof jobAlertVacancyDeliveriesTable.$inferInsert;