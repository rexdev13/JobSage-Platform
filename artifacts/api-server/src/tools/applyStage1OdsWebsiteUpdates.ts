import { sql } from "drizzle-orm";
import { access, mkdir, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import {
  planStage2OdsWebsiteUpdates,
  type Stage2OdsWritePlan,
  type Stage2OdsWriteTarget,
} from "./stage2OdsWebsiteTargets";

const WRITER_DATABASE_ENV = "COMPANY_SITE_WEBSITE_PRODUCTION_WRITE_DATABASE_URL";
const DISCOVERY_READONLY_DATABASE_ENV = "COMPANY_SITE_DISCOVERY_READONLY_DATABASE_URL";
const PROOF_DATABASE_ENV = "COMPANY_SITE_DISCOVERY_PROOF_DATABASE_URL";
const READONLY_DATABASE_ENVS = [
  DISCOVERY_READONLY_DATABASE_ENV,
  PROOF_DATABASE_ENV,
] as const;
const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
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
  confirmedRestore: boolean;
  confirmProofCredentialReuse: boolean;
  stage2TargetsFile?: string;
  beforeImageFile?: string;
  restoreBeforeImageFile?: string;
};

type Stage2WriterRow = Stage1OdsWebsiteRow & {
  id?: string | number;
};

type Stage2BeforeRow = {
  organisation_name: string;
  website: string | null;
  website_ods_code: string | null;
  website_ods_record_url: string | null;
};

type Stage2BeforeImage = {
  version: 1;
  scope: "stage2-ods-website-update";
  createdAt: string;
  database: {
    name: string;
    host: string;
    role: string;
    fingerprint: string;
  };
  countsBefore: Stage2CountSnapshot;
  targets: Array<Stage2OdsWriteTarget & {
    beforeRows: Stage2BeforeRow[];
  }>;
};

type Stage2CountSnapshot = {
  rowCount: number;
  blankWebsiteRows: number;
  blankAllThreeRows: number;
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
    if (![
      "preflight-only",
      "apply",
      "expected-db-fingerprint",
      "confirm-production-ods-write",
      "confirm-production-ods-restore",
      "confirm-proof-credential-reuse",
      "stage2-targets-file",
      "before-image-file",
      "restore-before-image-file",
    ].includes(name)) {
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
  const confirmedRestore = parseBoolean("confirm-production-ods-restore");
  const confirmProofCredentialReuse = parseBoolean("confirm-proof-credential-reuse");
  if (preflightOnly === apply) {
    throw new Error("Choose exactly one of --preflight-only=true or --apply=true.");
  }
  const stage2TargetsFile = values.get("stage2-targets-file");
  const beforeImageFile = values.get("before-image-file");
  const restoreBeforeImageFile = values.get("restore-before-image-file");
  if (
    confirmProofCredentialReuse &&
    (!stage2TargetsFile || restoreBeforeImageFile)
  ) {
    throw new Error(
      "--confirm-proof-credential-reuse=true is valid only for a Stage 2 ODS apply plan.",
    );
  }
  if (stage2TargetsFile && restoreBeforeImageFile) {
    throw new Error("Choose a Stage 2 apply plan or a before-image restore, not both.");
  }
  if (beforeImageFile && !stage2TargetsFile) {
    throw new Error("--before-image-file is valid only with --stage2-targets-file.");
  }
  if (apply && !restoreBeforeImageFile && !confirmed) {
    throw new Error("Apply requires --confirm-production-ods-write=true.");
  }
  if (stage2TargetsFile && apply && !beforeImageFile) {
    throw new Error("Stage 2 apply requires --before-image-file so the original values are saved first.");
  }
  if (restoreBeforeImageFile && apply && !confirmedRestore) {
    throw new Error("A restore requires --confirm-production-ods-restore=true.");
  }
  if (confirmedRestore && (!restoreBeforeImageFile || !apply)) {
    throw new Error("--confirm-production-ods-restore=true is valid only with an applied before-image restore.");
  }
  if (confirmed && (restoreBeforeImageFile || confirmedRestore)) {
    throw new Error("Use the separate restore confirmation for a before-image restore.");
  }
  const expectedFingerprint = values.get("expected-db-fingerprint");
  if (expectedFingerprint && !FINGERPRINT_PATTERN.test(expectedFingerprint)) {
    throw new Error("--expected-db-fingerprint must be a 32-character hexadecimal fingerprint.");
  }
  if (apply && !expectedFingerprint) {
    throw new Error("Apply requires the fingerprint from an independently checked preflight.");
  }
  if (preflightOnly && (confirmed || confirmedRestore)) {
    throw new Error("Production write confirmation is only valid with --apply=true.");
  }
  return {
    preflightOnly,
    apply,
    confirmed,
    confirmedRestore,
    confirmProofCredentialReuse,
    ...(stage2TargetsFile ? { stage2TargetsFile } : {}),
    ...(beforeImageFile ? { beforeImageFile } : {}),
    ...(restoreBeforeImageFile ? { restoreBeforeImageFile } : {}),
    ...(expectedFingerprint ? { expectedFingerprint } : {}),
  };
}

function parseConfiguredUrl(value: string, environmentName: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`The ${environmentName} environment value is not a valid URL.`);
  }
}

