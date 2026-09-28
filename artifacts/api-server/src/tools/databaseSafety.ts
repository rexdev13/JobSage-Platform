import { sql } from "drizzle-orm";
import type { DiscoveryDatabaseMode } from "./companySiteDiscoveryRuntime";

const DATABASE_FINGERPRINT_PATTERN = /^[0-9a-f]{32}$/i;

type DatabaseClient = Pick<typeof import("@workspace/db").db, "execute">;

export type DatabaseIdentity = {
  databaseName: string;
  databaseHost: string;
  roleName: string;
  fingerprint: string;
  transactionReadOnly: string;
  defaultTransactionReadOnly: string;
  roleIsSuperuser: boolean;
  roleCanAdminister: boolean;
  roleHasWritePrivileges: boolean;
  roleCanCreateSchema: boolean;
  roleHasWriteAllData: boolean;
};

export async function readDatabaseIdentity(database: DatabaseClient): Promise<DatabaseIdentity> {
  const result = await database.execute(sql`
    SELECT
      current_database() AS database_name,
      COALESCE(inet_server_addr()::text, 'local-socket') AS database_host,
      current_user AS role_name,
      md5(
        current_database() || ':' ||
        coalesce(inet_server_addr()::text, '') || ':' ||
        pg_postmaster_start_time()::text
      ) AS fingerprint,
      current_setting('transaction_read_only') AS transaction_read_only,
      current_setting('default_transaction_read_only') AS default_transaction_read_only,
      COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), true)
        AS role_is_superuser,
      COALESCE((
        SELECT rolcreatedb OR rolcreaterole
        FROM pg_roles
        WHERE rolname = current_user
      ), true) AS role_can_administer,
      COALESCE((
        SELECT bool_or(
          has_table_privilege(current_user, c.oid, 'INSERT')
          OR has_table_privilege(current_user, c.oid, 'UPDATE')
          OR has_table_privilege(current_user, c.oid, 'DELETE')
          OR has_table_privilege(current_user, c.oid, 'TRUNCATE')
        )
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      ), false) AS role_has_write_privileges,
      COALESCE((
        SELECT bool_or(has_schema_privilege(current_user, n.oid, 'CREATE'))
        FROM pg_namespace n
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
      ), false) AS role_can_create_schema,
      EXISTS (
        SELECT 1
        FROM pg_roles r
        WHERE r.rolname = 'pg_write_all_data'
          AND pg_has_role(current_user, r.rolname, 'MEMBER')
      ) AS role_has_write_all_data
  `) as { rows: Array<Record<string, unknown>> };
  const row = result.rows[0];
  if (!row) throw new Error("Unable to identify the connected database.");
  return {
    databaseName: String(row.database_name),
    databaseHost: String(row.database_host),
    roleName: String(row.role_name),
    fingerprint: String(row.fingerprint).toLowerCase(),
    transactionReadOnly: String(row.transaction_read_only),
    defaultTransactionReadOnly: String(row.default_transaction_read_only),
    roleIsSuperuser: row.role_is_superuser === true,
    roleCanAdminister: row.role_can_administer === true,
    roleHasWritePrivileges: row.role_has_write_privileges === true,
    roleCanCreateSchema: row.role_can_create_schema === true,
    roleHasWriteAllData: row.role_has_write_all_data === true,
  };
}

export async function assertDatabaseFingerprint(
  expectedFingerprint: string,
  database?: DatabaseClient,
): Promise<void> {
  if (!DATABASE_FINGERPRINT_PATTERN.test(expectedFingerprint)) {
    throw new Error("Expected database fingerprint must be a 32-character hexadecimal value.");
  }
  const selectedDatabase = database ?? (await import("@workspace/db")).db;
  const identity = await readDatabaseIdentity(selectedDatabase);
  if (identity.fingerprint !== expectedFingerprint.toLowerCase()) {
    throw new Error("Connected database does not match the independently confirmed database.");
  }
}

export async function assertDatabaseMode(
  database: DatabaseClient,
  mode: DiscoveryDatabaseMode,
  expectedFingerprint: string,
): Promise<DatabaseIdentity> {
  if (!DATABASE_FINGERPRINT_PATTERN.test(expectedFingerprint)) {
    throw new Error("Expected database fingerprint must be a 32-character hexadecimal value.");
  }
  const identity = await readDatabaseIdentity(database);
  if (identity.fingerprint !== expectedFingerprint.toLowerCase()) {
    throw new Error("Connected database does not match the independently confirmed database.");
  }
  if (mode === "production-readonly") {
    if (
      identity.transactionReadOnly !== "on" ||
      identity.defaultTransactionReadOnly !== "on" ||
      identity.roleIsSuperuser ||
      identity.roleCanAdminister ||
      identity.roleHasWritePrivileges ||
      identity.roleCanCreateSchema ||
      identity.roleHasWriteAllData
    ) {
      throw new Error(
        "Production connection is not verifiably read-only; refusing discovery or mapping review.",
      );
    }
  }
  return identity;
}

export function safeToolErrorSummary(value: unknown): string {
  const outer = value instanceof Error ? value as Error & { cause?: unknown; code?: unknown } : null;
  const cause = outer?.cause;
  const root = cause && typeof cause === "object"
    ? cause as { message?: unknown; code?: unknown }
    : null;
  const codeValue = root?.code ?? outer?.code;
  const safeCode = typeof codeValue === "string" && /^[A-Z0-9_-]{1,32}$/i.test(codeValue)
    ? ` (${codeValue})`
    : "";
  const rawMessage = typeof root?.message === "string"
    ? root.message
    : value instanceof Error
      ? value.message
      : String(value ?? "unknown error");
  const message = rawMessage
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"'`<>]+/gi, "[redacted-url]")
    .replace(/\b(password|token|secret|authorization)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 180);
  return `${message}${safeCode}`;
}