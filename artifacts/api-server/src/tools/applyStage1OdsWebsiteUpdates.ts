import { sql } from "drizzle-orm";
import {
  readDatabaseIdentity,
  safeToolErrorSummary,
  type DatabaseIdentity,
} from "./databaseSafety";
import {
  planStage1OdsWebsiteUpdates,
  STAGE1_ODS_WEBSITE_TARGETS,
  type Stage1OdsWebsiteRow,
  type Stage1OdsWebsiteUpdate,
} from "./stage1OdsWebsiteTargets";

const WRITER_DATABASE_ENV = "COMPANY_SITE_WEBSITE_PRODUCTION_WRITE_DATABASE_URL";
const READONLY_DATABASE_ENVS = [
  "COMPANY_SITE_DISCOVERY_READONLY_DATABASE_URL",
  "COMPANY_SITE_DISCOVERY_PROOF_DATABASE_URL",
] as const;
const FINGERPRINT_PATTERN = /^[0-9a-f]{32}$/i;
const EXPECTED_UPDATE_COLUMNS = new Set([
  "website",
  "website_ods_code",
  "website_ods_record_url",
]);
const EXPECTED_SELECT_COLUMNS = new Set([
  "organisation_name",
  "website",
  "website_ods_code",
  "website_ods_record_url",
]);

type RunOptions = {
  preflightOnly: boolean;
  apply: boolean;
  expectedFingerprint?: string;
  confirmed: boolean;
};

type PrivilegeRelation = {
  schema_name: string;
  relation_name: string;
  can_select: boolean;
  can_insert: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_truncate: boolean;
  can_reference: boolean;
  can_trigger: boolean;
};

type PrivilegeColumn = {
  column_name: string;
  can_select: boolean;
  can_update: boolean;
};

function parseArguments(argv: readonly string[]): RunOptions {
  const values = new Map<string, string>();
  for (const arg of argv) {
    if (arg === "--") continue;
    const match = arg.match(/^--([a-z0-9-]+)(?:=(.*))?$/i);
    if (!match) throw new Error("Arguments must use --name or --name=value form.");
    values.set(match[1]!, match[2] ?? "true");
  }
  for (const name of values.keys()) {
    if (!["preflight-only", "apply", "expected-db-fingerprint", "confirm-production-ods-write"].includes(name)) {
      throw new Error(`Unknown argument --${name}.`);
    }
  }
  const parseBoolean = (name: string): boolean => {
    const value = values.get(name);
    if (value !== undefined && value !== "true" && value !== "false") {
      throw new Error(`--${name} must be true or false.`);
    }
    return value === "true";
  };
  const preflightOnly = parseBoolean("preflight-only");
  const apply = parseBoolean("apply");
  const confirmed = parseBoolean("confirm-production-ods-write");
  if (preflightOnly === apply) {
    throw new Error("Choose exactly one of --preflight-only=true or --apply=true.");
  }
  if (apply && !confirmed) {
    throw new Error("Apply requires --confirm-production-ods-write=true.");
  }
  const expectedFingerprint = values.get("expected-db-fingerprint");
  if (expectedFingerprint && !FINGERPRINT_PATTERN.test(expectedFingerprint)) {
    throw new Error("--expected-db-fingerprint must be a 32-character hexadecimal fingerprint.");
  }
  if (apply && !expectedFingerprint) {
    throw new Error("Apply requires the fingerprint from an independently checked preflight.");
  }
  if (preflightOnly && confirmed) {
    throw new Error("Production write confirmation is only valid with --apply=true.");
  }
  return {
    preflightOnly,
    apply,
    confirmed,
    ...(expectedFingerprint ? { expectedFingerprint } : {}),
  };
}