function connectionTarget(value: string, environmentName: string): string {
  const url = parseConfiguredUrl(value, environmentName);
  return `${url.protocol}//${url.hostname.toLowerCase()}:${url.port || "5432"}${url.pathname}`;
}

function credentialIdentity(value: string, environmentName: string): string {
  const url = parseConfiguredUrl(value, environmentName);
  return `${decodeURIComponent(url.username)}\u0000${decodeURIComponent(url.password)}`;
}

function prepareWriterEnvironment(
  env: NodeJS.ProcessEnv,
  confirmProofCredentialReuse: boolean,
): string {
  if (env.NODE_ENV !== "production") {
    throw new Error("The production ODS writer requires NODE_ENV=production.");
  }
  const writerUrl = env[WRITER_DATABASE_ENV]?.trim();
  if (!writerUrl) {
    throw new Error(`The production ODS writer requires the ${WRITER_DATABASE_ENV} secret.`);
  }
  const parsed = parseConfiguredUrl(writerUrl, WRITER_DATABASE_ENV);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("The production writer secret must use the PostgreSQL protocol.");
  }

  const defaultUrl = env.DATABASE_URL?.trim();
  if (!defaultUrl) {
    throw new Error("DATABASE_URL is required for a development-target separation check.");
  }
  if (
    connectionTarget(writerUrl, WRITER_DATABASE_ENV) ===
    connectionTarget(defaultUrl, "DATABASE_URL")
  ) {
    throw new Error("Production writer resolves to the same database target as DATABASE_URL.");
  }
  const writerCredentials = credentialIdentity(writerUrl, WRITER_DATABASE_ENV);
  const matchingCredentialEnvs: string[] = [];
  for (const key of READONLY_DATABASE_ENVS) {
    const readonlyUrl = env[key]?.trim();
    if (readonlyUrl && writerCredentials === credentialIdentity(readonlyUrl, key)) {
      matchingCredentialEnvs.push(key);
    }
  }
  const matchesProofCredential = matchingCredentialEnvs.includes(PROOF_DATABASE_ENV);
  const matchesDiscoveryReadonlyCredential = matchingCredentialEnvs.includes(
    DISCOVERY_READONLY_DATABASE_ENV,
  );
  if (matchesDiscoveryReadonlyCredential && !matchesProofCredential) {
    throw new Error("The production writer cannot reuse the discovery read-only credentials.");
  }
  if (matchesProofCredential && !confirmProofCredentialReuse) {
    throw new Error("Reusing proof credentials for the Stage 2 writer requires explicit confirmation.");
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
    throw new Error("The production writer has sequence privileges that are not needed for ODS website updates.");
  }
}

function workspaceFilePath(value: string): string {
  if (!value.trim()) throw new Error("A nonblank workspace-relative file path is required.");
  const root = WORKSPACE_ROOT;
  const absolute = resolve(root, value);
  const fromRoot = relative(root, absolute);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("ODS writer input and backup files must stay inside the workspace.");
  }
  return absolute;
}

