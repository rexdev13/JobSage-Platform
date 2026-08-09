import { pgTable, serial, integer, timestamp, varchar, uniqueIndex, index } from "drizzle-orm/pg-core";

// Vacancy favorites — per-candidate hearts on any vacancy card.
// vacancyId uses the unified vacancy id-space used across the app:
//   <= 1,000,000            → imported roles (roles.id)
//   1,000,001 – 2,000,000   → employer job listings (job_listings.id + 1,000,000)
//   > 2,000,000             → AI-discovered sponsor vacancies (sponsor_licence_vacancies.id + 2,000,000)
export const vacancyFavoritesTable = pgTable(
  "vacancy_favorites",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull(),
    vacancyId: integer("vacancy_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("vacancy_favorites_user_vacancy_idx").on(t.userId, t.vacancyId),
    index("vacancy_favorites_user_idx").on(t.userId),
  ],
);

export type VacancyFavorite = typeof vacancyFavoritesTable.$inferSelect;
export type InsertVacancyFavorite = typeof vacancyFavoritesTable.$inferInsert;