function connectionTarget(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.hostname.toLowerCase()}:${url.port || "5432"}${url.pathname}`;
}

function credentialIdentity(value: string): string {
  const url = new URL(value);
  return `${decodeURIComponent(url.username)}\u0000${decodeURIComponent(url.password)}`;
}

function prepareWriterEnvironment(env: NodeJS.ProcessEnv): string {
  if (env.NODE_ENV !== "production") {
    throw new Error("The Stage 1 writer requires NODE_ENV=production.");
  }
  const writerUrl = env[WRITER_DATABASE_ENV]?.trim();
  if (!writerUrl) {
    throw new Error(`The Stage 1 writer requires the ${WRITER_DATABASE_ENV} secret.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(writerUrl);
  } catch {
    throw new Error("The production writer secret is not a valid database URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("The production writer secret must use the PostgreSQL protocol.");
  }

  const defaultUrl = env.DATABASE_URL?.trim();
  if (!defaultUrl) {
    throw new Error("DATABASE_URL is required for a development-target separation check.");
  }
  if (connectionTarget(writerUrl) === connectionTarget(defaultUrl)) {
    throw new Error("Production writer resolves to the same database target as DATABASE_URL.");
  }
  const writerCredentials = credentialIdentity(writerUrl);
  for (const key of READONLY_DATABASE_ENVS) {
    const readonlyUrl = env[key]?.trim();
    if (readonlyUrl && writerCredentials === credentialIdentity(readonlyUrl)) {
      throw new Error("The production writer must use credentials separate from discovery and proof roles.");
    }
  }

  env.DATABASE_URL = writerUrl;
  delete env.DATABASE_READ_ONLY;
  return writerUrl;
}

function assertWriterIdentity(
  identity: DatabaseIdentity,
  mode: "read-only-preflight" | "write",
  expectedFingerprint?: string,
): void {
  if (expectedFingerprint && identity.fingerprint !== expectedFingerprint.toLowerCase()) {
    throw new Error("Connected database does not match the independently checked preflight fingerprint.");
  }
  if (identity.defaultTransactionReadOnly !== "off") {
    throw new Error("The production writer session must default to read-write mode.");
  }
  if (mode === "read-only-preflight" && identity.transactionReadOnly !== "on") {
    throw new Error("Stage 1 preflight transaction is not read-only.");
  }
  if (mode === "write" && identity.transactionReadOnly !== "off") {
    throw new Error("The production writer transaction is not read-write.");
  }
  if (
    identity.roleIsSuperuser ||
    identity.roleCanAdminister ||
    identity.roleCanCreateSchema ||
    identity.roleCanCreateDatabaseObjects ||
    identity.roleCanCreateTemporaryObjects ||
    identity.roleOwnsDatabase ||
    identity.roleOwnsApplicationObjects ||
    identity.roleHasWriteAllData
  ) {
    throw new Error("The production writer role has broader-than-approved administrative or ownership privileges.");
  }
}

async function assertLeastPrivilege(transaction: {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>;
}): Promise<void> {
  const relationResult = await transaction.execute(sql`
    SELECT
      n.nspname AS schema_name,
      c.relname AS relation_name,
      has_table_privilege(current_user, c.oid, 'SELECT') AS can_select,
      has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,
      has_table_privilege(current_user, c.oid, 'UPDATE') AS can_update,
      has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,
      has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,
      has_table_privilege(current_user, c.oid, 'REFERENCES') AS can_reference,
      has_table_privilege(current_user, c.oid, 'TRIGGER') AS can_trigger
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  `);
  const relations = relationResult.rows as PrivilegeRelation[];
  for (const relation of relations) {
    const isTarget = relation.schema_name === "public" &&
      relation.relation_name === "sponsor_licences";
    if (
      relation.can_insert ||
      relation.can_delete ||
      relation.can_truncate ||
      relation.can_reference ||
      relation.can_trigger ||
      relation.can_update ||
      (relation.can_select && !isTarget)
    ) {
      throw new Error("The production writer has table-level privileges outside the approved column-only update.");
    }
  }
  if (!relations.some((relation) =>
    relation.schema_name === "public" && relation.relation_name === "sponsor_licences"
  )) {
    throw new Error("The expected public.sponsor_licences table is unavailable.");
  }

  const columnResult = await transaction.execute(sql`
    SELECT
      column_name,
      has_column_privilege(
        current_user,
        'public.sponsor_licences',
        column_name,
        'SELECT'
      ) AS can_select,
      has_column_privilege(
        current_user,
        'public.sponsor_licences',
        column_name,
        'UPDATE'
      ) AS can_update
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sponsor_licences'
  `);
  const columns = columnResult.rows as PrivilegeColumn[];
  const byName = new Map(columns.map((column) => [column.column_name, column]));
  for (const name of EXPECTED_SELECT_COLUMNS) {
    if (!byName.get(name)?.can_select) {
      throw new Error(`The production writer lacks required SELECT access to ${name}.`);
    }
  }
  for (const column of columns) {
    if (column.can_select !== EXPECTED_SELECT_COLUMNS.has(column.column_name)) {
      throw new Error("The production writer must have column-limited SELECT access to sponsor_licences.");
    }
    if (column.can_update !== EXPECTED_UPDATE_COLUMNS.has(column.column_name)) {
      throw new Error("The production writer must have UPDATE access only to website and its two ODS evidence columns.");
    }
  }

  const sequenceResult = await transaction.execute(sql`
    SELECT n.nspname AS schema_name, c.relname AS sequence_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND c.relkind = 'S'
      AND (
        has_sequence_privilege(current_user, c.oid, 'USAGE')
        OR has_sequence_privilege(current_user, c.oid, 'UPDATE')
      )
  `);
  if (sequenceResult.rows.length > 0) {
    throw new Error("The production writer has sequence privileges that are not needed for Stage 1.");
  }
}

