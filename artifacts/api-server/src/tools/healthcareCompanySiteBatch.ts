import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function loadLocalEnv(): void {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const path = resolve(dir, ".env");
    if (existsSync(path)) {
      for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (!match) continue;
        let value = match[2] ?? "";
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) value = value.slice(1, -1);
        process.env[match[1]!] ??= value;
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

loadLocalEnv();

const { db } = await import("@workspace/db");
const { sql } = await import("drizzle-orm");
const { readDatabaseIdentity } = await import("./databaseSafety");
const { parseHealthcareBatchEmployers, runHealthcareCompanySiteBatch } = await import(
  "../lib/healthcareCompanySiteBatch"
);

const apply = argument("apply") === "true";
const cohortPath = resolve(argument("cohort") ?? resolve(process.cwd(), "../../artifacts/healthcare-company-site-cohort.json"));
const employers = parseHealthcareBatchEmployers(JSON.parse(readFileSync(cohortPath, "utf8")));
const identity = await readDatabaseIdentity(db);
const expectedFingerprint = argument("expected-db-fingerprint");

if (apply) {
  if (argument("confirm-dev-writes") !== "true") {
    throw new Error("Development apply requires --confirm-dev-writes=true.");
  }
  if (!expectedFingerprint || identity.fingerprint !== expectedFingerprint.toLowerCase()) {
    throw new Error("Refusing to write because the database fingerprint was not confirmed.");
  }
  const host = new URL(process.env.DATABASE_URL ?? "postgres://localhost/none").hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error("This CLI apply is limited to the local development database. Use the guarded internal route for production.");
  }
  // Local development databases created before migration 0031 lack these columns.
  await db.execute(sql`
    ALTER TABLE sponsor_licence_vacancies
      ADD COLUMN IF NOT EXISTS application_url text,
      ADD COLUMN IF NOT EXISTS closes_at timestamptz,
      ADD COLUMN IF NOT EXISTS expires_at timestamptz,
      ADD COLUMN IF NOT EXISTS closed_reason text,
      ADD COLUMN IF NOT EXISTS company_vacancy_evidence jsonb,
      ADD COLUMN IF NOT EXISTS company_evidence_legacy_until timestamptz,
      ADD COLUMN IF NOT EXISTS source_missing_since timestamptz,
      ADD COLUMN IF NOT EXISTS source_missing_observations integer NOT NULL DEFAULT 0
  `);
}

const report = await runHealthcareCompanySiteBatch({ employers, apply, budgetMs: 15 * 60_000 });
const outputDir = resolve(process.cwd(), "../../artifacts/healthcare-company-site-batch");
mkdirSync(outputDir, { recursive: true });
const output = { database: identity.databaseName, fingerprint: identity.fingerprint, ...report };
writeFileSync(resolve(outputDir, apply ? "apply-report.json" : "dry-run-report.json"), JSON.stringify(output, null, 2));
if (report.rollback) {
  writeFileSync(resolve(outputDir, "rollback.json"), JSON.stringify({ createdAt: new Date().toISOString(), ...report.rollback }, null, 2));
}
console.log(JSON.stringify({
  fingerprint: identity.fingerprint,
  employers: report.employersChecked.length,
  found: report.found,
  accepted: report.accepted,
  rejected: report.rejected,
  inserted: report.inserted,
  updated: report.updated,
  repeatInserted: report.repeatInserted,
  candidateVisible: report.candidateVisible,
  counts: report.counts,
  reasons: report.rejectionReasons,
  budgetExhausted: report.budgetExhausted,
}, null, 2));
process.exit(0);