async function assertFileDoesNotExist(path: string): Promise<void> {
  try {
    await access(path);
    throw new Error("The before-image file already exists; refusing to replace it.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("refusing to replace")) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function writeJsonWithoutOverwrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function writerNameKey(value: string): string {
  return value.trim().toLocaleLowerCase("en-GB");
}

function parseCount(value: unknown, name: string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Production ${name} count was not a safe integer.`);
  }
  return count;
}

async function readStage2Counts(transaction: {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>;
}): Promise<Stage2CountSnapshot> {
  const result = await transaction.execute(sql`
    SELECT
      COUNT(COALESCE(organisation_name, '')) AS row_count,
      COUNT(COALESCE(organisation_name, '')) FILTER (
        WHERE COALESCE(btrim(website), '') = ''
      ) AS blank_website_rows,
      COUNT(COALESCE(organisation_name, '')) FILTER (
        WHERE COALESCE(btrim(website), '') = ''
          AND COALESCE(btrim(website_ods_code), '') = ''
          AND COALESCE(btrim(website_ods_record_url), '') = ''
      ) AS blank_all_three_rows
    FROM public.sponsor_licences
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("Production row-count snapshot was empty.");
  return {
    rowCount: parseCount(row.row_count, "total sponsor"),
    blankWebsiteRows: parseCount(row.blank_website_rows, "blank website"),
    blankAllThreeRows: parseCount(row.blank_all_three_rows, "blank website/ODS"),
  };
}

function stage2SelectedNames(targets: readonly Stage2OdsWriteTarget[]): string[] {
  return targets.map((target) => writerNameKey(target.organisationName));
}

function assertCountsAfterStage2Write(
  before: Stage2CountSnapshot,
  after: Stage2CountSnapshot,
  writeRows: number,
): void {
  if (after.rowCount !== before.rowCount) {
    throw new Error("Sponsor row count changed during Stage 2; rolling back.");
  }
  if (
    before.blankWebsiteRows - after.blankWebsiteRows !== writeRows ||
    before.blankAllThreeRows - after.blankAllThreeRows !== writeRows
  ) {
    throw new Error("Stage 2 blank-field count changes do not equal the approved write rows; rolling back.");
  }
}

function assertCountsAfterStage2Restore(
  before: Stage2CountSnapshot,
  after: Stage2CountSnapshot,
  restoredRows: number,
): void {
  if (after.rowCount !== before.rowCount) {
    throw new Error("Sponsor row count changed during Stage 2 restore; rolling back.");
  }
  if (
    after.blankWebsiteRows - before.blankWebsiteRows !== restoredRows ||
    after.blankAllThreeRows - before.blankAllThreeRows !== restoredRows
  ) {
    throw new Error("Stage 2 restore blank-field count changes do not match the saved before-image; rolling back.");
  }
}

function validateBeforeImage(value: Stage2BeforeImage): Stage2BeforeImage {
  if (
    value.version !== 1 ||
    value.scope !== "stage2-ods-website-update" ||
    !Array.isArray(value.targets) ||
    value.targets.length === 0
  ) {
    throw new Error("The Stage 2 before-image has an unsupported or empty format.");
  }
  for (const target of value.targets) {
    if (
      !Number.isInteger(target.expectedRowCount) ||
      target.expectedRowCount < 1 ||
      !Array.isArray(target.beforeRows) ||
      target.beforeRows.length !== target.expectedRowCount
    ) {
      throw new Error(`The before-image row count is invalid for ${target.organisationName}.`);
    }
    if (target.beforeRows.some((row) =>
      writerNameKey(row.organisation_name) !== writerNameKey(target.organisationName) ||
      Boolean(row.website?.trim()) ||
      Boolean(row.website_ods_code?.trim()) ||
      Boolean(row.website_ods_record_url?.trim())
    )) {
      throw new Error(`The before-image does not contain blank original fields for ${target.organisationName}.`);
    }
    const beforeValues = new Set(target.beforeRows.map((row) =>
      JSON.stringify([row.website, row.website_ods_code, row.website_ods_record_url])
    ));
    if (beforeValues.size !== 1) {
      throw new Error(`Duplicate rows had different original values for ${target.organisationName}; safe name-only restore is not possible.`);
    }
  }
  return value;
}

function assertCurrentAppliedStage2Values(
  beforeImage: Stage2BeforeImage,
  selectedRows: readonly Stage2WriterRow[],
): void {
  const rowsByName = new Map<string, Stage2WriterRow[]>();
  for (const row of selectedRows) {
    const key = writerNameKey(row.organisation_name);
    const rows = rowsByName.get(key) ?? [];
    rows.push(row);
    rowsByName.set(key, rows);
  }
  const targetKeys = new Set(beforeImage.targets.map((target) =>
    writerNameKey(target.organisationName)
  ));
  if (selectedRows.some((row) => !targetKeys.has(writerNameKey(row.organisation_name)))) {
    throw new Error("Production selection returned an employer outside the before-image restore scope.");
  }
  const expectedTotal = beforeImage.targets.reduce(
    (total, target) => total + target.expectedRowCount,
    0,
  );
  if (selectedRows.length !== expectedTotal) {
    throw new Error("Production restore row count differs from the saved before-image.");
  }
  for (const target of beforeImage.targets) {
    const rows = rowsByName.get(writerNameKey(target.organisationName)) ?? [];
    if (rows.length !== target.expectedRowCount) {
      throw new Error(`Production restore row count changed for ${target.organisationName}.`);
    }
    if (rows.some((row) =>
      row.website !== target.website ||
      row.website_ods_code !== target.odsCode ||
      row.website_ods_record_url !== target.odsRecordUrl
    )) {
      throw new Error(`Current values no longer match the Stage 2 update for ${target.organisationName}.`);
    }
  }
}

async function run(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const stage2PlanPath = options.stage2TargetsFile
    ? workspaceFilePath(options.stage2TargetsFile)
    : undefined;
  const beforeImagePath = options.beforeImageFile
    ? workspaceFilePath(options.beforeImageFile)
    : undefined;
  const restorePath = options.restoreBeforeImageFile
    ? workspaceFilePath(options.restoreBeforeImageFile)
    : undefined;
  const stage2Plan = stage2PlanPath
    ? await readJsonFile<Stage2OdsWritePlan>(stage2PlanPath)
    : undefined;
  if (stage2Plan && (stage2Plan.version !== 1 || !Array.isArray(stage2Plan.targets) || !stage2Plan.targets.length)) {
    throw new Error("The Stage 2 apply plan is unsupported or contains no targets.");
  }
  const restoreBeforeImage = restorePath
    ? validateBeforeImage(await readJsonFile<Stage2BeforeImage>(restorePath))
    : undefined;
  if (options.apply && beforeImagePath) {
    await assertFileDoesNotExist(beforeImagePath);
  }
  prepareWriterEnvironment(
    process.env,
    options.confirmProofCredentialReuse,
  );
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

      const database = {
        name: identity.databaseName,
        host: identity.databaseHost,
        role: identity.roleName,
        fingerprint: identity.fingerprint,
      };
      const targetNames = restoreBeforeImage
        ? stage2SelectedNames(restoreBeforeImage.targets)
        : stage2Plan
          ? stage2SelectedNames(stage2Plan.targets)
          : STAGE1_ODS_WEBSITE_TARGETS.map((target) =>
            target.organisationName.trim().toLocaleLowerCase("en-GB")
          );
      const selected = options.apply
        ? await transaction.execute(sql`
          SELECT
            organisation_name,
            website,
            website_ods_code,
            website_ods_record_url
          FROM public.sponsor_licences
          WHERE lower(btrim(organisation_name)) = ANY(${sql.param(targetNames)}::text[])
          ORDER BY lower(btrim(organisation_name)), organisation_name
          FOR UPDATE
        `)
        : await transaction.execute(sql`
          SELECT
            organisation_name,
            website,
            website_ods_code,
            website_ods_record_url
          FROM public.sponsor_licences
          WHERE lower(btrim(organisation_name)) = ANY(${sql.param(targetNames)}::text[])
          ORDER BY lower(btrim(organisation_name)), organisation_name
        `);
      const selectedRows = selected.rows as Stage2WriterRow[];

      if (restoreBeforeImage) {
        assertCurrentAppliedStage2Values(restoreBeforeImage, selectedRows);
        const countsBefore = await readStage2Counts(transaction);
        const restoreRows = restoreBeforeImage.targets.reduce(
          (total, target) => total + target.expectedRowCount,
          0,
        );
        if (options.preflightOnly) {
          return {
            status: "restore_preflight_passed",
            mode: "stage2-restore",
            database,
            readOnlyTransaction: true,
            rolePrivilegesVerified: true,
            selectedEmployers: restoreBeforeImage.targets.length,
            plannedRestoreRows: restoreRows,
            writesAttempted: 0,
            countsBefore,
            beforeImageFile: options.restoreBeforeImageFile,
          };
        }

        let restoredRows = 0;
        const restored: Array<{
          organisation_name: string;
          website: string | null;
          website_ods_code: string | null;
          website_ods_record_url: string | null;
        }> = [];
        for (const target of restoreBeforeImage.targets) {
          const before = target.beforeRows[0]!;
          const result = await transaction.execute(sql`
            UPDATE public.sponsor_licences
            SET
              website = ${before.website},
              website_ods_code = ${before.website_ods_code},
              website_ods_record_url = ${before.website_ods_record_url}
            WHERE lower(btrim(organisation_name)) = ${writerNameKey(target.organisationName)}
              AND website = ${target.website}
              AND website_ods_code = ${target.odsCode}
              AND website_ods_record_url = ${target.odsRecordUrl}
            RETURNING organisation_name, website, website_ods_code, website_ods_record_url
          `);
          const returned = result.rows as typeof restored;
          if (returned.length !== target.expectedRowCount) {
            throw new Error(
              `Expected ${target.expectedRowCount} conditional restore rows for ${target.organisationName}; got ${returned.length}. The transaction will be rolled back.`,
            );
          }
          restored.push(...returned);
          restoredRows += returned.length;
        }
        if (restoredRows !== restoreRows) {
          throw new Error("Stage 2 restore row count did not match the before-image; rolling back.");
        }
        const countsAfter = await readStage2Counts(transaction);
        assertCountsAfterStage2Restore(countsBefore, countsAfter, restoredRows);
        return {
          status: "restored",
          mode: "stage2-restore",
          database,
          selectedEmployers: restoreBeforeImage.targets.length,
          writesAttempted: restoredRows,
          restoredRows: restored.length,
          countsBefore,
          countsAfter,
          restored,
          beforeImageFile: options.restoreBeforeImageFile,
        };
      }

      if (stage2Plan) {
        const updates = planStage2OdsWebsiteUpdates(stage2Plan, selectedRows);
        const approvedWriteRows = updates.reduce(
          (total, target) => total + target.expectedRowCount,
          0,
        );
        const countsBefore = await readStage2Counts(transaction);
        if (options.preflightOnly) {
          return {
            status: "stage2_preflight_passed",
            mode: "stage2",
            database,
            readOnlyTransaction: true,
            rolePrivilegesVerified: true,
            selectedEmployers: updates.length,
            plannedWriteRows: approvedWriteRows,
            writesAttempted: 0,
            proofCredentialReuseConfirmed: options.confirmProofCredentialReuse,
            countsBefore,
            plannedUpdates: updates,
          };
        }
        if (!beforeImagePath) {
          throw new Error("Stage 2 apply is missing its before-image path.");
        }

        const beforeImage: Stage2BeforeImage = validateBeforeImage({
          version: 1,
          scope: "stage2-ods-website-update",
          createdAt: new Date().toISOString(),
          database,
          countsBefore,
          targets: updates.map((target) => ({
            ...target,
            beforeRows: selectedRows
              .filter((row) =>
                writerNameKey(row.organisation_name) === writerNameKey(target.organisationName)
              )
              .map((row) => ({
                organisation_name: row.organisation_name,
                website: row.website,
                website_ods_code: row.website_ods_code,
                website_ods_record_url: row.website_ods_record_url,
              })),
          })),
        });
        await writeJsonWithoutOverwrite(beforeImagePath, beforeImage);

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
            WHERE lower(btrim(organisation_name)) = ${writerNameKey(update.organisationName)}
              AND COALESCE(btrim(website), '') = ''
              AND COALESCE(btrim(website_ods_code), '') = ''
              AND COALESCE(btrim(website_ods_record_url), '') = ''
            RETURNING organisation_name, website, website_ods_code, website_ods_record_url
          `);
          const returned = result.rows as typeof updatedRows;
          if (returned.length !== update.expectedRowCount) {
            throw new Error(
              `Expected ${update.expectedRowCount} conditional update rows for ${update.organisationName}; got ${returned.length}. The transaction will be rolled back.`,
            );
          }
          updatedRows.push(...returned);
        }
        if (updatedRows.length !== approvedWriteRows) {
          throw new Error("Stage 2 update count did not match the approved plan; rolling back.");
        }
        const countsAfter = await readStage2Counts(transaction);
        assertCountsAfterStage2Write(countsBefore, countsAfter, updatedRows.length);
        return {
          status: "applied",
          mode: "stage2",
          database,
          selectedEmployers: updates.length,
          writesAttempted: updatedRows.length,
          updatedRows: updatedRows.length,
          proofCredentialReuseConfirmed: options.confirmProofCredentialReuse,
          countsBefore,
          countsAfter,
          updated: updatedRows,
          beforeImageFile: options.beforeImageFile,
        };
      }

      const updates = planStage1OdsWebsiteUpdates(selectedRows);
      if (updates.length !== 18) {
        throw new Error("The approved Stage 1 cohort must contain exactly 18 employers.");
      }
      if (options.preflightOnly) {
        return {
          status: "preflight_passed",
          mode: "stage1",
          database,
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
        mode: "stage1",
        database,
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
  process.stderr.write(`ODS website update failed: ${safeToolErrorSummary(error)}\n`);
  process.exitCode = 1;
});