async function run(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  prepareWriterEnvironment(process.env);
  const { db, pool } = await import("@workspace/db");
  try {
    const report = await db.transaction(async (transaction) => {
      await transaction.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
      if (options.preflightOnly) {
        await transaction.execute(sql`SET TRANSACTION READ ONLY`);
      }
      const identity = await readDatabaseIdentity(transaction);
      assertWriterIdentity(
        identity,
        options.preflightOnly ? "read-only-preflight" : "write",
        options.expectedFingerprint,
      );
      await assertLeastPrivilege(transaction);

      const targetNames = STAGE1_ODS_WEBSITE_TARGETS.map((target) =>
        target.organisationName.trim().toLocaleLowerCase("en-GB")
      );
      const selected = await transaction.execute(sql`
        SELECT
          organisation_name,
          website,
          website_ods_code,
          website_ods_record_url
        FROM public.sponsor_licences
        WHERE lower(btrim(organisation_name)) = ANY(${sql.param(targetNames)}::text[])
        ORDER BY lower(btrim(organisation_name)), organisation_name
      `);
      const updates = planStage1OdsWebsiteUpdates(
        selected.rows as Stage1OdsWebsiteRow[],
      );
      if (updates.length !== 18) {
        throw new Error("The approved Stage 1 cohort must contain exactly 18 employers.");
      }

      if (options.preflightOnly) {
        return {
          status: "preflight_passed",
          database: {
            name: identity.databaseName,
            host: identity.databaseHost,
            role: identity.roleName,
            fingerprint: identity.fingerprint,
          },
          readOnlyTransaction: true,
          rolePrivilegesVerified: true,
          selectedEmployers: updates.length,
          writesAttempted: 0,
          plannedUpdates: updates,
        };
      }

      const updatedRows: Array<{
        organisation_name: string;
        website: string;
        website_ods_code: string;
        website_ods_record_url: string;
      }> = [];
      for (const update of updates) {
        const result = await transaction.execute(sql`
          UPDATE public.sponsor_licences
          SET
            website = ${update.website},
            website_ods_code = ${update.odsCode},
            website_ods_record_url = ${update.odsRecordUrl}
          WHERE lower(btrim(organisation_name)) = ${update.organisationName.trim().toLocaleLowerCase("en-GB")}
            AND COALESCE(btrim(website), '') = ''
            AND COALESCE(btrim(website_ods_code), '') = ''
            AND COALESCE(btrim(website_ods_record_url), '') = ''
          RETURNING organisation_name, website, website_ods_code, website_ods_record_url
        `);
        const returned = result.rows as typeof updatedRows;
        if (returned.length !== 1) {
          throw new Error(
            `Expected one conditional update for ${update.organisationName}; got ${returned.length}. The transaction will be rolled back.`,
          );
        }
        updatedRows.push(returned[0]!);
      }
      if (updatedRows.length !== updates.length) {
        throw new Error("Stage 1 update count did not match the approved cohort; rolling back.");
      }
      return {
        status: "applied",
        database: {
          name: identity.databaseName,
          host: identity.databaseHost,
          role: identity.roleName,
          fingerprint: identity.fingerprint,
        },
        selectedEmployers: updates.length,
        writesAttempted: updatedRows.length,
        updated: updatedRows,
      };
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  process.stderr.write(`Stage 1 ODS website update failed: ${safeToolErrorSummary(error)}\n`);
  process.exitCode = 1;
});
