-- Vacancy favorites: per-candidate hearts on vacancies across the unified
-- vacancy id-space (roles <=1M, employer job listings +1,000,000,
-- AI-discovered sponsor vacancies +2,000,000).
CREATE TABLE IF NOT EXISTS "vacancy_favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"vacancy_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vacancy_favorites_user_vacancy_idx" ON "vacancy_favorites" ("user_id","vacancy_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vacancy_favorites_user_idx" ON "vacancy_favorites" ("user_id");
